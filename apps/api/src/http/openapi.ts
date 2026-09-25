import * as S from "@jobagent/shared";
import { z } from "zod";

type Op = { method: "get" | "post" | "put" | "delete"; path: string; summary: string; body?: z.ZodType; response?: z.ZodType; query?: z.ZodType; tag: string };

/** API contract (PRD §123), generated from the shared Zod schemas used by both apps. */
const ops: Op[] = [
  { tag: "Auth", method: "get", path: "/auth/config", summary: "Sign-in configuration", response: S.AuthConfig },
  { tag: "Auth", method: "post", path: "/auth/google", summary: "Sign in with a Google ID token", body: S.GoogleAuthInput, response: S.Me },
  { tag: "Auth", method: "post", path: "/auth/logout", summary: "Sign out" },
  { tag: "Me", method: "get", path: "/me", summary: "Current user", response: S.Me },
  { tag: "Me", method: "put", path: "/me", summary: "Update user", body: S.UpdateMeInput, response: S.Me },
  { tag: "Me", method: "get", path: "/me/export", summary: "Export my data" },
  { tag: "Me", method: "delete", path: "/me", summary: "Delete my account" },
  { tag: "Me", method: "delete", path: "/me/history", summary: "Delete job history" },
  { tag: "Me", method: "get", path: "/overview", summary: "Dashboard overview", response: S.Overview },
  { tag: "Profile", method: "get", path: "/profile", summary: "Active candidate profile", response: S.CandidateProfile.nullable() },
  { tag: "Profile", method: "put", path: "/profile", summary: "Edit extracted profile (creates a new version)", body: S.UpdateProfileInput, response: S.CandidateProfile },
  { tag: "Resumes", method: "get", path: "/resumes", summary: "Resume versions", response: z.array(S.Resume) },
  { tag: "Resumes", method: "post", path: "/resumes", summary: "Upload resume (multipart field `file`: PDF, DOCX, TXT)", response: S.Resume },
  { tag: "Resumes", method: "delete", path: "/resumes/{id}", summary: "Delete a resume and its embeddings" },
  { tag: "Resumes", method: "get", path: "/resumes/{id}/download-url", summary: "Signed 5-minute download link" },
  { tag: "Preferences", method: "get", path: "/preferences", summary: "Job preferences", response: S.Preferences },
  { tag: "Preferences", method: "put", path: "/preferences", summary: "Update job preferences", body: S.Preferences, response: S.Preferences },
  { tag: "Preferences", method: "get", path: "/locations", summary: "Location hierarchy", response: z.array(S.Location) },
  { tag: "Sources", method: "get", path: "/sources", summary: "My career sources", response: z.array(S.JobSource) },
  { tag: "Sources", method: "post", path: "/sources/validate", summary: "Validate a career page URL", body: S.ValidateSourceInput, response: S.SourceValidation },
  { tag: "Sources", method: "post", path: "/sources", summary: "Add a career page", body: S.CreateSourceInput, response: S.JobSource },
  { tag: "Sources", method: "put", path: "/sources/{id}", summary: "Rename / pause / resume", body: S.UpdateSourceInput, response: S.JobSource },
  { tag: "Sources", method: "delete", path: "/sources/{id}", summary: "Remove a source" },
  { tag: "Sources", method: "get", path: "/portals", summary: "Job portals", response: z.array(S.Portal) },
  { tag: "Jobs", method: "get", path: "/jobs", summary: "Job feed & search", query: S.JobListQuery, response: S.Paginated(S.JobCard) },
  { tag: "Jobs", method: "get", path: "/jobs/{id}", summary: "Job details with match explanation", response: S.JobDetails },
  { tag: "Jobs", method: "post", path: "/jobs/{id}/save", summary: "Save job" },
  { tag: "Jobs", method: "post", path: "/jobs/{id}/dismiss", summary: "Dismiss job", body: S.DismissInput },
  { tag: "Jobs", method: "post", path: "/jobs/{id}/feedback", summary: "Relevance feedback", body: S.FeedbackInput },
  { tag: "Jobs", method: "get", path: "/matches", summary: "Matched jobs", response: S.Paginated(S.JobCard) },
  { tag: "Agent", method: "post", path: "/agent/run", summary: "Queue a matching run" },
  { tag: "Agent", method: "post", path: "/agent/run-now", summary: "Run the agent now: crawl my sources, match, email new matches", response: S.ManualRunState },
  { tag: "Agent", method: "get", path: "/agent/run-now", summary: "Progress of the latest manual run", response: S.ManualRunState.nullable() },
  { tag: "Agent", method: "get", path: "/agent/status", summary: "Latest agent run", response: S.AgentRunStatus },
  { tag: "Notifications", method: "get", path: "/notifications", summary: "Digest history", response: z.array(S.NotificationItem) },
  { tag: "Notifications", method: "get", path: "/notification-settings", summary: "Digest settings", response: S.NotificationSettings },
  { tag: "Notifications", method: "put", path: "/notification-settings", summary: "Update digest settings", body: S.NotificationSettings, response: S.NotificationSettings },
  { tag: "Admin", method: "get", path: "/admin/overview", summary: "Platform overview" },
  { tag: "Admin", method: "get", path: "/admin/settings", summary: "Platform settings", response: S.PlatformSettings },
  { tag: "Admin", method: "put", path: "/admin/settings", summary: "Update platform settings", body: S.PlatformSettings.partial(), response: S.PlatformSettings },
  { tag: "Admin", method: "get", path: "/admin/flags", summary: "Feature flags", response: z.array(S.FeatureFlag) },
];

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" });

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.path.includes("{id}") ? { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }] } : {}),
      ...(op.query ? { parameters: Object.entries((schema(op.query) as { properties?: Record<string, unknown> }).properties ?? {}).map(([name, s]) => ({ name, in: "query", schema: s })) } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(op.body) } } } } : {}),
      responses: {
        [op.method === "post" && op.response ? "201" : op.response ? "200" : "204"]: op.response ? { description: "OK", content: { "application/json": { schema: schema(op.response) } } } : { description: "No content" },
        "4XX": { description: "Error", content: { "application/json": { schema: schema(S.ApiError) } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "AI Job Agent API", version: "1.0.0", description: "Session cookie auth. Mutating requests require the `x-csrf-token` header (value of the `ja_csrf` cookie)." },
    servers: [{ url: "/api/v1" }],
    paths,
  };
}
