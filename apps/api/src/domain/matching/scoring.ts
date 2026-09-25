import type {
  EmploymentType,
  Freshness,
  MatchBreakdown,
  MatchLevel,
  MatchResult,
  Seniority,
  WorkMode,
} from "@jobagent/shared";
import { normalizeTitle } from "../jobs/normalize";
import type { LocationMatch } from "../locations/resolver";
import { isSoftSkill, normalizeSkill, skillAncestors, skillKey } from "../skills/taxonomy";

/* ───────────────────────────── Inputs ───────────────────────────── */

export interface CandidateForMatch {
  profileVersion: number;
  skills: string[];
  yearsOfExperience: number;
  seniority: Seniority | null;
  jobTitles: string[];
}

export interface PrefsForMatch {
  jobTitles: string[];
  locationIds: number[];
  preferredCompanies: string[];
  blockedCompanies: string[];
  minExperience: number | null;
  maxExperience: number | null;
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
}

export interface JobForMatch {
  id: string;
  title: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  /** Interchangeable required skills ("Java, Go or Ruby"): each group is one requirement, met by any member. */
  requiredAnyOf?: string[][];
  requiredYears: number | null;
  seniority: Seniority | null;
  workMode: WorkMode | null;
  employmentType: EmploymentType | null;
  freshness: Freshness;
}

export interface ScoringConfig {
  weights: Record<Exclude<keyof MatchBreakdown, "personalization">, number>;
  thresholds: { veryStrong: number; strong: number; good: number; partial: number };
}

/** PRD §24 default weights (sum = 100) and §23 thresholds. */
export const DEFAULT_SCORING: ScoringConfig = {
  weights: { skills: 30, experience: 20, title: 15, semantic: 15, location: 10, seniority: 5, workMode: 5 },
  thresholds: { veryStrong: 90, strong: 80, good: 70, partial: 55 },
};

/* ───────────────────────────── Components ───────────────────────────── */

export interface SkillEvaluation {
  score: number;
  matched: string[];
  missing: string[];
  preferredMissing: string[];
  inferred: string[];
  known: boolean;
}

export function evaluateSkills(candidateSkills: string[], required: string[], preferred: string[], anyOf: string[][] = []): SkillEvaluation {
  const have = new Set(candidateSkills.map(skillKey));
  // A candidate with "Spring Boot" implicitly demonstrates its ancestors (Spring, Java).
  const implied = new Set(candidateSkills.flatMap((s) => skillAncestors(s)).map(skillKey));
  // Soft skills are rarely verifiable from a resume; they never count as gaps.
  const groups = anyOf
    .map((g) => [...new Set(g.map(normalizeSkill))].filter((s) => s && !isSoftSkill(s)))
    .filter((g) => g.length >= 2);
  const inGroup = new Set(groups.flat());
  const req = [...new Set(required.map(normalizeSkill))].filter((s) => s && !isSoftSkill(s) && !inGroup.has(s));
  const pref = [...new Set(preferred.map(normalizeSkill))].filter((s) => s && !isSoftSkill(s) && !req.includes(s) && !inGroup.has(s));
  if (req.length === 0 && pref.length === 0 && groups.length === 0) {
    return { score: 0.5, matched: [], missing: [], preferredMissing: [], inferred: [], known: false };
  }
  const matched: string[] = [];
  const missing: string[] = [];
  const preferredMissing: string[] = [];
  const inferred: string[] = [];
  let earned = 0;
  let possible = 0;
  const credit = (skill: string, weight: number, onMiss: string[]) => {
    possible += weight;
    const k = skillKey(skill);
    if (have.has(k)) {
      matched.push(skill);
      earned += weight;
    } else if (implied.has(k)) {
      inferred.push(skill);
      earned += weight * 0.6;
    } else onMiss.push(skill);
  };
  req.forEach((s) => credit(s, 1, missing));
  // An any-of group is one requirement: full credit if any member is held, partial if implied.
  for (const g of groups) {
    possible += 1;
    const held = g.find((s) => have.has(skillKey(s)));
    const impliedMember = held ? undefined : g.find((s) => implied.has(skillKey(s)));
    if (held) {
      matched.push(held);
      earned += 1;
    } else if (impliedMember) {
      inferred.push(impliedMember);
      earned += 0.6;
    } else missing.push(`one of ${g.join(" / ")}`);
  }
  pref.forEach((s) => credit(s, 0.5, preferredMissing));
  return { score: possible ? earned / possible : 0.5, matched, missing, preferredMissing, inferred, known: true };
}

