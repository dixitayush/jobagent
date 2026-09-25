import { extractSkillsFromText, isSoftSkill, normalizeSkills } from "../domain/skills/taxonomy";
import { generateStructured, type LLMContext } from "./gateway";
import { JOB_UNDERSTANDING_SYSTEM, jobUnderstandingUser, PROMPT_VERSIONS } from "./prompts";
import { LlmJobUnderstanding } from "./schemas";

export interface JobRequirements {
  requiredSkills: string[];
  preferredSkills: string[];
  /** Groups of interchangeable required skills; a candidate needs any one per group. */
  requiredAnyOf: string[][];
  requiredYears: number | null;
  summary: string | null;
  method: "RULES" | "LLM";
  version: string;
}

/** Bump when rule-based extraction changes; stale jobs are re-extracted in the background. */
export const RULES_VERSION = "job_rules_v2";

const ALTERNATIVES = /\b(or|one of|any of|such as|e\.g\.|for example|equivalent|at least one)\b/i;
const PREFERRED_HEADING = /^(?:.*\b(?:preferred|nice[\s-]to[\s-]have|bonus|good[\s-]to[\s-]have|pluses|a plus|desired|desirable|optional)\b.*)$/i;
const REQUIRED_HEADING = /^(?:.*\b(?:requirements?|required|qualifications?|must[\s-]have|what you(?:'|’)ll need|what we(?:'|’)re looking for|you have|skills)\b.*)$/i;

/**
 * Deterministic requirement extraction (runs on every job; no LLM). Skills appearing only
 * in a "preferred / nice to have" section are PREFERRED; everything else is REQUIRED.
 * Inline "X is a plus" / "bonus: Y" sentences are also treated as preferred.
 */
export function extractRequirementsByRules(title: string, description: string, requiredYears: number | null): JobRequirements {
  const lines = description.split("\n");
  const required = new Set<string>(extractSkillsFromText(title));
  const preferred = new Set<string>();
  const anyOf: string[][] = [];
  let mode: "neutral" | "required" | "preferred" = "neutral";
  for (const line of lines) {
    const isHeading = line.length < 90 && !/^•/.test(line);
    if (isHeading && PREFERRED_HEADING.test(line)) mode = "preferred";
    else if (isHeading && REQUIRED_HEADING.test(line)) mode = "required";
    const skills = extractSkillsFromText(line).filter((s) => !isSoftSkill(s));
    if (!skills.length) continue;
    const inlinePreferred = /\b(a plus|is a plus|are a plus|nice to have|bonus|preferred|good to have|desirable)\b/i.test(line);
    const isPreferred = mode === "preferred" || inlinePreferred;
    // "Java, Go or Ruby", "one of…", "such as…", "or similar": alternatives, not a list of all-required skills.
    if (!isPreferred && skills.length >= 2 && ALTERNATIVES.test(line)) {
      anyOf.push(skills);
      continue;
    }
    for (const s of skills) (isPreferred ? preferred : required).add(s);
  }
  for (const s of required) preferred.delete(s);
  const grouped = new Set(anyOf.flat());
  for (const s of grouped) {
    required.delete(s);
    preferred.delete(s);
  }
  return {
    requiredSkills: [...required].slice(0, 25),
    preferredSkills: [...preferred].slice(0, 15),
    requiredAnyOf: anyOf.slice(0, 8),
    requiredYears,
    summary: null,
    method: "RULES",
    version: RULES_VERSION,
  };
}

/**
 * LLM job understanding — only invoked for shortlisted jobs, cached globally by description
 * hash so every user tracking the same job shares a single call (PRD §85).
 */
export async function understandJobWithLlm(
  job: { title: string; company: string; location: string; description: string; descriptionHash: string },
  ctx: LLMContext,
): Promise<(JobRequirements & { tokens: number; cost: number; seniority: string | null; workMode: string | null; employmentType: string | null }) | null> {
  const res = await generateStructured(
    {
      purpose: "job_understanding",
      promptVersion: PROMPT_VERSIONS.jobUnderstanding,
      system: JOB_UNDERSTANDING_SYSTEM,
      user: jobUnderstandingUser(job.title, job.company, job.location, job.description),
      schema: LlmJobUnderstanding,
      schemaName: "job_requirements",
      tier: "small",
      maxTokens: 4000,
    },
    ctx,
    job.descriptionHash,
  );
  if (!res) return null;
  const anyOf = res.data.requiredAnyOf.map((g) => normalizeSkills(g)).filter((g) => g.length >= 2).slice(0, 8);
  const grouped = new Set(anyOf.flat());
  const required = normalizeSkills(res.data.requiredSkills).filter((s) => !grouped.has(s));
  return {
    requiredSkills: required.slice(0, 25),
    requiredAnyOf: anyOf,
    preferredSkills: normalizeSkills(res.data.preferredSkills).filter((s) => !required.includes(s) && !grouped.has(s)).slice(0, 15),
    requiredYears: res.data.requiredYears !== null && res.data.requiredYears >= 0 && res.data.requiredYears <= 30 ? res.data.requiredYears : null,
    summary: res.data.summary.slice(0, 600) || null,
    seniority: res.data.seniority,
    workMode: res.data.workMode,
    employmentType: res.data.employmentType,
    method: "LLM",
    version: res.promptVersion,
    tokens: res.tokens,
    cost: res.cost,
  };
}
