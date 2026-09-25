import { query, queryOne } from "../db/pool";
import { queueDepths, queue, QUEUES } from "../queue/queues";
import { toHealth } from "./sourceService";

/** PRD §72 admin overview. */
export async function adminOverview() {
  const s = await queryOne<{
    total_users: number;
    active_users: number;
    jobs_total: number;
    jobs_today: number;
    llm_cost_24h: number;
    llm_cost_30d: number;
    llm_calls_24h: number;
    llm_errors_24h: number;
    emails_24h: number;
    email_failures_24h: number;
    runs_failed_24h: number;
    runs_24h: number;
    sources_total: number;
    sources_degraded: number;
  }>(
    `SELECT
      (SELECT count(*)::int FROM users) AS total_users,
      (SELECT count(*)::int FROM users WHERE last_login_at > now() - interval '30 days') AS active_users,
      (SELECT count(*)::int FROM jobs WHERE status = 'OPEN' AND duplicate_of IS NULL) AS jobs_total,
      (SELECT count(*)::int FROM jobs WHERE first_seen_at > now() - interval '24 hours') AS jobs_today,
      (SELECT COALESCE(sum(estimated_cost), 0)::float FROM llm_requests WHERE created_at > now() - interval '24 hours') AS llm_cost_24h,
      (SELECT COALESCE(sum(estimated_cost), 0)::float FROM llm_requests WHERE created_at > now() - interval '30 days') AS llm_cost_30d,
      (SELECT count(*)::int FROM llm_requests WHERE created_at > now() - interval '24 hours' AND NOT cached) AS llm_calls_24h,
      (SELECT count(*)::int FROM llm_requests WHERE created_at > now() - interval '24 hours' AND NOT success) AS llm_errors_24h,
      (SELECT count(*)::int FROM email_deliveries WHERE status = 'SENT' AND updated_at > now() - interval '24 hours') AS emails_24h,
      (SELECT count(*)::int FROM email_deliveries WHERE status = 'FAILED' AND updated_at > now() - interval '24 hours') AS email_failures_24h,
      (SELECT count(*)::int FROM agent_runs WHERE status = 'FAILED' AND started_at > now() - interval '24 hours') AS runs_failed_24h,
      (SELECT count(*)::int FROM agent_runs WHERE started_at > now() - interval '24 hours') AS runs_24h,
      (SELECT count(*)::int FROM source_connectors) AS sources_total,
      (SELECT count(*)::int FROM source_connectors WHERE status = 'DEGRADED') AS sources_degraded`,
  );
  const opens = await queryOne<{ sent: number; opened: number; clicked: number }>(
    `SELECT count(*)::int AS sent, count(opened_at)::int AS opened, count(clicked_at)::int AS clicked
     FROM email_deliveries WHERE status = 'SENT' AND created_at > now() - interval '30 days'`,
  );
  const llmByModel = await query<{ model: string; purpose: string; calls: number; cost: number; avg_latency: number }>(
    `SELECT model, purpose, count(*)::int AS calls, COALESCE(sum(estimated_cost), 0)::float AS cost, COALESCE(avg(latency_ms), 0)::int AS avg_latency
     FROM llm_requests WHERE created_at > now() - interval '7 days' AND NOT cached GROUP BY model, purpose ORDER BY cost DESC`,
  );
  return {
    ...s,
    errorRate24h: s && s.runs_24h ? s.runs_failed_24h / s.runs_24h : 0,
    email30d: opens,
    llmByModel,
    queues: await queueDepths(),
  };
}

export async function adminSources() {
  const rows = await query<{
    id: string;
    company: string;
    connector_type: string;
    source_url: string;
    status: string;
    crawl_interval_minutes: number;
    rate_limit_per_minute: number;
    max_concurrency: number;
    crawl_delay_ms: number;
    subscribers: number;
    last_crawled_at: Date | null;
    last_success_at: Date | null;
    last_failure_at: Date | null;
    last_http_status: number | null;
    last_error: string | null;
    jobs_found: number;
    avg_crawl_ms: number | null;
    failure_count: number;
    consecutive_failures: number;
    next_crawl_at: Date | null;
  }>(
    `SELECT s.*, c.name AS company, (SELECT count(*)::int FROM job_sources js WHERE js.source_connector_id = s.id AND js.status = 'ACTIVE') AS subscribers
     FROM source_connectors s JOIN companies c ON c.id = s.company_id ORDER BY s.status DESC, c.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    connectorType: r.connector_type,
    sourceUrl: r.source_url,
    status: r.status,
    crawlIntervalMinutes: r.crawl_interval_minutes,
    rateLimitPerMinute: r.rate_limit_per_minute,
    maxConcurrency: r.max_concurrency,
    crawlDelayMs: r.crawl_delay_ms,
    subscribers: r.subscribers,
    health: toHealth(r),
  }));
}

export async function updateAdminSource(
  id: string,
  p: { status?: string; crawlIntervalMinutes?: number; rateLimitPerMinute?: number; maxConcurrency?: number; crawlDelayMs?: number },
): Promise<boolean> {
  const rows = await query(
    `UPDATE source_connectors SET status = COALESCE($2, status), crawl_interval_minutes = COALESCE($3, crawl_interval_minutes),
       rate_limit_per_minute = COALESCE($4, rate_limit_per_minute), max_concurrency = COALESCE($5, max_concurrency),
       crawl_delay_ms = COALESCE($6, crawl_delay_ms),
       consecutive_failures = CASE WHEN $2 = 'ACTIVE' THEN 0 ELSE consecutive_failures END,
       next_crawl_at = CASE WHEN $2 = 'ACTIVE' THEN now() ELSE next_crawl_at END
     WHERE id = $1 RETURNING id`,
    [id, p.status ?? null, p.crawlIntervalMinutes ?? null, p.rateLimitPerMinute ?? null, p.maxConcurrency ?? null, p.crawlDelayMs ?? null],
  );
  return rows.length > 0;
}

export async function recentRuns(limit = 50) {
  return query(
    `SELECT r.id, r.type, r.trigger, r.status, r.started_at, r.completed_at, r.jobs_discovered, r.jobs_filtered, r.jobs_matched, r.jobs_selected,
            r.tokens_used, r.estimated_cost::float, r.error, u.email AS user_email, c.name AS company
     FROM agent_runs r LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN source_connectors s ON s.id = r.source_connector_id LEFT JOIN companies c ON c.id = s.company_id
     ORDER BY r.started_at DESC LIMIT $1`,
    [limit],
  );
}

export async function deadLetters(limit = 50) {
  const jobs = await queue(QUEUES.DEAD_LETTER).getJobs(["waiting", "completed", "failed"], 0, limit - 1);
  return jobs.map((j) => ({ id: j.id, queue: j.data.queue, name: j.data.name, error: j.data.error, failedAt: j.data.failedAt }));
}