export function evaluateExperience(candidateYears: number, requiredYears: number | null, prefs?: Pick<PrefsForMatch, "minExperience" | "maxExperience">) {
  if (requiredYears === null) return { score: 0.7, match: null as boolean | null };
  const gap = requiredYears - candidateYears;
  let score: number;
  if (gap <= 0) score = candidateYears - requiredYears > 10 ? 0.7 : 1; // heavily over-qualified is a weaker fit
  else if (gap <= 1) score = 0.75;
  else if (gap <= 2) score = 0.45;
  else if (gap <= 3) score = 0.2;
  else score = 0;
  if (prefs?.maxExperience != null && requiredYears > prefs.maxExperience) score = Math.min(score, 0.5);
  return { score, match: gap <= 0 };
}

const TITLE_STOPWORDS = new Set([
  "senior", "junior", "lead", "staff", "principal", "sr", "jr", "i", "ii", "iii", "1", "2", "3", "4", "the", "a", "an", "of", "and", "for", "with", "in", "at", "to", "remote", "hybrid", "team", "level", "mid",
]);
const TITLE_SYNONYMS: Record<string, string> = { developer: "engineer", programmer: "engineer", dev: "engineer", swe: "engineer", sde: "engineer", development: "", engineering: "engineer", fullstack: "fullstack", "full-stack": "fullstack" };

function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .map((t) => TITLE_SYNONYMS[t] ?? t)
    .filter((t) => t && !TITLE_STOPWORDS.has(t));
}

export function evaluateTitle(jobTitle: string, targetTitles: string[]): number {
  const job = new Set(titleTokens(jobTitle));
  if (!targetTitles.length) return 0.6;
  if (!job.size) return 0.3;
  let best = 0;
  for (const target of targetTitles) {
    const tt = [...new Set(titleTokens(target))];
    if (!tt.length) continue;
    const overlap = tt.filter((t) => job.has(t)).length;
    // Weighted towards covering the target title, with a small penalty for extra job-title words.
    const recall = overlap / tt.length;
    const precision = overlap / job.size;
    best = Math.max(best, 0.75 * recall + 0.25 * precision);
  }
  return best;
}

const SENIORITY_RANK: Record<Seniority, number> = { INTERN: 0, JUNIOR: 1, MID: 2, SENIOR: 3, LEAD: 4, PRINCIPAL: 5, EXECUTIVE: 6 };

export function seniorityFromYears(years: number): Seniority {
  if (years < 1) return "JUNIOR";
  if (years < 3) return "JUNIOR";
  if (years < 5) return "MID";
  if (years < 9) return "SENIOR";
  if (years < 13) return "LEAD";
  return "PRINCIPAL";
}

export function evaluateSeniority(candidate: Seniority | null, candidateYears: number, job: Seniority | null): number {
  if (!job) return 0.7;
  const c = SENIORITY_RANK[candidate ?? seniorityFromYears(candidateYears)];
  const diff = Math.abs(c - SENIORITY_RANK[job]);
  return diff === 0 ? 1 : diff === 1 ? 0.6 : 0.15;
}

export function evaluateWorkMode(jobMode: WorkMode | null, preferred: WorkMode[]): { score: number; match: boolean | null } {
  if (!preferred.length) return { score: 1, match: true };
  if (!jobMode) return { score: 0.7, match: null };
  if (preferred.includes(jobMode)) return { score: 1, match: true };
  // Hybrid is a reasonable compromise for someone who accepts on-site.
  if (jobMode === "HYBRID" && preferred.includes("ONSITE")) return { score: 0.8, match: true };
  return { score: 0, match: false };
}

/**
 * Cosine-similarity calibration per embedding model: [unrelated, strongly related].
 * Different models live on very different similarity scales, so each needs its own range.
 * Re-derive these from the evaluation set when adding a model (npm run eval).
 */
export const SIMILARITY_CALIBRATION: Record<string, [number, number]> = {
  "local-hash-v1": [0.02, 0.3],
  "text-embedding-3-small": [0.15, 0.6],
  "text-embedding-3-large": [0.15, 0.6],
  "gemini-embedding-001": [0.45, 0.8],
};

/** Maps cosine similarity to 0..1 so unrelated text ≈ 0 and a close fit ≈ 1. */
export function semanticScore(similarity: number | null, model: string | null = null): number | null {
  if (similarity === null || Number.isNaN(similarity)) return null;
  const [floor, ceil] = (model && SIMILARITY_CALIBRATION[model]) || [0.15, 0.75];
  return Math.max(0, Math.min(1, (similarity - floor) / (ceil - floor)));
}

