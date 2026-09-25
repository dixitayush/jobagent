/**
 * Controlled tools for the job agent (PRD §53). Agent nodes never touch the database,
 * filesystem or email provider directly — only these narrowly-scoped, tenant-bound
 * functions. Every query is fixed to the caller's tenant_id + user_id.
 */
import type { CandidateProfileData, EmploymentType, Freshness, MatchResult, Seniority, WorkMode } from "@jobagent/shared";
import { query, queryOne, withTransaction } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { classifyFreshness } from "../domain/jobs/freshness";
import type { ResolvedLocation } from "../domain/locations/resolver";
import type { PrefsForMatch } from "../domain/matching/scoring";
import { replaceJobSkills } from "../services/referenceData";

export interface AgentCandidate {
  profileId: string;
  profileVersion: number;
  profile: CandidateProfileData;
  embeddingModel: string | null;
}

export async function getCandidateProfile(ctx: TenantContext): Promise<AgentCandidate | null> {
  const row = await queryOne<{ id: string; version: number; profile: CandidateProfileData; model: string | null }>(
    `SELECT cp.id, cp.version, cp.profile, ce.model
     FROM candidate_profiles cp LEFT JOIN candidate_embeddings ce ON ce.profile_id = cp.id
     WHERE cp.tenant_id = $1 AND cp.user_id = $2 AND cp.is_active ORDER BY cp.version DESC LIMIT 1`,
    [ctx.tenantId, ctx.userId],
  );
  return row ? { profileId: row.id, profileVersion: row.version, profile: row.profile, embeddingModel: row.model } : null;
}

export interface AgentPreferences extends PrefsForMatch {
  includeRecentJobs: boolean;
  enabledPortals: string[];
  personalizationEnabled: boolean;
  locationNames: string[];
}

export async function getCandidatePreferences(ctx: TenantContext): Promise<AgentPreferences> {
  const row = await queryOne<{
    job_titles: string[];
    location_ids: number[];
    preferred_companies: string[];
    blocked_companies: string[];
    min_experience: number | null;
    max_experience: number | null;
    work_modes: WorkMode[];
    employment_types: EmploymentType[];
    include_recent_jobs: boolean;
    enabled_portals: string[];
    personalization_enabled: boolean;
    location_names: string[] | null;
  }>(
    `SELECT p.*, u.personalization_enabled,
            (SELECT array_agg(l.name) FROM locations l WHERE l.id = ANY(p.location_ids)) AS location_names
     FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id AND p.tenant_id = u.tenant_id
     WHERE u.id = $2 AND u.tenant_id = $1`,
    [ctx.tenantId, ctx.userId],
  );
  return {
    jobTitles: row?.job_titles ?? [],
    locationIds: row?.location_ids ?? [],
    preferredCompanies: row?.preferred_companies ?? [],
    blockedCompanies: row?.blocked_companies ?? [],
    minExperience: row?.min_experience ?? null,
    maxExperience: row?.max_experience ?? null,
    workModes: row?.work_modes ?? [],
    employmentTypes: row?.employment_types ?? ["FULL_TIME"],
    includeRecentJobs: row?.include_recent_jobs ?? false,
    enabledPortals: row?.enabled_portals ?? [],
    personalizationEnabled: row?.personalization_enabled ?? true,
    locationNames: row?.location_names ?? [],
  };
}

export interface RetrievedJob {
  id: string;
  title: string;
  company: string;
  description: string;
  descriptionHash: string;
  locationRaw: string;
  version: number;
  requiredSkills: string[];
  preferredSkills: string[];
  requiredAnyOf: string[][];
  requiredYears: number | null;
  seniority: Seniority | null;
  workMode: WorkMode | null;
  employmentType: EmploymentType | null;
  freshness: Freshness;
  similarity: number | null;
  locations: ResolvedLocation[];
  extractionMethod: string | null;
  extractionVersion: string | null;
}

/**
 * Candidate retrieval (PRD §22 steps 4–5): deterministic SQL filters first (user's tracked
 * sources, open, recent, not dismissed, not blocked, employment type), then pgvector
 * nearest-neighbour ordering against the candidate embedding.
 */
