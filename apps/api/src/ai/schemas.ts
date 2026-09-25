import { z } from "zod";

/**
 * Schemas sent to LLM structured-output APIs. Kept deliberately simple (all fields required,
 * nullable instead of optional, no numeric bounds) for broad provider compatibility.
 * Results are mapped/clamped into the domain schemas afterwards.
 */
const SeniorityOrNull = z.enum(["INTERN", "JUNIOR", "MID", "SENIOR", "LEAD", "PRINCIPAL", "EXECUTIVE"]).nullable();

export const LlmResumeProfile = z.object({
  name: z.string(),
  summary: z.string(),
  yearsOfExperience: z.number(),
  education: z.array(z.object({ degree: z.string(), field: z.string(), institution: z.string(), year: z.number().nullable() })),
  skills: z.array(z.string()),
  technicalSkills: z.array(z.string()),
  softSkills: z.array(z.string()),
  jobTitles: z.array(z.string()),
  industries: z.array(z.string()),
  companies: z.array(z.string()),
  certifications: z.array(z.string()),
  locations: z.array(z.string()),
  preferredLocations: z.array(z.string()),
  preferredWorkMode: z.array(z.enum(["REMOTE", "HYBRID", "ONSITE"])),
  seniority: SeniorityOrNull,
});
export type LlmResumeProfile = z.infer<typeof LlmResumeProfile>;

export const LlmJobUnderstanding = z.object({
  requiredSkills: z.array(z.string()),
  requiredAnyOf: z.array(z.array(z.string())),
  preferredSkills: z.array(z.string()),
  requiredYears: z.number().nullable(),
  seniority: SeniorityOrNull,
  workMode: z.enum(["REMOTE", "HYBRID", "ONSITE"]).nullable(),
  employmentType: z.enum(["FULL_TIME", "CONTRACT", "PART_TIME", "INTERNSHIP", "TEMPORARY"]).nullable(),
  summary: z.string(),
});
export type LlmJobUnderstanding = z.infer<typeof LlmJobUnderstanding>;

export const LlmMatchEvaluation = z.object({
  requiredSkillsMatched: z.array(z.string()),
  requiredSkillsMissing: z.array(z.string()),
  preferredSkillsMissing: z.array(z.string()),
  inferredSkills: z.array(z.string()),
  requiredYears: z.number().nullable(),
  experienceMatch: z.boolean().nullable(),
  seniorityMatch: z.boolean().nullable(),
  preferenceFit: z.enum(["ALIGNED", "NEUTRAL", "CONFLICTS"]),
  preferenceNote: z.string(),
  reasons: z.array(z.string()),
  concerns: z.array(z.string()),
  summary: z.string(),
});
export type LlmMatchEvaluation = z.infer<typeof LlmMatchEvaluation>;