/* ───────────────────────────── Hard filters (PRD §22 step 4) ───────────────────────────── */

export interface HardFilterResult {
  pass: boolean;
  reason?: string;
}

const companyKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function hardFilter(job: JobForMatch, candidate: CandidateForMatch, prefs: PrefsForMatch, location: LocationMatch): HardFilterResult {
  if (prefs.blockedCompanies.some((b) => companyKey(b) === companyKey(job.company))) return { pass: false, reason: "BLOCKED_COMPANY" };
  if (location.match === false) return { pass: false, reason: "LOCATION" };
  if (job.employmentType && prefs.employmentTypes.length && !prefs.employmentTypes.includes(job.employmentType))
    return { pass: false, reason: "EMPLOYMENT_TYPE" };
  if (job.workMode && prefs.workModes.length) {
    const wm = evaluateWorkMode(job.workMode, prefs.workModes);
    if (wm.match === false) return { pass: false, reason: "WORK_MODE" };
  }
  const years = candidate.yearsOfExperience;
  if (job.requiredYears !== null && job.requiredYears - years > 3) return { pass: false, reason: "EXPERIENCE" };
  if (prefs.minExperience !== null && job.requiredYears !== null && job.requiredYears + 2 < prefs.minExperience)
    return { pass: false, reason: "EXPERIENCE_BELOW_PREFERENCE" };
  if (job.seniority === "INTERN" && years >= 2) return { pass: false, reason: "SENIORITY" };
  return { pass: true };
}

/* ───────────────────────────── Scoring & ranking ───────────────────────────── */

export function levelFor(score: number, t = DEFAULT_SCORING.thresholds): MatchLevel {
  if (score >= t.veryStrong) return "VERY_STRONG";
  if (score >= t.strong) return "STRONG";
  if (score >= t.good) return "GOOD";
  if (score >= t.partial) return "PARTIAL";
  return "LOW";
}

export interface ScoreInput {
  job: JobForMatch;
  candidate: CandidateForMatch;
  prefs: PrefsForMatch;
  location: LocationMatch;
  similarity: number | null;
  /** Embedding model that produced `similarity` (selects the calibration range). */
  embeddingModel?: string | null;
  /** Optional LLM-provided evidence that overrides the deterministic skill lists. */
  skillEvidence?: Pick<SkillEvaluation, "matched" | "missing" | "preferredMissing" | "inferred">;
  requiredYearsOverride?: number | null;
  personalizationBoost?: number;
  config?: ScoringConfig;
}

export interface ScoreOutput {
  score: number;
  level: MatchLevel;
  breakdown: MatchBreakdown;
  skills: SkillEvaluation;
  experience: { score: number; match: boolean | null; requiredYears: number | null };
  workMode: { score: number; match: boolean | null };
  confidence: number;
}

function skillsFromEvidence(e: NonNullable<ScoreInput["skillEvidence"]>): SkillEvaluation {
  const possible = e.matched.length + e.missing.length + e.inferred.length + e.preferredMissing.length * 0.5;
  const earned = e.matched.length + e.inferred.length * 0.6;
  return { ...e, score: possible ? Math.min(1, earned / possible) : 0.5, known: possible > 0 };
}

