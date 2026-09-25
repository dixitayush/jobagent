import type { DismissReason, InteractionType, JobCard, JobDetails, JobListQuery, MatchLevel, MatchResult, Overview } from "@jobagent/shared";
import { MATCH_LEVEL_ORDER } from "@jobagent/shared";
import { query, queryOne } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { classifyFreshness } from "../domain/jobs/freshness";
import { nextWindow } from "../domain/schedule";
import { notFound } from "../lib/errors";
import { getNotificationSettings } from "./preferencesService";

interface JobRow {
  id: string;
  title: string;
  company: string;
  location_raw: string;
  work_mode: JobCard["workMode"];
  employment_type: JobCard["employmentType"];
  posted_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  content_updated_at: Date | null;
  status: "OPEN" | "CLOSED";
  source: JobCard["source"];
  url: string;
  score: number | null;
  match_level: MatchLevel | null;
  result: MatchResult | null;
  saved: boolean;
  dismissed: boolean;
  skills: string[] | null;
  total: number;
}

const toCard = (r: JobRow): JobCard => ({
  id: r.id,
  title: r.title,
  company: r.company,
  locations: r.location_raw ? r.location_raw.split(";").map((s) => s.trim()).filter(Boolean) : [],
  workMode: r.work_mode,
  employmentType: r.employment_type,
  postedAt: r.posted_at?.toISOString() ?? null,
  firstSeenAt: r.first_seen_at.toISOString(),
  freshness: classifyFreshness({ status: r.status, firstSeenAt: r.first_seen_at, postedAt: r.posted_at, contentUpdatedAt: r.content_updated_at, lastSeenAt: r.last_seen_at }),
  source: r.source,
  url: r.url,
  score: r.score,
  matchLevel: r.match_level,
  fit: r.result?.breakdown ?? null,
  topSkills: (r.result?.skills?.matched?.length ? r.result.skills.matched : (r.skills ?? [])).slice(0, 5),
  saved: r.saved,
  dismissed: r.dismissed,
});

const SORTS: Record<JobListQuery["sort"], string> = {
  BEST_MATCH: "m.rank_score DESC NULLS LAST, j.first_seen_at DESC",
  NEWEST: "LEAST(j.first_seen_at, COALESCE(j.posted_at, j.first_seen_at)) DESC",
  COMPANY: "c.name ASC, m.score DESC NULLS LAST",
  SCORE: "m.score DESC NULLS LAST, j.first_seen_at DESC",
};