export async function searchJobs(
  ctx: TenantContext,
  opts: { profileId: string; embeddingModel: string | null; prefs: AgentPreferences; limit: number; maxAgeDays: number },
): Promise<RetrievedJob[]> {
  const emb = opts.embeddingModel
    ? await queryOne<{ embedding: string }>("SELECT embedding::text AS embedding FROM candidate_embeddings WHERE profile_id = $1 AND tenant_id = $2 AND user_id = $3", [
        opts.profileId,
        ctx.tenantId,
        ctx.userId,
      ])
    : null;
  const rows = await query<{
    id: string;
    title: string;
    company: string;
    description: string;
    description_hash: string;
    location_raw: string;
    version: number;
    required_years: number | null;
    seniority: Seniority | null;
    work_mode: WorkMode | null;
    employment_type: EmploymentType | null;
    status: "OPEN" | "CLOSED";
    first_seen_at: Date;
    posted_at: Date | null;
    content_updated_at: Date | null;
    last_seen_at: Date;
    similarity: number | null;
    extraction: { method?: string; requiredAnyOf?: string[][] } | null;
    extraction_version: string | null;
  }>(
    `SELECT j.id, j.title, c.name AS company, j.description, j.description_hash, j.location_raw, j.version, j.required_years, j.seniority,
            j.work_mode, j.employment_type, j.status, j.first_seen_at, j.posted_at, j.content_updated_at, j.last_seen_at, j.extraction, j.extraction_version,
            CASE WHEN $3::vector IS NULL OR je.model IS DISTINCT FROM $4 THEN NULL ELSE 1 - (je.embedding <=> $3::vector) END AS similarity
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_embeddings je ON je.job_id = j.id
     WHERE j.status = 'OPEN' AND j.duplicate_of IS NULL
       AND j.first_seen_at > now() - make_interval(days => $5)
       AND j.source_connector_id IN (SELECT source_connector_id FROM job_sources WHERE tenant_id = $1 AND user_id = $2 AND status = 'ACTIVE')
       AND NOT EXISTS (SELECT 1 FROM dismissed_jobs d WHERE d.tenant_id = $1 AND d.user_id = $2 AND d.job_id = j.id)
       AND NOT (lower(c.name) = ANY($6::text[]))
       AND (j.employment_type IS NULL OR cardinality($7::text[]) = 0 OR j.employment_type = ANY($7::text[]))
     ORDER BY similarity DESC NULLS LAST, j.first_seen_at DESC
     LIMIT $8`,
    [
      ctx.tenantId,
      ctx.userId,
      emb?.embedding ?? null,
      opts.embeddingModel,
      opts.maxAgeDays,
      opts.prefs.blockedCompanies.map((b) => b.toLowerCase()),
      opts.prefs.employmentTypes,
      opts.limit,
    ],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const skills = await query<{ job_id: string; skill_name: string; requirement: string }>("SELECT job_id, skill_name, requirement FROM job_skills WHERE job_id = ANY($1::uuid[])", [ids]);
  const locs = await query<{ job_id: string; raw: string; city_id: number | null; state_id: number | null; country_id: number | null; is_remote: boolean }>(
    "SELECT job_id, raw, city_id, state_id, country_id, is_remote FROM job_locations WHERE job_id = ANY($1::uuid[])",
    [ids],
  );
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    description: r.description,
    descriptionHash: r.description_hash,
    locationRaw: r.location_raw,
    version: r.version,
    requiredSkills: skills.filter((s) => s.job_id === r.id && s.requirement === "REQUIRED").map((s) => s.skill_name),
    preferredSkills: skills.filter((s) => s.job_id === r.id && s.requirement === "PREFERRED").map((s) => s.skill_name),
    requiredYears: r.required_years,
    seniority: r.seniority,
    workMode: r.work_mode,
    employmentType: r.employment_type,
    freshness: classifyFreshness({ status: r.status, firstSeenAt: r.first_seen_at, postedAt: r.posted_at, contentUpdatedAt: r.content_updated_at, lastSeenAt: r.last_seen_at }, now),
    similarity: r.similarity,
    locations: locs.filter((l) => l.job_id === r.id).map((l) => ({ raw: l.raw, cityId: l.city_id, stateId: l.state_id, countryId: l.country_id, isRemote: l.is_remote })),
    extractionMethod: r.extraction?.method ?? null,
    extractionVersion: r.extraction_version,
    requiredAnyOf: Array.isArray(r.extraction?.requiredAnyOf) ? r.extraction.requiredAnyOf : [],
  }));
}

export interface CachedMatch {
  jobId: string;
  profileVersion: number;
  jobVersion: number;
  prefsHash: string;
  evaluatedBy: string;
  promptVersion: string | null;
  result: MatchResult;
  explanation: string | null;
}