export function scoreJob(input: ScoreInput): ScoreOutput {
  const cfg = input.config ?? DEFAULT_SCORING;
  const w = cfg.weights;
  const { job, candidate, prefs } = input;
  const skills = input.skillEvidence
    ? skillsFromEvidence(input.skillEvidence)
    : evaluateSkills(candidate.skills, job.requiredSkills, job.preferredSkills, job.requiredAnyOf ?? []);
  const requiredYears = input.requiredYearsOverride !== undefined ? input.requiredYearsOverride : job.requiredYears;
  const experience = { ...evaluateExperience(candidate.yearsOfExperience, requiredYears, prefs), requiredYears };
  const titles = [...new Set([...prefs.jobTitles, ...candidate.jobTitles.slice(0, 5)])];
  const title = evaluateTitle(job.title, titles);
  const sem = semanticScore(input.similarity, input.embeddingModel ?? null);
  const seniority = evaluateSeniority(candidate.seniority, candidate.yearsOfExperience, job.seniority);
  const workMode = evaluateWorkMode(job.workMode, prefs.workModes);

  const breakdown: MatchBreakdown = {
    skills: round1(skills.score * w.skills),
    experience: round1(experience.score * w.experience),
    title: round1(title * w.title),
    semantic: round1((sem ?? 0.5) * w.semantic),
    location: round1(input.location.score * w.location),
    seniority: round1(seniority * w.seniority),
    workMode: round1(workMode.score * w.workMode),
    personalization: round1(clamp(input.personalizationBoost ?? 0, -3, 3)),
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.round(clamp(total, 0, 100));

  let confidence = 0.4;
  if (skills.known) confidence += 0.2;
  if (requiredYears !== null) confidence += 0.1;
  if (input.location.match !== null) confidence += 0.1;
  if (sem !== null) confidence += 0.1;
  if (input.skillEvidence) confidence += 0.1;

  return { score, level: levelFor(score, cfg.thresholds), breakdown, skills, experience, workMode, confidence: round2(Math.min(confidence, 0.99)) };
}

/** Final ordering signal: score plus small freshness / preferred-company nudges (PRD §22 step 7). */
export function rankScore(score: number, freshness: Freshness, isPreferredCompany: boolean): number {
  const fresh = freshness === "NEW" ? 2 : freshness === "UPDATED" ? 1 : freshness === "RECENT" ? 0.5 : 0;
  return round2(score + fresh + (isPreferredCompany ? 3 : 0));
}

export function isPreferredCompany(company: string, preferred: string[]): boolean {
  return preferred.some((p) => companyKey(p) === companyKey(company));
}

/* ───────────────────────────── Explanation (PRD §22 step 8, §90) ───────────────────────────── */

export function buildReasons(out: ScoreOutput, location: LocationMatch, candidateYears: number): { reasons: string[]; concerns: string[] } {
  const reasons: string[] = [];
  const concerns: string[] = [];
  for (const s of out.skills.matched.slice(0, 8)) reasons.push(s);
  for (const s of out.skills.inferred.slice(0, 3)) reasons.push(`${s} (inferred from related experience)`);
  const req = out.experience.requiredYears;
  if (req !== null && out.experience.match) reasons.push(`${req}+ years requested — your resume shows ~${formatYears(candidateYears)} years`);
  if (req !== null && !out.experience.match) concerns.push(`${req}+ years requested — your resume shows ~${formatYears(candidateYears)} years`);
  if (location.match) reasons.push(location.reason);
  else if (location.match === null) concerns.push("Job location is not specified");
  if (out.workMode.match === false) concerns.push("Work mode differs from your preference");
  for (const s of out.skills.missing.slice(0, 5)) concerns.push(`${s} required but not found in your resume`);
  for (const s of out.skills.preferredMissing.slice(0, 3)) concerns.push(`${s} listed as preferred but not found in your resume`);
  return { reasons, concerns };
}

export function explanationText(level: MatchLevel, score: number, reasons: string[], concerns: string[]): string {
  const label = { VERY_STRONG: "Very Strong Match", STRONG: "Strong Match", GOOD: "Good Match", PARTIAL: "Partial Match", LOW: "Low Match" }[level];
  // Guardrail (PRD §90): never claim certainty about qualification.
  const lines = [`${label} — ${score}% based on the information in your resume.`];
  if (reasons.length) lines.push(...reasons.map((r) => `✓ ${r}`));
  if (concerns.length) lines.push(...concerns.map((c) => `△ ${c}`));
  return lines.join("\n");
}

export function toMatchResult(
  jobId: string,
  out: ScoreOutput,
  location: LocationMatch,
  candidateYears: number,
  evaluatedBy: MatchResult["evaluatedBy"],
  aiSummary: string | null = null,
  extra?: { reasons?: string[]; concerns?: string[] },
): MatchResult {
  const base = buildReasons(out, location, candidateYears);
  return {
    jobId,
    score: out.score,
    matchLevel: out.level,
    confidence: out.confidence,
    skills: { matched: out.skills.matched, missing: out.skills.missing, preferredMissing: out.skills.preferredMissing, inferred: out.skills.inferred },
    experience: { requiredYears: out.experience.requiredYears, candidateYears, match: out.experience.match },
    location: { match: location.match !== false, reason: location.reason },
    workMode: { match: out.workMode.match },
    reasons: dedupe([...base.reasons, ...(extra?.reasons ?? [])]).slice(0, 12),
    concerns: dedupe([...base.concerns, ...(extra?.concerns ?? [])]).slice(0, 8),
    breakdown: out.breakdown,
    aiSummary,
    evaluatedBy,
  };
}

const dedupe = (xs: string[]) => [...new Set(xs)];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const formatYears = (y: number) => (Number.isInteger(y) ? String(y) : y.toFixed(1));
