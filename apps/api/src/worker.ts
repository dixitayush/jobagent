import http from "node:http";
import { Worker, type Job } from "bullmq";
import { env } from "./config/env";
import { runDigestAgent } from "./agent/digestGraph";
import { runMatchingAgent } from "./agent/matchingGraph";
import { pool } from "./db/pool";
import { createRedis } from "./lib/redis";
import { logger } from "./lib/logger";
import { metrics, registry } from "./lib/metrics";
import { closeQueues, enqueue, QUEUES, type JobPayloads, type QueueName } from "./queue/queues";
import { crawlSource } from "./services/crawlService";
import { sendDigestEmail } from "./services/emailService";
import { embedJobs } from "./services/embeddingService";
import { runManualPipeline } from "./services/manualRun";
import { processResume } from "./services/resumeService";
import { enqueueMatchesForJobs } from "./services/schedulerService";

type Handler<N extends QueueName> = (job: Job<JobPayloads[N]>) => Promise<unknown>;

const handlers: { [N in Exclude<QueueName, "maintenance" | "dead-letter">]: { concurrency: number; handle: Handler<N> } } = {
  "source-crawl": { concurrency: 4, handle: (j) => crawlSource(j.data.sourceConnectorId, j.data.trigger) },
  "job-embed": {
    concurrency: 2,
    handle: async (j) => {
      const result = await embedJobs(j.data.jobIds);
      await enqueueMatchesForJobs(j.data.jobIds);
      return result;
    },
  },
  "resume-process": { concurrency: 2, handle: (j) => processResume({ tenantId: j.data.tenantId, userId: j.data.userId }, j.data.resumeId) },
  match: { concurrency: 3, handle: (j) => runMatchingAgent({ tenantId: j.data.tenantId, userId: j.data.userId }, j.data.trigger) },
  "email-generation": { concurrency: 3, handle: (j) => runDigestAgent({ tenantId: j.data.tenantId, userId: j.data.userId }, j.data.window, j.data.windowLabel) },
  "agent-run": { concurrency: 2, handle: (j) => runManualPipeline({ tenantId: j.data.tenantId, userId: j.data.userId }, j.data.runKey) },
  "email-send": { concurrency: 5, handle: (j) => sendDigestEmail({ tenantId: j.data.tenantId, userId: j.data.userId }, j.data.notificationId) },
};

const workers: Worker[] = [];
for (const [name, cfg] of Object.entries(handlers) as [QueueName, { concurrency: number; handle: Handler<QueueName> }][]) {
  const w = new Worker(name, (job) => cfg.handle(job as Job<never>), { connection: createRedis(`worker:${name}`), concurrency: cfg.concurrency });
  w.on("completed", () => metrics.queueJobs.inc({ queue: name, outcome: "completed" }));
  w.on("failed", async (job, err) => {
    metrics.queueJobs.inc({ queue: name, outcome: "failed" });
    logger.warn({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "queue job failed");
    // Final failure → dead-letter queue for inspection/replay (PRD §59).
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await enqueue(QUEUES.DEAD_LETTER, { queue: name, jobId: job.id, name: job.name, data: job.data, error: err.message, failedAt: new Date().toISOString() }).catch(() => undefined);
    }
  });
  workers.push(w);
}

// Prometheus metrics for the worker process (internal network only).
const metricsServer = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("content-type", registry.contentType);
    res.end(await registry.metrics());
  } else if (req.url === "/health") {
    res.end("ok");
  } else {
    res.statusCode = 404;
    res.end();
  }
});
metricsServer.listen(env.WORKER_METRICS_PORT, () => logger.info({ port: env.WORKER_METRICS_PORT, queues: Object.keys(handlers) }, "workers started"));

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  await Promise.allSettled(workers.map((w) => w.close()));
  metricsServer.close();
  await closeQueues();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
