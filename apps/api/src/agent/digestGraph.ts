import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { MATCH_LEVEL_ORDER, type MatchLevel } from "@jobagent/shared";
import { query, queryOne, withTransaction } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { logger } from "../lib/logger";
import { enqueue } from "../queue/queues";
import { finishRun, runEvent, startRun } from "../services/agentRuns";
import { sendDigestEmail } from "../services/emailService";
import { getSettings, planLimits } from "../settings/platformSettings";
import { runMatchingAgent } from "./matchingGraph";

interface Selected {
  jobId: string;
  jobVersion: number;
  score: number;
  matchLevel: MatchLevel;
}

const replace = <T>(fallback: () => T) => Annotation<T>({ reducer: (_p, n) => n, default: fallback });

/** "manual" = user pressed "Run agent now": no schedule/window checks, email sent immediately. */
export type DigestWindowLabel = "morning" | "evening" | "manual";

export interface DigestOutcome {
  outcome: "SKIPPED" | "QUEUED" | "SENT";
  reason: string | null;
  jobs: number;
  matched: number;
}

/** Notification Agent state (PRD §34 pipeline). */
const DigestState = Annotation.Root({
  ctx: Annotation<TenantContext>(),
  window: Annotation<string>(),
  windowLabel: Annotation<DigestWindowLabel>(),
  runId: Annotation<string>(),
  limit: replace<number>(() => 10),
  minLevel: replace<MatchLevel>(() => "GOOD"),
  includeRecent: replace<boolean>(() => false),
  selected: replace<Selected[]>(() => []),
  notificationId: replace<string | null>(() => null),
  outcome: replace<"PENDING" | "SKIPPED" | "QUEUED" | "SENT">(() => "PENDING"),
  matched: replace<number>(() => 0),
  reason: replace<string | null>(() => null),
  tokens: replace<number>(() => 0),
  cost: replace<number>(() => 0),
});
type S = typeof DigestState.State;

/** Checks platform switches, user settings and plan limits before doing any work. */
async function checkEligibility(s: S): Promise<Partial<S>> {
  const settings = await getSettings();
  if (settings.notificationsPaused) return { outcome: "SKIPPED", reason: "NOTIFICATIONS_PAUSED" };
  const row = await queryOne<{
    plan: string;
    email_enabled: boolean;
    morning_enabled: boolean;
    evening_enabled: boolean;
    jobs_per_notification: number;
    min_match_level: MatchLevel;
    include_recent_jobs: boolean | null;
  }>(
    `SELECT t.plan, ns.email_enabled, ns.morning_enabled, ns.evening_enabled, ns.jobs_per_notification, ns.min_match_level, p.include_recent_jobs
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     JOIN notification_settings ns ON ns.user_id = u.id AND ns.tenant_id = u.tenant_id
     LEFT JOIN user_preferences p ON p.user_id = u.id AND p.tenant_id = u.tenant_id
     WHERE u.id = $2 AND u.tenant_id = $1`,
    [s.ctx.tenantId, s.ctx.userId],
  );
  const manual = s.windowLabel === "manual";
  if (!row) return { outcome: "SKIPPED", reason: "NO_SETTINGS" };
  if (!row.email_enabled) {
    // A manual run still refreshes matches for the dashboard; it just doesn't email.
    if (manual) {
      const summary = await runMatchingAgent(s.ctx, "MANUAL_RUN");
      return { outcome: "SKIPPED", reason: "EMAIL_DISABLED", matched: summary.matched, tokens: summary.tokens, cost: summary.cost };
    }
    return { outcome: "SKIPPED", reason: "EMAIL_DISABLED" };
  }
  if ((s.windowLabel === "morning" && !row.morning_enabled) || (s.windowLabel === "evening" && !row.evening_enabled)) return { outcome: "SKIPPED", reason: "WINDOW_DISABLED" };
  const plan = await planLimits(row.plan);
  // Manual runs are user-initiated and rate-limited at the API; they don't use the scheduled-digest quota.
  if (manual) {
    return {
      limit: Math.max(1, Math.min(row.jobs_per_notification, plan.maxJobsPerNotification, settings.maxJobsPerNotification)),
      minLevel: row.min_match_level,
      includeRecent: row.include_recent_jobs ?? false,
    };
  }
  const today = s.window.split(":")[0]!;
  const sentToday = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND notification_window LIKE $3 AND notification_window NOT LIKE '%:manual%' AND status = 'SENT'",
    [s.ctx.tenantId, s.ctx.userId, `${today}:%`],
  );
  if ((sentToday?.n ?? 0) >= plan.notificationsPerDay) return { outcome: "SKIPPED", reason: "DAILY_LIMIT" };
  return {
    limit: Math.max(1, Math.min(row.jobs_per_notification, plan.maxJobsPerNotification, settings.maxJobsPerNotification)),
    minLevel: row.min_match_level,
    includeRecent: row.include_recent_jobs ?? false,
  };
}

/** Refreshes matches so the digest reflects the latest crawl. */
async function refreshMatches(s: S): Promise<Partial<S>> {
  const summary = await runMatchingAgent(s.ctx, s.windowLabel === "manual" ? "MANUAL_RUN" : `DIGEST_${s.windowLabel.toUpperCase()}`);
  if (summary.status === "SKIPPED") return { outcome: "SKIPPED", reason: "NO_PROFILE" };
  return { tokens: summary.tokens, cost: summary.cost, matched: summary.matched };
}

/**
 * Select top N fresh jobs (PRD §34–35). Never re-sends a job unless it materially changed
 * since it was last sent (job version increased) — PRD §69–70.
 */
