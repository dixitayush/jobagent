import { z } from "zod";

export const MatchLevel = z.enum(["VERY_STRONG", "STRONG", "GOOD", "PARTIAL", "LOW"]);
export type MatchLevel = z.infer<typeof MatchLevel>;

export const MATCH_LEVEL_LABELS: Record<MatchLevel, string> = {
  VERY_STRONG: "Very Strong Match",
  STRONG: "Strong Match",
  GOOD: "Good Match",
  PARTIAL: "Partial Match",
  LOW: "Low Match",
};

/** Ordered best → worst; used to compare "at least X" filters. */
export const MATCH_LEVEL_ORDER: MatchLevel[] = ["VERY_STRONG", "STRONG", "GOOD", "PARTIAL", "LOW"];

export const WorkMode = z.enum(["REMOTE", "HYBRID", "ONSITE"]);
export type WorkMode = z.infer<typeof WorkMode>;

export const EmploymentType = z.enum(["FULL_TIME", "CONTRACT", "PART_TIME", "INTERNSHIP", "TEMPORARY"]);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const Seniority = z.enum(["INTERN", "JUNIOR", "MID", "SENIOR", "LEAD", "PRINCIPAL", "EXECUTIVE"]);
export type Seniority = z.infer<typeof Seniority>;

export const Freshness = z.enum(["NEW", "RECENT", "EXISTING", "UPDATED", "CLOSED", "EXPIRED"]);
export type Freshness = z.infer<typeof Freshness>;

export const ConnectorType = z.enum([
  "GREENHOUSE",
  "LEVER",
  "WORKDAY",
  "ASHBY",
  "SMARTRECRUITERS",
  "ICIMS",
  "TALEO",
  "SUCCESSFACTORS",
  "EIGHTFOLD",
  "ORACLE",
  "GENERIC",
  "LINKEDIN",
  "NAUKRI",
]);
export type ConnectorType = z.infer<typeof ConnectorType>;

export const SourceStatus = z.enum(["ACTIVE", "PAUSED", "DEGRADED", "DISABLED"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const LocationType = z.enum(["COUNTRY", "STATE", "CITY", "REMOTE"]);
export type LocationType = z.infer<typeof LocationType>;

export const DismissReason = z.enum([
  "WRONG_LOCATION",
  "WRONG_SENIORITY",
  "MISSING_SKILLS",
  "WRONG_ROLE",
  "NOT_INTERESTED",
  "ALREADY_APPLIED",
]);
export type DismissReason = z.infer<typeof DismissReason>;

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  WRONG_LOCATION: "Wrong location",
  WRONG_SENIORITY: "Wrong seniority",
  MISSING_SKILLS: "Missing skills",
  WRONG_ROLE: "Wrong role",
  NOT_INTERESTED: "Not interested",
  ALREADY_APPLIED: "Already applied",
};

export const InteractionType = z.enum([
  "JOB_OPENED",
  "JOB_CLICKED",
  "JOB_SAVED",
  "JOB_UNSAVED",
  "JOB_DISMISSED",
  "JOB_APPLIED",
  "JOB_IGNORED",
  "COMPANY_FOLLOWED",
  "SKILL_CLICKED",
  "FEEDBACK_GOOD",
  "FEEDBACK_BAD",
  "EMAIL_OPENED",
  "EMAIL_CLICKED",
]);
export type InteractionType = z.infer<typeof InteractionType>;

export const ResumeStatus = z.enum(["UPLOADED", "PARSING", "PARSED", "FAILED"]);
export type ResumeStatus = z.infer<typeof ResumeStatus>;

export const JOBS_PER_NOTIFICATION_OPTIONS = [10, 15, 20, 25, 50] as const;
