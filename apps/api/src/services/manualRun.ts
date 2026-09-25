import { DateTime } from "luxon";
import type { ManualRunState } from "@jobagent/shared";
import { embeddingProvider } from "../ai/embeddings";
import { runDigestAgent } from "../agent/digestGraph";
import { query, queryOne } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { conflict } from "../lib/errors";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { enqueue } from "../queue/queues";
import { crawlSource } from "./crawlService";
import { embedJobs } from "./embeddingService";

/**
 * "Run agent now": crawl the user's sources → embed → match → email new matches, on demand.
 * Progress lives in short-term agent memory (PRD §30: Redis `agent:user:{userId}:state`).
 */

const FRESH_MS = 10 * 60_000; // sources crawled this recently are reused, not re-crawled
const CRAWL_CONCURRENCY = 3;
const STATE_TTL = 24 * 3600;

const stateKey = (userId: string) => `agent:user:${userId}:state`;

export async function getManualRunState(userId: string): Promise<ManualRunState | null> {
  const raw = await redis().get(stateKey(userId));
  return raw ? (JSON.parse(raw) as ManualRunState) : null;
}

async function saveState(userId: string, state: ManualRunState): Promise<ManualRunState> {
  await redis().set(stateKey(userId), JSON.stringify(state), "EX", STATE_TTL);
  return state;
}

const isActive = (s: ManualRunState | null) => !!s && !["DONE", "FAILED"].includes(s.step) && Date.now() - new Date(s.startedAt).getTime() < 30 * 60_000;

/** Queues a run. One active run per user; the API additionally rate-limits requests. */
export async function startManualRun(ctx: TenantContext): Promise<ManualRunState> {
  if (isActive(await getManualRunState(ctx.userId))) throw conflict("The agent is already running for you");
  const runKey = `${ctx.userId}:${Date.now()}`;
  const state = await saveState(ctx.userId, {
    runKey,
    step: "QUEUED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sourcesTotal: 0,
    sourcesCrawled: 0,
    sourcesSkippedFresh: 0,
    sourcesFailed: [],
    newJobs: 0,
    matched: 0,
    emailedJobs: 0,
    emailStatus: "PENDING",
    message: "Queued",
  });
  await enqueue("agent-run", { ...ctx, runKey }, { jobId: `agent-run:${runKey}` });
  return state;
}

export async function runManualPipeline(ctx: TenantContext, runKey: string): Promise<ManualRunState> {
  let state = (await getManualRunState(ctx.userId)) ?? ({ runKey } as ManualRunState);
  const update = async (patch: Partial<ManualRunState>) => (state = await saveState(ctx.userId, { ...state, ...patch, runKey }));

  try {
    // 1. Crawl every active source the user tracks (shared sources crawled recently are reused).
    const sources = await query<{ id: string; name: string; last_crawled_at: Date | null; status: string }>(
      `SELECT s.id, js.display_name AS name, s.last_crawled_at, s.status FROM job_sources js
       JOIN source_connectors s ON s.id = js.source_connector_id
       WHERE js.tenant_id = $1 AND js.user_id = $2 AND js.status = 'ACTIVE' AND s.status IN ('ACTIVE', 'DEGRADED')`,
      [ctx.tenantId, ctx.userId],
    );
    const stale = sources.filter((s) => !s.last_crawled_at || Date.now() - s.last_crawled_at.getTime() > FRESH_MS);
    await update({
      step: "CRAWLING",
      sourcesTotal: sources.length,
      sourcesSkippedFresh: sources.length - stale.length,
      message: stale.length ? `Checking ${stale.length} career page${stale.length === 1 ? "" : "s"} for new jobs…` : "All sources were checked in the last few minutes",
    });
    const queue = [...stale];
    let newJobs = 0;
    let crawled = 0;
    const failed: string[] = [];
    await Promise.all(
      Array.from({ length: Math.min(CRAWL_CONCURRENCY, queue.length) }, async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
          const summary = await crawlSource(s.id, "MANUAL");
          crawled++;
          if (summary.status === "FAILED") failed.push(s.name);
          newJobs += summary.newJobs + summary.updated;
          await update({ sourcesCrawled: crawled, sourcesFailed: failed, newJobs, message: `Checked ${crawled} of ${stale.length} career pages…` });
        }
      }),
    );

    // 2. Embed anything new now (instead of waiting for the background queue) so matching sees it.
    const { model } = await embeddingProvider();
    const unembedded = await query<{ id: string }>(
      `SELECT j.id FROM jobs j LEFT JOIN job_embeddings e ON e.job_id = j.id
       WHERE j.status = 'OPEN' AND j.duplicate_of IS NULL AND (e.job_id IS NULL OR e.model <> $2)
         AND j.source_connector_id IN (SELECT source_connector_id FROM job_sources WHERE user_id = $1 AND status = 'ACTIVE')`,
      [ctx.userId, model],
    );
    await update({ step: "MATCHING", message: "Matching new jobs against your profile…" });
    for (let i = 0; i < unembedded.length; i += 50) await embedJobs(unembedded.slice(i, i + 50).map((r) => r.id));

    // 3. Match + email new matches (manual digest: sends immediately, never repeats jobs already sent).
    const tz = (await queryOne<{ timezone: string }>("SELECT timezone FROM users WHERE id = $1 AND tenant_id = $2", [ctx.userId, ctx.tenantId]))?.timezone ?? "Asia/Kolkata";
    const local = DateTime.now().setZone(tz);
    const window = `${local.toISODate()}:manual-${local.toFormat("HHmmss")}`;
    await update({ step: "EMAILING", message: "Preparing your email…" });
    const digest = await runDigestAgent(ctx, window, "manual");

    const emailStatus: ManualRunState["emailStatus"] =
      digest.outcome === "SENT" ? "SENT" : digest.reason === "EMAIL_DISABLED" ? "DISABLED" : digest.reason === "NO_NEW_MATCHES" ? "NOTHING_NEW" : "FAILED";
    const sentences = [
      newJobs ? `Found ${newJobs} new or updated ${newJobs === 1 ? "job" : "jobs"}` : "No new openings since the last check",
      emailStatus === "SENT" ? `Emailed you ${digest.jobs} new ${digest.jobs === 1 ? "match" : "matches"}` : null,
      emailStatus === "NOTHING_NEW" ? "Nothing new to email since your last digest" : null,
      emailStatus === "DISABLED" ? "Email is turned off in Email digests" : null,
      emailStatus === "FAILED" ? `The email wasn't sent (${digest.reason ?? "unknown reason"})` : null,
      failed.length ? `${failed.length} ${failed.length === 1 ? "company" : "companies"} couldn't be reached` : null,
    ].filter(Boolean);
    return await update({ step: "DONE", finishedAt: new Date().toISOString(), matched: digest.matched, emailedJobs: digest.jobs, emailStatus, message: sentences.join(". ") });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ event: "MANUAL_RUN_FAILED", userId: ctx.userId, err: message }, "manual agent run failed");
    return await update({ step: "FAILED", finishedAt: new Date().toISOString(), emailStatus: state.emailStatus === "PENDING" ? "FAILED" : state.emailStatus, message: `Run failed: ${message.slice(0, 200)}` });
  }
}
