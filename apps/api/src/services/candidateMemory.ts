import { DISMISS_REASON_LABELS, type DismissReason } from "@jobagent/shared";
import { query, queryOne } from "../db/pool";
import type { TenantContext } from "../db/tenant";

/**
 * Agent memory (PRD §30) used as LLM context:
 * - long-term: a distilled summary of the user's own decisions (saved / applied / dismissed with
 *   reasons / thumbs feedback), persisted in `agent_memory` and rebuilt from user_interactions;
 * - semantic: for a given job, the user's past decisions on the most similar jobs (pgvector).
 * Short-term run state lives in Redis (see manualRun). Memory is advisory only: it informs the
 * LLM's preferenceFit, never the resume facts or hard filters.
 */

const POSITIVE = ["JOB_SAVED", "JOB_APPLIED", "FEEDBACK_GOOD"] as const;
const NEGATIVE = ["JOB_DISMISSED", "FEEDBACK_BAD"] as const;
const REFRESH_AFTER_MS = 15 * 60_000;

export interface InteractionRow {
  type: string;
  reason: string | null;
  title: string;
  company: string;
  skills: string[];
}

export interface CandidateMemory {
  signalCount: number;
  positive: number;
  negative: number;
  likedSkills: { skill: string; count: number }[];
  likedTitles: string[];
  likedCompanies: string[];
  dismissReasons: { reason: string; count: number }[];
  dislikedTitles: string[];
  dislikedCompanies: string[];
}

const top = <T extends string>(items: T[], n: number) => {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
};

/** Pure aggregation (unit-tested). Latest decision per job wins upstream. */
export function summarizeMemory(rows: InteractionRow[]): CandidateMemory {
  const pos = rows.filter((r) => (POSITIVE as readonly string[]).includes(r.type));
  const neg = rows.filter((r) => (NEGATIVE as readonly string[]).includes(r.type));
  return {
    signalCount: pos.length + neg.length,
    positive: pos.length,
    negative: neg.length,
    likedSkills: top(pos.flatMap((r) => r.skills), 10).map(([skill, count]) => ({ skill, count })),
    likedTitles: top(pos.map((r) => r.title), 5).map(([t]) => t),
    likedCompanies: top(pos.map((r) => r.company), 5).map(([c]) => c),
    dismissReasons: top(neg.map((r) => r.reason).filter((r): r is string => !!r), 6).map(([reason, count]) => ({ reason, count })),
    dislikedTitles: top(neg.map((r) => r.title), 5).map(([t]) => t),
    dislikedCompanies: top(neg.map((r) => r.company), 5).map(([c]) => c),
  };
}

/** Compact, model-friendly rendering (kept stable so it stays in the cached prompt prefix). */
export function memoryToText(m: CandidateMemory | null): string {
  if (!m || m.signalCount === 0) return "No activity history yet.";
  const lines = [`Signals: ${m.positive} positive (saved/applied/helpful), ${m.negative} negative (dismissed/not relevant).`];
  if (m.likedSkills.length) lines.push(`Skills common in jobs they liked: ${m.likedSkills.map((s) => `${s.skill} (${s.count})`).join(", ")}.`);
  if (m.likedTitles.length) lines.push(`Titles they liked: ${m.likedTitles.join("; ")}.`);
  if (m.likedCompanies.length) lines.push(`Companies they engaged with: ${m.likedCompanies.join(", ")}.`);
  if (m.dismissReasons.length)
    lines.push(`Why they dismissed jobs: ${m.dismissReasons.map((d) => `${DISMISS_REASON_LABELS[d.reason as DismissReason] ?? d.reason} (${d.count})`).join(", ")}.`);
  if (m.dislikedTitles.length) lines.push(`Titles they dismissed: ${m.dislikedTitles.join("; ")}.`);
  return lines.join("\n");
}