async function selectTopJobs(s: S): Promise<Partial<S>> {
  const allowed = MATCH_LEVEL_ORDER.slice(0, MATCH_LEVEL_ORDER.indexOf(s.minLevel) + 1);
  const rows = await query<{ job_id: string; version: number; score: number; match_level: MatchLevel }>(
    `SELECT m.job_id, j.version, m.score, m.match_level
     FROM job_matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.tenant_id = $1 AND m.user_id = $2 AND j.status = 'OPEN' AND j.duplicate_of IS NULL
       AND m.match_level = ANY($3::text[])
       AND (LEAST(j.first_seen_at, COALESCE(j.posted_at, j.first_seen_at)) > now() - make_interval(hours => $4)
            OR j.content_updated_at > now() - interval '24 hours')
       AND NOT EXISTS (SELECT 1 FROM dismissed_jobs d WHERE d.tenant_id = $1 AND d.user_id = $2 AND d.job_id = j.id)
       AND NOT EXISTS (SELECT 1 FROM notification_jobs nj WHERE nj.tenant_id = $1 AND nj.user_id = $2 AND nj.job_id = j.id AND nj.job_version >= j.version)
     ORDER BY m.rank_score DESC, m.score DESC
     LIMIT $5`,
    [s.ctx.tenantId, s.ctx.userId, allowed, s.includeRecent ? 24 * 7 : 24, s.limit],
  );
  if (!rows.length) return { outcome: "SKIPPED", reason: "NO_NEW_MATCHES" };
  return { selected: rows.map((r) => ({ jobId: r.job_id, jobVersion: r.version, score: r.score, matchLevel: r.match_level })) };
}

/** Records the notification + its jobs atomically; unique keys make this idempotent. */
async function compose(s: S): Promise<Partial<S>> {
  const id = await withTransaction(async (client) => {
    const created = (
      await client.query<{ id: string }>(
        `INSERT INTO notifications (tenant_id, user_id, notification_window, job_count) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, notification_window) DO NOTHING RETURNING id`,
        [s.ctx.tenantId, s.ctx.userId, s.window, s.selected.length],
      )
    ).rows[0];
    if (!created) return null;
    let pos = 0;
    for (const j of s.selected) {
      await client.query(
        `INSERT INTO notification_jobs (tenant_id, user_id, notification_id, job_id, notification_window, job_version, position, score, match_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, job_id, notification_window) DO NOTHING`,
        [s.ctx.tenantId, s.ctx.userId, created.id, j.jobId, s.window, j.jobVersion, pos++, j.score, j.matchLevel],
      );
    }
    return created.id;
  });
  if (!id) return { outcome: "SKIPPED", reason: "ALREADY_GENERATED" };
  return { notificationId: id };
}

async function dispatch(s: S): Promise<Partial<S>> {
  if (s.windowLabel === "manual") {
    // The user is watching the progress panel: send now; a failure surfaces in the run status.
    await sendDigestEmail(s.ctx, s.notificationId!);
    return { outcome: "SENT" };
  }
  await enqueue("email-send", { ...s.ctx, notificationId: s.notificationId! }, { jobId: `email:${s.notificationId}` });
  return { outcome: "QUEUED" };
}

const next = (target: string) => (s: S) => (s.outcome === "SKIPPED" ? END : target);

export const digestGraph = new StateGraph(DigestState)
  .addNode("checkEligibility", checkEligibility)
  .addNode("refreshMatches", refreshMatches)
  .addNode("selectTopJobs", selectTopJobs)
  .addNode("compose", compose)
  .addNode("dispatch", dispatch)
  .addEdge(START, "checkEligibility")
  .addConditionalEdges("checkEligibility", next("refreshMatches"))
  .addConditionalEdges("refreshMatches", next("selectTopJobs"))
  .addConditionalEdges("selectTopJobs", next("compose"))
  .addConditionalEdges("compose", next("dispatch"))
  .addEdge("dispatch", END)
  .compile();

export async function runDigestAgent(ctx: TenantContext, window: string, windowLabel: DigestWindowLabel): Promise<DigestOutcome> {
  const runId = await startRun("NOTIFY", { ...ctx, trigger: window });
  try {
    const final = await digestGraph.invoke({ ctx, window, windowLabel, runId }, { runName: "job-digest-agent" });
    await runEvent(runId, "DIGEST", { outcome: final.outcome, reason: final.reason, selected: final.selected.length });
    if (final.outcome === "SKIPPED" && final.reason === "NO_NEW_MATCHES") {
      // Record the empty window so the scheduler doesn't retry it all hour.
      await query(
        `INSERT INTO notifications (tenant_id, user_id, notification_window, status, job_count) VALUES ($1, $2, $3, 'SKIPPED', 0)
         ON CONFLICT (user_id, notification_window) DO NOTHING`,
        [ctx.tenantId, ctx.userId, window],
      );
    }
    await finishRun(runId, "NOTIFY", final.outcome === "SKIPPED" ? "SKIPPED" : "SUCCEEDED", { jobsSelected: final.selected.length, tokensUsed: final.tokens, estimatedCost: final.cost }, final.reason ?? undefined);
    return { outcome: final.outcome === "PENDING" ? "SKIPPED" : final.outcome, reason: final.reason, jobs: final.selected.length, matched: final.matched };
  } catch (err) {
    logger.error({ err: (err as Error).message, window }, "digest agent failed");
    await finishRun(runId, "NOTIFY", "FAILED", {}, (err as Error).message);
    throw err;
  }
}