/** Job feed/search (PRD §40). Always scoped to jobs reachable through the user's own sources. */
export async function listJobs(ctx: TenantContext, q: JobListQuery): Promise<{ items: JobCard[]; total: number; page: number; pageSize: number }> {
  const params: unknown[] = [ctx.tenantId, ctx.userId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = ["j.duplicate_of IS NULL"];
  if (q.view === "matches") where.push("m.id IS NOT NULL", "j.status = 'OPEN'", "d.id IS NULL");
  if (q.view === "all") where.push("j.status = 'OPEN'", "d.id IS NULL", "j.source_connector_id IN (SELECT source_connector_id FROM job_sources WHERE tenant_id = $1 AND user_id = $2)");
  if (q.view === "saved") where.push("sj.id IS NOT NULL");
  if (q.view === "dismissed") where.push("d.id IS NOT NULL");
  if (q.company) where.push(`c.name ILIKE ${p(`%${q.company}%`)}`);
  if (q.location) where.push(`j.location_raw ILIKE ${p(`%${q.location}%`)}`);
  if (q.q) where.push(`(j.title ILIKE ${p(`%${q.q}%`)} OR c.name ILIKE $${params.length})`);
  if (q.matchLevel) where.push(`m.match_level = ANY(${p(MATCH_LEVEL_ORDER.slice(0, MATCH_LEVEL_ORDER.indexOf(q.matchLevel) + 1))}::text[])`);
  if (q.minScore !== undefined) where.push(`m.score >= ${p(q.minScore)}`);
  if (q.postedWithinDays) where.push(`LEAST(j.first_seen_at, COALESCE(j.posted_at, j.first_seen_at)) > now() - make_interval(days => ${p(q.postedWithinDays)})`);
  if (q.workMode) where.push(`j.work_mode = ${p(q.workMode)}`);
  if (q.employmentType) where.push(`j.employment_type = ${p(q.employmentType)}`);
  if (q.source) where.push(`j.source = ${p(q.source)}`);
  if (q.skill) where.push(`EXISTS (SELECT 1 FROM job_skills s WHERE s.job_id = j.id AND s.skill_name ILIKE ${p(q.skill)})`);

  const limit = p(q.pageSize);
  const offset = p((q.page - 1) * q.pageSize);
  const rows = await query<JobRow>(
    `SELECT j.id, j.title, c.name AS company, j.location_raw, j.work_mode, j.employment_type, j.posted_at, j.first_seen_at, j.last_seen_at,
            j.content_updated_at, j.status, j.source, j.url, m.score, m.match_level, m.result,
            sj.id IS NOT NULL AS saved, d.id IS NOT NULL AS dismissed,
            (SELECT array_agg(skill_name) FROM (SELECT skill_name FROM job_skills WHERE job_id = j.id AND requirement = 'REQUIRED' LIMIT 5) s) AS skills,
            count(*) OVER () AS total
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_matches m ON m.job_id = j.id AND m.tenant_id = $1 AND m.user_id = $2
     LEFT JOIN saved_jobs sj ON sj.job_id = j.id AND sj.tenant_id = $1 AND sj.user_id = $2
     LEFT JOIN dismissed_jobs d ON d.job_id = j.id AND d.tenant_id = $1 AND d.user_id = $2
     WHERE ${where.join(" AND ")}
     ORDER BY ${SORTS[q.sort]}
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(toCard), total: rows[0]?.total ?? 0, page: q.page, pageSize: q.pageSize };
}

/** Access rule: a user may only see jobs from sources they track, or jobs they matched/saved. */
const VISIBLE = `(j.source_connector_id IN (SELECT source_connector_id FROM job_sources WHERE tenant_id = $2 AND user_id = $3)
  OR EXISTS (SELECT 1 FROM job_matches mm WHERE mm.job_id = j.id AND mm.tenant_id = $2 AND mm.user_id = $3)
  OR EXISTS (SELECT 1 FROM saved_jobs ss WHERE ss.job_id = j.id AND ss.tenant_id = $2 AND ss.user_id = $3))`;

export async function getJob(ctx: TenantContext, id: string): Promise<JobDetails> {
  const r = await queryOne<JobRow & { description: string; salary_text: string | null; seniority: JobDetails["seniority"]; required_years: number | null; explanation: string | null; extraction: { summary?: string | null } | null }>(
    `SELECT j.id, j.title, c.name AS company, j.location_raw, j.work_mode, j.employment_type, j.posted_at, j.first_seen_at, j.last_seen_at,
            j.content_updated_at, j.status, j.source, j.url, j.description, j.salary_text, j.seniority, j.required_years, j.extraction,
            m.score, m.match_level, m.result, m.explanation,
            EXISTS (SELECT 1 FROM saved_jobs s WHERE s.job_id = j.id AND s.tenant_id = $2 AND s.user_id = $3) AS saved,
            EXISTS (SELECT 1 FROM dismissed_jobs d WHERE d.job_id = j.id AND d.tenant_id = $2 AND d.user_id = $3) AS dismissed,
            NULL::text[] AS skills, 1 AS total
     FROM jobs j JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_matches m ON m.job_id = j.id AND m.tenant_id = $2 AND m.user_id = $3
     WHERE j.id = $1 AND ${VISIBLE}`,
    [id, ctx.tenantId, ctx.userId],
  );
  if (!r) throw notFound("Job not found");
  const skills = await query<{ skill_name: string; requirement: string }>("SELECT skill_name, requirement FROM job_skills WHERE job_id = $1 ORDER BY skill_name", [id]);
  await query("UPDATE job_matches SET seen_at = COALESCE(seen_at, now()) WHERE job_id = $1 AND tenant_id = $2 AND user_id = $3", [id, ctx.tenantId, ctx.userId]);
  const result = r.result ? { ...r.result, aiSummary: r.result.aiSummary ?? r.extraction?.summary ?? null } : null;
  return {
    ...toCard({ ...r, skills: skills.filter((s) => s.requirement === "REQUIRED").map((s) => s.skill_name) }),
    description: r.description,
    salaryText: r.salary_text,
    seniority: r.seniority,
    requiredYears: r.required_years,
    requiredSkills: skills.filter((s) => s.requirement === "REQUIRED").map((s) => s.skill_name),
    preferredSkills: skills.filter((s) => s.requirement === "PREFERRED").map((s) => s.skill_name),
    match: result,
    explanation: r.explanation,
  };
}

async function assertVisible(ctx: TenantContext, jobId: string): Promise<void> {
  const r = await queryOne(`SELECT 1 FROM jobs j WHERE j.id = $1 AND ${VISIBLE}`, [jobId, ctx.tenantId, ctx.userId]);
  if (!r) throw notFound("Job not found");
}

export async function recordInteraction(ctx: TenantContext, type: InteractionType, jobId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  if (jobId) await assertVisible(ctx, jobId);
  await query("INSERT INTO user_interactions (tenant_id, user_id, job_id, type, metadata) VALUES ($1,$2,$3,$4,$5)", [ctx.tenantId, ctx.userId, jobId, type, JSON.stringify(metadata)]);
}

export async function saveJob(ctx: TenantContext, jobId: string, saved: boolean): Promise<void> {
  await assertVisible(ctx, jobId);
  if (saved) {
    await query("INSERT INTO saved_jobs (tenant_id, user_id, job_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [ctx.tenantId, ctx.userId, jobId]);
  } else {
    await query("DELETE FROM saved_jobs WHERE tenant_id = $1 AND user_id = $2 AND job_id = $3", [ctx.tenantId, ctx.userId, jobId]);
  }
  await recordInteraction(ctx, saved ? "JOB_SAVED" : "JOB_UNSAVED", jobId);
}

export async function dismissJob(ctx: TenantContext, jobId: string, dismissed: boolean, reason?: DismissReason): Promise<void> {
  await assertVisible(ctx, jobId);
  if (dismissed) {
    await query(
      "INSERT INTO dismissed_jobs (tenant_id, user_id, job_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, job_id) DO UPDATE SET reason = EXCLUDED.reason",
      [ctx.tenantId, ctx.userId, jobId, reason ?? null],
    );
    await recordInteraction(ctx, "JOB_DISMISSED", jobId, reason ? { reason } : {});
  } else {
    await query("DELETE FROM dismissed_jobs WHERE tenant_id = $1 AND user_id = $2 AND job_id = $3", [ctx.tenantId, ctx.userId, jobId]);
  }
}

export async function getOverview(ctx: TenantContext, name: string, timezone: string): Promise<Overview> {
  const [stats, setup, runs, failing, settings] = await Promise.all([
    queryOne<{ discovered_today: number; new_jobs: number; highly: number; strong: number; very_strong: number; sent_today: number; saved: number; applied: number }>(
      `SELECT
        (SELECT count(*)::int FROM jobs j WHERE j.duplicate_of IS NULL AND j.first_seen_at > now() - interval '24 hours'
           AND j.source_connector_id IN (SELECT source_connector_id FROM job_sources WHERE tenant_id = $1 AND user_id = $2)) AS discovered_today,
        (SELECT count(*)::int FROM job_matches m JOIN jobs j ON j.id = m.job_id WHERE m.tenant_id = $1 AND m.user_id = $2 AND j.status = 'OPEN'
           AND LEAST(j.first_seen_at, COALESCE(j.posted_at, j.first_seen_at)) > now() - interval '24 hours') AS new_jobs,
        (SELECT count(*)::int FROM job_matches m JOIN jobs j ON j.id = m.job_id WHERE m.tenant_id = $1 AND m.user_id = $2 AND j.status = 'OPEN' AND m.match_level IN ('VERY_STRONG','STRONG','GOOD')) AS highly,
        (SELECT count(*)::int FROM job_matches m JOIN jobs j ON j.id = m.job_id WHERE m.tenant_id = $1 AND m.user_id = $2 AND j.status = 'OPEN' AND m.match_level = 'STRONG') AS strong,
        (SELECT count(*)::int FROM job_matches m JOIN jobs j ON j.id = m.job_id WHERE m.tenant_id = $1 AND m.user_id = $2 AND j.status = 'OPEN' AND m.match_level = 'VERY_STRONG') AS very_strong,
        (SELECT COALESCE(sum(job_count), 0)::int FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND status = 'SENT' AND sent_at > now() - interval '24 hours') AS sent_today,
        (SELECT count(*)::int FROM saved_jobs WHERE tenant_id = $1 AND user_id = $2) AS saved,
        (SELECT count(*)::int FROM user_interactions WHERE tenant_id = $1 AND user_id = $2 AND type = 'JOB_APPLIED') AS applied`,
      [ctx.tenantId, ctx.userId],
    ),
    queryOne<{ has_resume: boolean; skills: number; locations: number; roles: number; sources: number; indexed: number }>(
      `SELECT EXISTS (SELECT 1 FROM resumes WHERE tenant_id = $1 AND user_id = $2) AS has_resume,
        COALESCE((SELECT cardinality(normalized_skills) FROM candidate_profiles WHERE tenant_id = $1 AND user_id = $2 AND is_active LIMIT 1), 0) AS skills,
        COALESCE((SELECT cardinality(location_ids) FROM user_preferences WHERE tenant_id = $1 AND user_id = $2), 0) AS locations,
        COALESCE((SELECT cardinality(job_titles) FROM user_preferences WHERE tenant_id = $1 AND user_id = $2), 0) AS roles,
        (SELECT count(*)::int FROM job_sources WHERE tenant_id = $1 AND user_id = $2) AS sources,
        (SELECT count(*)::int FROM jobs WHERE status = 'OPEN' AND duplicate_of IS NULL
           AND source_connector_id IN (SELECT source_connector_id FROM job_sources WHERE tenant_id = $1 AND user_id = $2)) AS indexed`,
      [ctx.tenantId, ctx.userId],
    ),
    queryOne<{ last: Date | null }>("SELECT max(completed_at) AS last FROM agent_runs WHERE tenant_id = $1 AND user_id = $2 AND type = 'MATCH' AND status = 'SUCCEEDED'", [ctx.tenantId, ctx.userId]),
    query<{ name: string }>(
      `SELECT js.display_name AS name FROM job_sources js JOIN source_connectors s ON s.id = js.source_connector_id
       WHERE js.tenant_id = $1 AND js.user_id = $2 AND js.status = 'ACTIVE' AND (s.status = 'DEGRADED' OR s.consecutive_failures > 0)`,
      [ctx.tenantId, ctx.userId],
    ),
    getNotificationSettings(ctx),
  ]);
  const next = nextWindow({ timezone, ...settings });
  const nextEmail = settings.emailEnabled && next ? next.scheduledAt.toISOString() : null;
  return {
    greetingName: name.split(" ")[0] ?? name,
    jobsDiscoveredToday: stats?.discovered_today ?? 0,
    newJobs: stats?.new_jobs ?? 0,
    highlyRelevant: stats?.highly ?? 0,
    strongMatches: stats?.strong ?? 0,
    veryStrongMatches: stats?.very_strong ?? 0,
    jobsSentToday: stats?.sent_today ?? 0,
    savedJobs: stats?.saved ?? 0,
    applicationsTracked: stats?.applied ?? 0,
    lastAgentRun: runs?.last?.toISOString() ?? null,
    // Matching runs just before each digest (and after profile/source changes).
    nextAgentRun: nextEmail,
    nextEmail,
    setup: {
      hasResume: setup?.has_resume ?? false,
      hasLocations: (setup?.locations ?? 0) > 0,
      hasRoles: (setup?.roles ?? 0) > 0,
      sourceCount: setup?.sources ?? 0,
      skillCount: setup?.skills ?? 0,
      jobsIndexed: setup?.indexed ?? 0,
    },
    failingSources: failing.map((f) => f.name),
  };
}
