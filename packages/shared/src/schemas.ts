import { z } from "zod";
import {
  ConnectorType,
  DismissReason,
  EmploymentType,
  Freshness,
  InteractionType,
  LocationType,
  MatchLevel,
  ResumeStatus,
  Seniority,
  SourceStatus,
  WorkMode,
} from "./enums";

/* ───────────────────────────── Candidate profile (PRD §10) ───────────────────────────── */

export const EducationEntry = z.object({
  degree: z.string().default(""),
  field: z.string().default(""),
  institution: z.string().default(""),
  year: z.number().int().nullable().default(null),
});
export type EducationEntry = z.infer<typeof EducationEntry>;

export const CandidateProfileData = z.object({
  name: z.string().default(""),
  summary: z.string().default(""),
  yearsOfExperience: z.number().min(0).max(60).default(0),
  education: z.array(EducationEntry).default([]),
  skills: z.array(z.string()).default([]),
  technicalSkills: z.array(z.string()).default([]),
  softSkills: z.array(z.string()).default([]),
  jobTitles: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  companies: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  preferredLocations: z.array(z.string()).default([]),
  preferredWorkMode: z.array(WorkMode).default([]),
  seniority: Seniority.nullable().default(null),
});
export type CandidateProfileData = z.infer<typeof CandidateProfileData>;

/* ───────────────────────────── Match result (PRD §92) ───────────────────────────── */

export const MatchBreakdown = z.object({
  skills: z.number(),
  experience: z.number(),
  title: z.number(),
  semantic: z.number(),
  location: z.number(),
  seniority: z.number(),
  workMode: z.number(),
  personalization: z.number().default(0),
});
export type MatchBreakdown = z.infer<typeof MatchBreakdown>;

export const MatchResult = z.object({
  jobId: z.string(),
  score: z.number().int().min(0).max(100),
  matchLevel: MatchLevel,
  confidence: z.number().min(0).max(1),
  skills: z.object({
    matched: z.array(z.string()),
    missing: z.array(z.string()),
    preferredMissing: z.array(z.string()),
    inferred: z.array(z.string()).default([]),
  }),
  experience: z.object({
    requiredYears: z.number().nullable(),
    candidateYears: z.number().nullable(),
    match: z.boolean().nullable(),
  }),
  location: z.object({ match: z.boolean(), reason: z.string() }),
  workMode: z.object({ match: z.boolean().nullable() }),
  reasons: z.array(z.string()),
  concerns: z.array(z.string()),
  breakdown: MatchBreakdown,
  aiSummary: z.string().nullable().default(null),
  evaluatedBy: z.enum(["RULES", "RULES_VECTOR", "LLM"]),
});
export type MatchResult = z.infer<typeof MatchResult>;

/* ───────────────────────────── API DTOs ───────────────────────────── */

export const Me = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  profilePicture: z.string().nullable(),
  role: z.enum(["user", "admin"]),
  timezone: z.string(),
  plan: z.string(),
  onboardingCompleted: z.boolean(),
  personalizationEnabled: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

export const UpdateMeInput = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  onboardingCompleted: z.boolean().optional(),
  personalizationEnabled: z.boolean().optional(),
});
export type UpdateMeInput = z.infer<typeof UpdateMeInput>;

export const GoogleAuthInput = z.object({ credential: z.string().min(10) });
export const DevAuthInput = z.object({ email: z.string().email(), name: z.string().min(1).max(120) });

