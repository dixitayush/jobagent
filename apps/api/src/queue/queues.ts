import { Queue, type JobsOptions } from "bullmq";
import { createRedis } from "../lib/redis";

/** PRD §29 / §59 queues. Each supports retry, dead-lettering, priority and concurrency. */
export const QUEUES = {
  SOURCE_CRAWL: "source-crawl",
  JOB_EMBED: "job-embed",
  RESUME_PROCESS: "resume-process",
  MATCH: "match",
  EMAIL_GENERATION: "email-generation",
  EMAIL_SEND: "email-send",
  AGENT_RUN: "agent-run",
  MAINTENANCE: "maintenance",
  DEAD_LETTER: "dead-letter",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  "source-crawl": { sourceConnectorId: string; trigger: "SCHEDULED" | "MANUAL" | "NEW_SOURCE" };
  "job-embed": { jobIds: string[] };
  "resume-process": { tenantId: string; userId: string; resumeId: string };
  match: { tenantId: string; userId: string; trigger: string };
  "email-generation": { tenantId: string; userId: string; window: string; windowLabel: "morning" | "evening" };
  "agent-run": { tenantId: string; userId: string; runKey: string };
  "email-send": { tenantId: string; userId: string; notificationId: string };
  maintenance: { task: "tick" | "retention" };
  "dead-letter": { queue: string; jobId: string | undefined; name: string; data: unknown; error: string; failedAt: string };
}

/** Default retry policy per queue. Crawls manage their own source-level backoff (PRD §46). */
export const DEFAULT_OPTIONS: Record<QueueName, JobsOptions> = {
  "source-crawl": { attempts: 1, removeOnComplete: { age: 86_400, count: 1000 }, removeOnFail: { age: 7 * 86_400 } },
  "job-embed": { attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { age: 7 * 86_400 } },
  "resume-process": { attempts: 3, backoff: { type: "exponential", delay: 20_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { age: 7 * 86_400 } },
  match: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { age: 7 * 86_400 } },
  "email-generation": { attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: { count: 5000 }, removeOnFail: { age: 14 * 86_400 } },
  // Manual runs report failures to the user rather than retrying silently.
  "agent-run": { attempts: 1, removeOnComplete: { count: 1000 }, removeOnFail: { age: 7 * 86_400 } },
  "email-send": { attempts: 6, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: { count: 5000 }, removeOnFail: { age: 14 * 86_400 } },
  maintenance: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
  "dead-letter": { attempts: 1, removeOnComplete: false, removeOnFail: false },
};

const connection = createRedis("queues");
const queues = new Map<QueueName, Queue>();

export function queue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection, defaultJobOptions: DEFAULT_OPTIONS[name] });
    queues.set(name, q);
  }
  return q as unknown as Queue<JobPayloads[N]>;
}

/** Adds a job. A deterministic `jobId` makes enqueueing idempotent (PRD §128). */
export async function enqueue<N extends QueueName>(name: N, data: JobPayloads[N], opts: JobsOptions = {}): Promise<void> {
  // BullMQ job ids may not contain ":"; normalise any caller-provided id.
  const jobId = opts.jobId?.replace(/:/g, "_");
  await (queue(name) as Queue).add(name, data, { ...opts, ...(jobId ? { jobId } : {}) });
}

export async function queueDepths(): Promise<{ queue: string; waiting: number; active: number; delayed: number; failed: number }[]> {
  return Promise.all(
    Object.values(QUEUES).map(async (name) => {
      const c = await queue(name).getJobCounts("waiting", "active", "delayed", "failed");
      return { queue: name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
    }),
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  await connection.quit().catch(() => undefined);
}