export async function getExistingMatches(ctx: TenantContext, jobIds: string[]): Promise<Map<string, CachedMatch>> {
  if (!jobIds.length) return new Map();
  const rows = await query<{ job_id: string; profile_version: number; job_version: number; prefs_hash: string; evaluated_by: string; prompt_version: string | null; result: MatchResult; explanation: string | null }>(
    "SELECT job_id, profile_version, job_version, prefs_hash, evaluated_by, prompt_version, result, explanation FROM job_matches WHERE tenant_id = $1 AND user_id = $2 AND job_id = ANY($3::uuid[])",
    [ctx.tenantId, ctx.userId, jobIds],
  );
  return new Map(
    rows.map((r) => [r.job_id, { jobId: r.job_id, profileVersion: r.profile_version, jobVersion: r.job_version, prefsHash: r.prefs_hash, evaluatedBy: r.evaluated_by, promptVersion: r.prompt_version, result: r.result, explanation: r.explanation }]),
  );
}

/** Aggregated interaction signals with the skills of the jobs involved (PRD §31). */
export async function getInteractionSignals(ctx: TenantContext): Promise<{ type: string; skills: string[] }[]> {
  return query<{ type: string; skills: string[] }>(
    `SELECT ui.type, COALESCE(array_agg(js.skill_name) FILTER (WHERE js.skill_name IS NOT NULL), '{}') AS skills
     FROM user_interactions ui LEFT JOIN job_skills js ON js.job_id = ui.job_id
     WHERE ui.tenant_id = $1 AND ui.user_id = $2 AND ui.job_id IS NOT NULL AND ui.created_at > now() - interval '120 days'
     GROUP BY ui.id, ui.type`,
    [ctx.tenantId, ctx.userId],
  );
}

/** Global write: upgrades a job's requirements with LLM understanding (shared by all users). */
export async function saveJobUnderstanding(
  jobId: string,
  reqs: { requiredSkills: string[]; preferredSkills: string[]; requiredAnyOf: string[][]; requiredYears: number | null; summary: string | null; version: string },
): Promise<void> {
  await withTransaction(async (client) => {
    // Any-of members are stored as REQUIRED skill rows (search/display); the groups live in `extraction`.
    await replaceJobSkills(jobId, [...new Set([...reqs.requiredSkills, ...reqs.requiredAnyOf.flat()])], reqs.preferredSkills, client);
    await client.query(
      `UPDATE jobs SET extraction = $2, extraction_version = $3, required_years = COALESCE($4, required_years) WHERE id = $1`,
      [jobId, JSON.stringify({ requiredSkills: reqs.requiredSkills, preferredSkills: reqs.preferredSkills, requiredAnyOf: reqs.requiredAnyOf, summary: reqs.summary, method: "LLM" }), reqs.version, reqs.requiredYears],
    );
  });
}

export interface MatchToSave {
  jobId: string;
  jobVersion: number;
  score: number;
  rankScore: number;
  result: MatchResult;
  explanation: string;
  promptVersion: string | null;
}

export async function saveMatches(ctx: TenantContext, profileVersion: number, prefsHash: string, matches: MatchToSave[], removeJobIds: string[]): Promise<void> {
  for (const m of matches) {
    await query(
      `INSERT INTO job_matches (tenant_id, user_id, job_id, profile_version, job_version, prefs_hash, score, rank_score, match_level, confidence, result, explanation, evaluated_by, prompt_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (user_id, job_id) DO UPDATE SET profile_version = EXCLUDED.profile_version, job_version = EXCLUDED.job_version,
         prefs_hash = EXCLUDED.prefs_hash, score = EXCLUDED.score, rank_score = EXCLUDED.rank_score, match_level = EXCLUDED.match_level,
         confidence = EXCLUDED.confidence, result = EXCLUDED.result, explanation = EXCLUDED.explanation,
         evaluated_by = EXCLUDED.evaluated_by, prompt_version = EXCLUDED.prompt_version`,
      [ctx.tenantId, ctx.userId, m.jobId, profileVersion, m.jobVersion, prefsHash, m.score, m.rankScore, m.result.matchLevel, m.result.confidence, JSON.stringify(m.result), m.explanation, m.result.evaluatedBy, m.promptVersion],
    );
  }
  if (removeJobIds.length) {
    await query("DELETE FROM job_matches WHERE tenant_id = $1 AND user_id = $2 AND job_id = ANY($3::uuid[])", [ctx.tenantId, ctx.userId, removeJobIds]);
  }
}