async function loadInteractions(ctx: TenantContext): Promise<InteractionRow[]> {
  // Latest decision per job (un-saving or restoring cancels earlier signals).
  return query<InteractionRow>(
    `SELECT DISTINCT ON (ui.job_id) ui.type, ui.metadata->>'reason' AS reason, j.title, c.name AS company,
            COALESCE((SELECT array_agg(skill_name) FROM job_skills s WHERE s.job_id = j.id AND s.requirement = 'REQUIRED'), '{}') AS skills
     FROM user_interactions ui JOIN jobs j ON j.id = ui.job_id JOIN companies c ON c.id = j.company_id
     WHERE ui.tenant_id = $1 AND ui.user_id = $2
       AND ui.type IN ('JOB_SAVED','JOB_UNSAVED','JOB_APPLIED','JOB_DISMISSED','FEEDBACK_GOOD','FEEDBACK_BAD')
       AND ui.created_at > now() - interval '180 days'
     ORDER BY ui.job_id, ui.created_at DESC`,
    [ctx.tenantId, ctx.userId],
  );
}

/** Returns the persisted memory, rebuilding it if older than 15 minutes. */
export async function getCandidateMemory(ctx: TenantContext, personalizationEnabled: boolean): Promise<CandidateMemory | null> {
  if (!personalizationEnabled) return null;
  const row = await queryOne<{ summary: CandidateMemory; updated_at: Date }>("SELECT summary, updated_at FROM agent_memory WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
  if (row && Date.now() - row.updated_at.getTime() < REFRESH_AFTER_MS) return row.summary;
  const summary = summarizeMemory(await loadInteractions(ctx));
  await query(
    `INSERT INTO agent_memory (tenant_id, user_id, summary, signal_count) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET summary = EXCLUDED.summary, signal_count = EXCLUDED.signal_count, updated_at = now()`,
    [ctx.tenantId, ctx.userId, JSON.stringify(summary), summary.signalCount],
  );
  return summary;
}

const DECISION_LABEL: Record<string, string> = {
  JOB_SAVED: "Saved",
  JOB_APPLIED: "Applied to",
  FEEDBACK_GOOD: "Rated helpful",
  JOB_DISMISSED: "Dismissed",
  FEEDBACK_BAD: "Rated not relevant",
};

/** Semantic memory: the user's decisions on the jobs most similar to `jobId`. */
export async function recallSimilarDecisions(ctx: TenantContext, jobId: string, limit = 4): Promise<string> {
  const rows = await query<{ type: string; reason: string | null; title: string; company: string; similarity: number }>(
    `WITH target AS (SELECT embedding, model FROM job_embeddings WHERE job_id = $3),
     decisions AS (
       SELECT DISTINCT ON (ui.job_id) ui.job_id, ui.type, ui.metadata->>'reason' AS reason
       FROM user_interactions ui
       WHERE ui.tenant_id = $1 AND ui.user_id = $2 AND ui.job_id IS NOT NULL AND ui.job_id <> $3
         AND ui.type IN ('JOB_SAVED','JOB_UNSAVED','JOB_APPLIED','JOB_DISMISSED','FEEDBACK_GOOD','FEEDBACK_BAD')
       ORDER BY ui.job_id, ui.created_at DESC)
     SELECT d.type, d.reason, j.title, c.name AS company, 1 - (e.embedding <=> t.embedding) AS similarity
     FROM decisions d JOIN jobs j ON j.id = d.job_id JOIN companies c ON c.id = j.company_id
     JOIN job_embeddings e ON e.job_id = d.job_id, target t
     WHERE e.model = t.model AND d.type <> 'JOB_UNSAVED'
     ORDER BY e.embedding <=> t.embedding
     LIMIT $4`,
    [ctx.tenantId, ctx.userId, jobId, limit],
  );
  return rows
    .map((r) => `- ${DECISION_LABEL[r.type] ?? r.type} "${r.title}" at ${r.company}${r.reason ? ` (reason: ${DISMISS_REASON_LABELS[r.reason as DismissReason] ?? r.reason})` : ""} — similarity ${r.similarity.toFixed(2)}`)
    .join("\n");
}