export const AuthConfig = z.object({
  googleClientId: z.string().nullable(),
  devLoginEnabled: z.boolean(),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

export const Resume = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: ResumeStatus,
  isActive: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Resume = z.infer<typeof Resume>;

export const CandidateProfile = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  resumeId: z.string().uuid().nullable(),
  profile: CandidateProfileData,
  normalizedSkills: z.array(z.string()),
  editedByUser: z.boolean(),
  hasEmbedding: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CandidateProfile = z.infer<typeof CandidateProfile>;

export const UpdateProfileInput = CandidateProfileData.partial();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const Location = z.object({
  id: z.number().int(),
  name: z.string(),
  type: LocationType,
  parentId: z.number().int().nullable(),
  countryCode: z.string().nullable(),
});
export type Location = z.infer<typeof Location>;

export const Preferences = z.object({
  jobTitles: z.array(z.string().min(1).max(120)).max(20),
  locationIds: z.array(z.number().int()).max(50),
  preferredCompanies: z.array(z.string().min(1).max(120)).max(100),
  blockedCompanies: z.array(z.string().min(1).max(120)).max(100),
  minExperience: z.number().int().min(0).max(50).nullable(),
  maxExperience: z.number().int().min(0).max(60).nullable(),
  workModes: z.array(WorkMode),
  employmentTypes: z.array(EmploymentType),
  includeRecentJobs: z.boolean(),
  enabledPortals: z.array(ConnectorType),
});
export type Preferences = z.infer<typeof Preferences>;

export const NotificationSettings = z.object({
  morningEnabled: z.boolean(),
  morningTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  eveningEnabled: z.boolean(),
  eveningTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  jobsPerNotification: z.number().int().min(1).max(100),
  minMatchLevel: MatchLevel,
  emailEnabled: z.boolean(),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const SourceHealth = z.object({
  lastCrawledAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  lastHttpStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  jobsFound: z.number().int(),
  avgCrawlMs: z.number().int().nullable(),
  failureCount: z.number().int(),
  consecutiveFailures: z.number().int(),
  nextCrawlAt: z.string().nullable(),
});
export type SourceHealth = z.infer<typeof SourceHealth>;

export const JobSource = z.object({
  id: z.string().uuid(),
  sourceConnectorId: z.string().uuid(),
  companyName: z.string(),
  sourceUrl: z.string(),
  connectorType: ConnectorType,
  status: z.enum(["ACTIVE", "PAUSED"]),
  globalStatus: SourceStatus,
  health: SourceHealth,
  createdAt: z.string(),
});
export type JobSource = z.infer<typeof JobSource>;

export const ValidateSourceInput = z.object({
  companyName: z.string().min(1).max(120),
  sourceUrl: z.string().url().max(2048),
});
export type ValidateSourceInput = z.infer<typeof ValidateSourceInput>;

export const ValidationCheck = z.object({ label: z.string(), ok: z.boolean(), detail: z.string().optional() });
export const SourceValidation = z.object({
  ok: z.boolean(),
  connectorType: ConnectorType.nullable(),
  normalizedUrl: z.string().nullable(),
  jobsDetected: z.number().int(),
  crawlStrategy: z.string().nullable(),
  checks: z.array(ValidationCheck),
  sampleTitles: z.array(z.string()),
});
export type SourceValidation = z.infer<typeof SourceValidation>;

export const CreateSourceInput = ValidateSourceInput;
export const UpdateSourceInput = z.object({
  companyName: z.string().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export const Portal = z.object({
  type: ConnectorType,
  name: z.string(),
  available: z.boolean(),
  enabled: z.boolean(),
  note: z.string(),
});
export type Portal = z.infer<typeof Portal>;

export const JobCard = z.object({
  id: z.string().uuid(),
  title: z.string(),
  company: z.string(),
  locations: z.array(z.string()),
  workMode: WorkMode.nullable(),
  employmentType: EmploymentType.nullable(),
  postedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  freshness: Freshness,
  source: ConnectorType,
  url: z.string(),
  score: z.number().int().nullable(),
  matchLevel: MatchLevel.nullable(),
  /** Score components (for the fit strip); null when not scored. */
  fit: MatchBreakdown.nullable(),
  topSkills: z.array(z.string()),
  saved: z.boolean(),
  dismissed: z.boolean(),
});
export type JobCard = z.infer<typeof JobCard>;

export const JobDetails = JobCard.extend({
  description: z.string(),
  salaryText: z.string().nullable(),
  seniority: Seniority.nullable(),
  requiredYears: z.number().nullable(),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  match: MatchResult.nullable(),
  explanation: z.string().nullable(),
});
export type JobDetails = z.infer<typeof JobDetails>;

export const JobSort = z.enum(["BEST_MATCH", "NEWEST", "COMPANY", "SCORE"]);
export type JobSort = z.infer<typeof JobSort>;

export const JobListQuery = z.object({
  company: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  matchLevel: MatchLevel.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  postedWithinDays: z.coerce.number().int().min(1).max(90).optional(),
  workMode: WorkMode.optional(),
  employmentType: EmploymentType.optional(),
  skill: z.string().max(60).optional(),
  source: ConnectorType.optional(),
  q: z.string().max(120).optional(),
  view: z.enum(["matches", "all", "saved", "dismissed"]).default("matches"),
  sort: JobSort.default("BEST_MATCH"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type JobListQuery = z.infer<typeof JobListQuery>;

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });

export const DismissInput = z.object({ reason: DismissReason.optional() });
export const FeedbackInput = z.object({ helpful: z.boolean() });
export const InteractionInput = z.object({
  type: InteractionType,
  jobId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const Overview = z.object({
  greetingName: z.string(),
  jobsDiscoveredToday: z.number().int(),
  newJobs: z.number().int(),
  highlyRelevant: z.number().int(),
  strongMatches: z.number().int(),
  veryStrongMatches: z.number().int(),
  jobsSentToday: z.number().int(),
  savedJobs: z.number().int(),
  applicationsTracked: z.number().int(),
  lastAgentRun: z.string().nullable(),
  nextAgentRun: z.string().nullable(),
  nextEmail: z.string().nullable(),
  setup: z.object({
    hasResume: z.boolean(),
    hasLocations: z.boolean(),
    hasRoles: z.boolean(),
    sourceCount: z.number().int(),
    skillCount: z.number().int(),
    jobsIndexed: z.number().int(),
  }),
  failingSources: z.array(z.string()),
});
export type Overview = z.infer<typeof Overview>;

export const NotificationItem = z.object({
  id: z.string().uuid(),
  window: z.string(),
  status: z.string(),
  jobCount: z.number().int(),
  subject: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const AgentRunStatus = z.object({
  running: z.boolean(),
  lastRun: z
    .object({
      id: z.string().uuid(),
      status: z.string(),
      startedAt: z.string(),
      completedAt: z.string().nullable(),
      jobsDiscovered: z.number().int(),
      jobsFiltered: z.number().int(),
      jobsMatched: z.number().int(),
      jobsSelected: z.number().int(),
      error: z.string().nullable(),
    })
    .nullable(),
});
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

/* ───────────────────────────── Admin ───────────────────────────── */

export const PlatformSettings = z.object({
  crawlingPaused: z.boolean(),
  notificationsPaused: z.boolean(),
  llmProvider: z.enum(["anthropic", "openai", "gemini", "none"]),
  llmModel: z.string().min(1),
  llmSmallModel: z.string().min(1),
  llmTemperature: z.number().min(0).max(1),
  embeddingProvider: z.enum(["openai", "gemini", "local"]),
  defaultCrawlIntervalMinutes: z.number().int().min(15).max(10080),
  maxJobsPerNotification: z.number().int().min(1).max(100),
  matchThresholds: z.object({
    veryStrong: z.number().int(),
    strong: z.number().int(),
    good: z.number().int(),
    partial: z.number().int(),
  }),
  llmBorderline: z.object({ min: z.number().int(), max: z.number().int() }),
  retrievalLimit: z.number().int().min(10).max(1000),
  llmMaxJobsPerRun: z.number().int().min(0).max(500),
  planLimits: z.record(
    z.string(),
    z.object({
      maxSources: z.number().int(),
      maxResumeVersions: z.number().int(),
      maxJobsPerNotification: z.number().int(),
      notificationsPerDay: z.number().int(),
    }),
  ),
  retentionDays: z.object({ agentLogs: z.number().int(), llmRequests: z.number().int() }),
});
export type PlatformSettings = z.infer<typeof PlatformSettings>;

export const FeatureFlag = z.object({ key: z.string(), enabled: z.boolean(), description: z.string() });
export type FeatureFlag = z.infer<typeof FeatureFlag>;

export const AdminSourceUpdate = z.object({
  status: SourceStatus.optional(),
  crawlIntervalMinutes: z.number().int().min(15).max(10080).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(600).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  crawlDelayMs: z.number().int().min(0).max(60000).optional(),
});

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;

/* ───────────────────────────── Manual agent run ("Run agent now") ───────────────────────────── */

export const ManualRunStep = z.enum(["QUEUED", "CRAWLING", "MATCHING", "EMAILING", "DONE", "FAILED"]);
export type ManualRunStep = z.infer<typeof ManualRunStep>;

export const ManualRunState = z.object({
  runKey: z.string(),
  step: ManualRunStep,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  sourcesTotal: z.number().int(),
  sourcesCrawled: z.number().int(),
  sourcesSkippedFresh: z.number().int(),
  sourcesFailed: z.array(z.string()),
  newJobs: z.number().int(),
  matched: z.number().int(),
  emailedJobs: z.number().int(),
  emailStatus: z.enum(["PENDING", "SENT", "NOTHING_NEW", "DISABLED", "FAILED"]),
  message: z.string(),
});
export type ManualRunState = z.infer<typeof ManualRunState>;
