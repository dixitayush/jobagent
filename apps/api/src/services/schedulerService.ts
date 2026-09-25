import { embeddingProvider } from "../ai/embeddings";
import { query } from "../db/pool";
import { dueWindows, windowStartingWithin, type DigestSchedule } from "../domain/schedule";
import { logger } from "../lib/logger";
import { enqueue } from "../queue/queues";
import { getSettings } from "../settings/platformSettings";
import { dueSources, reextractStaleJobs } from "./crawlService";

interface UserSchedule extends DigestSchedule {
  tenantId: string;
  userId: string;
}

async function activeUserSchedules(): Promise<UserSchedule[]> {
  return query<UserSchedule>(
    `SELECT u.tenant_id AS "tenantId", u.id AS "userId", u.timezone,
            ns.morning_enabled AS "morningEnabled", ns.morning_time AS "morningTime",
            ns.evening_enabled AS "eveningEnabled", ns.evening_time AS "eveningTime"
     FROM users u JOIN notification_settings ns ON ns.user_id = u.id AND ns.tenant_id = u.tenant_id
     WHERE ns.email_enabled AND (ns.morning_enabled OR ns.evening_enabled)
       AND EXISTS (SELECT 1 FROM candidate_profiles cp WHERE cp.user_id = u.id AND cp.is_active)`,
  );
}

/**
 * The scheduler only *enqueues* work (PRD §58). Crawling, matching and email happen in
 * workers. Job ids are deterministic so overlapping ticks never duplicate work.
 */
export async function schedulerTick(now = new Date()): Promise<{ crawls: number; digests: number }> {
  const settings = await getSettings();
  let crawls = 0;
  let digests = 0;

  const slot = Math.floor(now.getTime() / (10 * 60_000));
  if (!settings.crawlingPaused) {
    for (const id of await dueSources()) {
      await enqueue("source-crawl", { sourceConnectorId: id, trigger: "SCHEDULED" }, { jobId: `crawl:${id}:${slot}` });
      crawls++;
    }
  }

  // Runs whose worker died mid-flight (redeploy, crash) are retried by the queue; close their records.
  await query(
    "UPDATE agent_runs SET status = 'FAILED', completed_at = now(), error = 'Interrupted (worker restarted)' WHERE status = 'RUNNING' AND started_at < now() - interval '30 minutes'",
  );

  // Upgrade rule-based requirement extraction after the rules change (bounded per tick).
  await reextractStaleJobs(500);

  // Backfill embeddings for open jobs missing one for the active embedding model (new jobs,
  // or after switching providers). Bounded per tick; embedJobs skips anything already current.
  const { model } = await embeddingProvider();
  const stale = await query<{ id: string }>(
    `SELECT j.id FROM jobs j LEFT JOIN job_embeddings e ON e.job_id = j.id
     WHERE j.status = 'OPEN' AND j.duplicate_of IS NULL AND (e.job_id IS NULL OR e.model <> $1)
     ORDER BY j.first_seen_at DESC LIMIT 500`,
    [model],
  );
  for (let i = 0; i < stale.length; i += 50) {
    const batch = stale.slice(i, i + 50).map((r) => r.id);
    await enqueue("job-embed", { jobIds: batch }, { jobId: `reembed:${model}:${batch[0]}` });
  }

  const users = await activeUserSchedules();
  for (const u of users) {
    // Refresh this user's sources shortly before their digest so it contains the newest jobs.
    if (!settings.crawlingPaused && windowStartingWithin(u, 45, now)) {
      const stale = await query<{ id: string }>(
        `SELECT s.id FROM source_connectors s JOIN job_sources js ON js.source_connector_id = s.id
         WHERE js.user_id = $1 AND js.tenant_id = $2 AND js.status = 'ACTIVE' AND s.status IN ('ACTIVE','DEGRADED')
           AND (s.last_crawled_at IS NULL OR s.last_crawled_at < now() - interval '2 hours') AND s.next_crawl_at > now()`,
        [u.userId, u.tenantId],
      );
      for (const s of stale) {
        await enqueue("source-crawl", { sourceConnectorId: s.id, trigger: "SCHEDULED" }, { jobId: `crawl:${s.id}:${slot}` });
        crawls++;
      }
    }
    if (settings.notificationsPaused) continue;
    for (const w of dueWindows(u, now)) {
      const exists = await query("SELECT 1 FROM notifications WHERE user_id = $1 AND notification_window = $2", [u.userId, w.window]);
      if (exists.length) continue;
      await enqueue("email-generation", { tenantId: u.tenantId, userId: u.userId, window: w.window, windowLabel: w.label }, { jobId: `digest:${u.userId}:${w.window}` });
      digests++;
    }
  }
  if (crawls || digests) logger.info({ event: "SCHEDULER_TICK", crawls, digests }, "scheduler enqueued work");
  return { crawls, digests };
}

/**
 * New or changed jobs → refresh matches for every user tracking their sources, so the
 * dashboard updates without waiting for the next digest. One delayed run per user per
 * 5-minute slot lets all embedding batches of a crawl land first.
 */
export async function enqueueMatchesForJobs(jobIds: string[]): Promise<void> {
  if (!jobIds.length) return;
  const users = await query<{ tenant_id: string; user_id: string }>(
    `SELECT DISTINCT js.tenant_id, js.user_id FROM job_sources js
     WHERE js.status = 'ACTIVE' AND js.source_connector_id IN (SELECT DISTINCT source_connector_id FROM jobs WHERE id = ANY($1::uuid[]))`,
    [jobIds],
  );
  const slot = Math.floor(Date.now() / 300_000);
  for (const u of users) {
    await enqueue("match", { tenantId: u.tenant_id, userId: u.user_id, trigger: "NEW_JOBS" }, { jobId: `match:${u.user_id}:jobs:${slot}`, delay: 60_000 });
  }
}

/** PRD §66 configurable retention. */
export async function applyRetention(): Promise<void> {
  const { retentionDays } = await getSettings();
  await query("DELETE FROM agent_runs WHERE started_at < now() - make_interval(days => $1)", [retentionDays.agentLogs]);
  await query("DELETE FROM llm_requests WHERE created_at < now() - make_interval(days => $1)", [retentionDays.llmRequests]);
  await query("DELETE FROM llm_cache WHERE updated_at < now() - interval '120 days'");
  await query("DELETE FROM audit_logs WHERE created_at < now() - interval '365 days'");
  await query("UPDATE jobs SET status = 'CLOSED', closed_at = now() WHERE status = 'OPEN' AND last_seen_at < now() - interval '60 days'");
  // Duplicates of closed jobs become the visible copy.
  await query("UPDATE jobs d SET duplicate_of = NULL FROM jobs c WHERE d.duplicate_of = c.id AND c.status = 'CLOSED' AND d.status = 'OPEN'");
  logger.info({ event: "RETENTION_APPLIED", retentionDays }, "retention applied");
}
