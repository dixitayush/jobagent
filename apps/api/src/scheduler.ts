import { Worker } from "bullmq";
import { pool } from "./db/pool";
import { createRedis } from "./lib/redis";
import { logger } from "./lib/logger";
import { closeQueues, queue, queueDepths, QUEUES } from "./queue/queues";
import { metrics } from "./lib/metrics";
import { applyRetention, schedulerTick } from "./services/schedulerService";

/**
 * Scheduler process (PRD §58). Uses BullMQ job schedulers so exactly one tick runs per
 * minute cluster-wide even with several scheduler replicas.
 */
async function main() {
  const maintenance = queue(QUEUES.MAINTENANCE);
  await maintenance.upsertJobScheduler("tick", { every: 60_000 }, { name: "tick", data: { task: "tick" } });
  await maintenance.upsertJobScheduler("retention", { pattern: "0 3 * * *", tz: "UTC" }, { name: "retention", data: { task: "retention" } });

  const worker = new Worker(
    QUEUES.MAINTENANCE,
    async (job) => {
      if (job.data.task === "retention") return applyRetention();
      const result = await schedulerTick();
      for (const d of await queueDepths()) {
        metrics.queueDepth.set({ queue: d.queue, state: "waiting" }, d.waiting);
        metrics.queueDepth.set({ queue: d.queue, state: "failed" }, d.failed);
      }
      return result;
    },
    { connection: createRedis("scheduler"), concurrency: 1 },
  );
  worker.on("failed", (job, err) => logger.error({ task: job?.data.task, err: err.message }, "scheduler task failed"));
  logger.info("scheduler started (tick every 60s, retention daily 03:00 UTC)");

  const shutdown = async () => {
    await worker.close();
    await closeQueues();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  logger.fatal({ err }, "scheduler failed to start");
  process.exit(1);
});
