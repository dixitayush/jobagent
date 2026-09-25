import { extractSkillsFromText, normalizeSkill, normalizeSkills, skillKey } from "../domain/skills/taxonomy";
import { generateStructured, type LLMContext } from "./gateway";
import { JOB_MATCH_SYSTEM, jobMatchUser, PROMPT_VERSIONS } from "./prompts";
import { LlmMatchEvaluation } from "./schemas";
import type { LlmMatchEvaluation as LlmMatchEvaluationT } from "./schemas";

export interface MatchEvidence {
  matched: string[];
  missing: string[];
  preferredMissing: string[];
  inferred: string[];
  requiredYears: number | null;
  preferenceFit: "ALIGNED" | "NEUTRAL" | "CONFLICTS";
  preferenceNote: string;
  reasons: string[];
  concerns: string[];
  summary: string;
  promptVersion: string;
  tokens: number;
  cost: number;
  /** Claims removed by verification (hallucinated skills/requirements). */
  rejectedClaims: number;
}

export interface MatchCandidateInput {
  skills: string[];
  yearsOfExperience: number;
  seniority: string | null;
  jobTitles: string[];
  education: string[];
  certifications: string[];
}

export interface MatchJobInput {
  title: string;
  company: string;
  location: string;
  description: string;
}

/** True when the job text actually mentions the skill (canonical name, alias, or literal). */
function jobMentions(job: MatchJobInput, skill: string, jobSkills: Set<string>): boolean {
  const clean = skill.replace(/^one of\s+/i, "");
  if (/\//.test(clean)) return clean.split("/").some((s) => jobMentions(job, s.trim(), jobSkills));
  if (jobSkills.has(skillKey(clean))) return true;
  return `${job.title}\n${job.description}`.toLowerCase().includes(clean.toLowerCase());
}

/**
 * Strong-model evaluation for borderline matches (PRD §49 level 4). The LLM returns *evidence*;
 * the deterministic scorer turns it into the final score (PRD §24). Output is verified against the
 * source data before use: matched skills must exist in the candidate profile and gaps must be
 * mentioned in the job posting. Candidate PII (name, contact) is never sent.
 */
export async function evaluateMatchWithLlm(
  candidate: MatchCandidateInput,
  prefs: { locations: string[]; workModes: string[]; employmentTypes: string[]; jobTitles: string[] },
  memory: { text: string; similarDecisions: string },
  job: MatchJobInput,
  ctx: LLMContext,
  cacheKey: string,
): Promise<MatchEvidence | null> {
  const res = await generateStructured(
    {
      purpose: "job_match",
      promptVersion: PROMPT_VERSIONS.jobMatch,
      system: JOB_MATCH_SYSTEM,
      user: jobMatchUser(JSON.stringify(candidate), JSON.stringify(prefs), memory.text, memory.similarDecisions, job),
      schema: LlmMatchEvaluation,
      schemaName: "match_evaluation",
      tier: "strong",
      maxTokens: 16_000,
      // Same user → same static prefix (instructions + candidate + memory) → prompt-cache hits.
      promptCacheKey: ctx.userId ? `job_match:${ctx.userId}` : undefined,
    },
    ctx,
    cacheKey,
  );
  if (!res) return null;
  const v = verifyEvidence(res.data, candidate, job);
  return { ...v, promptVersion: res.promptVersion, tokens: res.tokens, cost: res.cost };
}

/**
 * Verification pass over the model's evidence (guards against hallucination): matched skills must be
 * in the candidate profile (otherwise demoted to inferred), and gaps must be mentioned by the posting.
 */
export function verifyEvidence(
  d: LlmMatchEvaluationT,
  candidate: Pick<MatchCandidateInput, "skills">,
  job: MatchJobInput,
): Omit<MatchEvidence, "promptVersion" | "tokens" | "cost"> {
  const clean = (xs: string[], n: number) => xs.map((x) => x.trim()).filter((x) => x && x.length < 200).slice(0, n);
  const have = new Set(candidate.skills.map(skillKey));
  const jobSkills = new Set(extractSkillsFromText(`${job.title}\n${job.description}`).map(skillKey));
  let rejected = 0;
  const keep = (ok: boolean) => (ok ? true : (rejected++, false));

  const claimedMatched = normalizeSkills(d.requiredSkillsMatched);
  const matched = claimedMatched.filter((s) => keep(have.has(skillKey(s))));
  const demoted = claimedMatched.filter((s) => !have.has(skillKey(s)));
  const missing = d.requiredSkillsMissing
    .map((s) => (/^one of /i.test(s) ? s.trim() : normalizeSkill(s)))
    .filter((s) => s && !have.has(skillKey(s)) && keep(jobMentions(job, s, jobSkills)));
  const preferredMissing = normalizeSkills(d.preferredSkillsMissing).filter((s) => !have.has(skillKey(s)) && keep(jobMentions(job, s, jobSkills)));
  const inferred = normalizeSkills([...d.inferredSkills, ...demoted]).filter((s) => !matched.includes(s) && jobMentions(job, s, jobSkills));
  return {
    matched,
    missing: [...new Set(missing)],
    preferredMissing,
    inferred,
    requiredYears: d.requiredYears !== null && d.requiredYears >= 0 && d.requiredYears <= 30 ? d.requiredYears : null,
    preferenceFit: d.preferenceFit,
    preferenceNote: d.preferenceNote.slice(0, 300),
    reasons: clean(d.reasons, 5).filter((r) => !/100%|fully qualified|perfect(ly)? qualified/i.test(r)),
    concerns: clean(d.concerns, 5),
    summary: d.summary.slice(0, 600),
    rejectedClaims: rejected,
  };
}
