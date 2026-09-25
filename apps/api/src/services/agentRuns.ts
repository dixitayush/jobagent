import { query, queryOne } from "../db/pool";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

export type RunType = "CRAWL" | "MATCH" | "NOTIFY" | "RESUME";

export interface RunCounters {
  jobsDiscovered?: number;
  jobsFiltered?: number;
  jobsMatched?: number;
  jobsSelected?: number;
  emailsSent?: number;
  tokensUsed?: number;
  estimatedCost?: number;
}

/** PRD §60 agent run tracking. */
export async function startRun(type: RunType, opts: { tenantId?: string | null; userId?: string | null; sourceConnectorId?: string | null; trigger?: string }): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agent_runs (type, tenant_id, user_id, source_connector_id, trigger) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [type, opts.tenantId ?? null, opts.userId ?? null, opts.sourceConnectorId ?? null, opts.trigger ?? "SCHEDULED"],
  );
  return row!.id;
}

export async function runEvent(runId: string, event: string, data: Record<string, unknown> = {}): Promise<void> {
  await query("INSERT INTO agent_events (agent_run_id, event, data) VALUES ($1, $2, $3)", [runId, event, JSON.stringify(data)]).catch((err) =>
    logger.warn({ err: err.message }, "failed to record agent event"),
  );
}

export async function finishRun(runId: string, type: RunType, status: "SUCCEEDED" | "FAILED" | "SKIPPED", counters: RunCounters = {}, error?: string): Promise<void> {
  await query(
    `UPDATE agent_runs SET status = $2, completed_at = now(),
       jobs_discovered = $3, jobs_filtered = $4, jobs_matched = $5, jobs_selected = $6, emails_sent = $7,
       tokens_used = $8, estimated_cost = $9, error = $10
     WHERE id = $1`,
    [
      runId,
      status,
      counters.jobsDiscovered ?? 0,
      counters.jobsFiltered ?? 0,
      counters.jobsMatched ?? 0,
      counters.jobsSelected ?? 0,
      counters.emailsSent ?? 0,
      counters.tokensUsed ?? 0,
      counters.estimatedCost ?? 0,
      error?.slice(0, 1000) ?? null,
    ],
  );
  metrics.agentRuns.inc({ type, status });
}
