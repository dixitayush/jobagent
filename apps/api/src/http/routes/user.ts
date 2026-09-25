import { Router } from "express";
import multer from "multer";
import {
  AgentRunStatus,
  NotificationSettings,
  Preferences,
  UpdateMeInput,
  UpdateProfileInput,
  type NotificationItem,
} from "@jobagent/shared";
import { finalizeProfile } from "../../ai/resumeExtractor";
import { env } from "../../config/env";
import { query, queryOne } from "../../db/pool";
import { notFound } from "../../lib/errors";
import { signToken, verifyToken } from "../../lib/crypto";
import { enqueue } from "../../queue/queues";
import { getOverview } from "../../services/jobService";
import { getManualRunState, startManualRun } from "../../services/manualRun";
import { getNotificationSettings, getPreferences, updateNotificationSettings, updatePreferences } from "../../services/preferencesService";
import { deleteAccount, deleteJobHistory, exportUserData } from "../../services/privacyService";
import { publicLocations } from "../../services/referenceData";
import { deleteResume, getActiveProfile, getResumeRow, listResumes, saveProfileVersion, uploadResume } from "../../services/resumeService";
import { audit, getMe, updateMe } from "../../services/userService";
import { storage } from "../../storage/storage";
import { clearSession, limiter, parse, tenant, uuidParam } from "../middleware";
import { cached } from "../../lib/redis";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_RESUME_BYTES, files: 1 } });

export const userRouter = Router();

/* ── Me / privacy ── */
userRouter.get("/me", async (req, res) => res.json(await getMe(tenant(req))));
userRouter.put("/me", async (req, res) => res.json(await updateMe(tenant(req), parse(UpdateMeInput, req.body))));
userRouter.get("/me/export", limiter("export", { windowMs: 3_600_000, limit: 5 }), async (req, res) => {
  const ctx = tenant(req);
  await audit(ctx, "DATA_EXPORT", undefined, req.ip);
  res.setHeader("content-disposition", 'attachment; filename="jobagent-export.json"');
  res.json(await exportUserData(ctx));
});
userRouter.delete("/me/history", async (req, res) => {
  const ctx = tenant(req);
  await deleteJobHistory(ctx);
  await audit(ctx, "JOB_HISTORY_DELETED", undefined, req.ip);
  res.status(204).end();
});
userRouter.delete("/me", async (req, res) => {
  const ctx = tenant(req);
  await audit({}, "ACCOUNT_DELETED", { type: "user", id: ctx.userId }, req.ip);
  await deleteAccount(ctx);
  clearSession(res);
  res.status(204).end();
});

userRouter.get("/overview", async (req, res) => {
  const me = await getMe(tenant(req));
  res.json(await getOverview(tenant(req), me.name, me.timezone));
});

/* ── Candidate profile ── */
userRouter.get("/profile", async (req, res) => res.json(await getActiveProfile(tenant(req))));
userRouter.put("/profile", async (req, res) => {
  const ctx = tenant(req);
  const current = await getActiveProfile(ctx);
  if (!current) throw notFound("Upload a resume first");
  const patch = parse(UpdateProfileInput, req.body);
  // User edits create a new profile version; normalization still applies.
  const merged = finalizeProfile({ ...current.profile, ...patch }, "");
  await saveProfileVersion(ctx, merged, { resumeId: current.resumeId, editedByUser: true, promptVersion: null });
  await enqueue("match", { ...ctx, trigger: "PROFILE_EDITED" }, { jobId: `match:${ctx.userId}:${Date.now()}` });
  res.json(await getActiveProfile(ctx));
});

/* ── Resumes ── */
userRouter.get("/resumes", async (req, res) => res.json(await listResumes(tenant(req))));
userRouter.post("/resumes", limiter("resume-upload", { windowMs: 3_600_000, limit: 10 }), upload.single("file"), async (req, res) => {
  if (!req.file) throw notFound("No file uploaded");
  const ctx = tenant(req);
  const resume = await uploadResume(ctx, req.auth!.plan, req.file);
  await audit(ctx, "RESUME_UPLOADED", { type: "resume", id: resume.id }, req.ip);
  res.status(201).json(resume);
});
userRouter.delete("/resumes/:id", async (req, res) => {
  const ctx = tenant(req);
  await deleteResume(ctx, uuidParam(req));
  await audit(ctx, "RESUME_DELETED", { type: "resume", id: uuidParam(req) }, req.ip);
  res.status(204).end();
});
/** Signed, short-lived (5 min), user-bound download link (PRD §65). */
userRouter.get("/resumes/:id/download-url", async (req, res) => {
  const ctx = tenant(req);
  const row = await getResumeRow(ctx, uuidParam(req));
  res.json({ url: `/api/v1/files/resume?token=${signToken({ r: row.id, u: ctx.userId, t: ctx.tenantId }, 300)}`, expiresInSeconds: 300 });
});
userRouter.get("/files/resume", async (req, res) => {
  const ctx = tenant(req);
  const claims = verifyToken<{ r: string; u: string; t: string }>(String(req.query.token ?? ""));
  if (!claims || claims.u !== ctx.userId || claims.t !== ctx.tenantId) throw notFound("Link expired");
  const row = await getResumeRow(ctx, claims.r);
  const buf = await storage().get(row.storage_key);
  res.setHeader("content-type", row.mime_type);
  res.setHeader("content-disposition", `attachment; filename="${row.file_name.replace(/"/g, "")}"`);
  res.setHeader("cache-control", "private, no-store");
  res.send(buf);
});

/* ── Preferences & locations ── */
userRouter.get("/preferences", async (req, res) => res.json(await getPreferences(tenant(req))));
userRouter.put("/preferences", async (req, res) => {
  const ctx = tenant(req);
  const prefs = await updatePreferences(ctx, parse(Preferences, req.body));
  await enqueue("match", { ...ctx, trigger: "PREFERENCES_UPDATED" }, { jobId: `match:${ctx.userId}:${Date.now()}` });
  res.json(prefs);
});
userRouter.get("/locations", async (_req, res) => {
  res.setHeader("cache-control", "private, max-age=3600");
  res.json(await cached("locations:v1", 3600, publicLocations));
});

/* ── Notifications ── */
userRouter.get("/notification-settings", async (req, res) => res.json(await getNotificationSettings(tenant(req))));
userRouter.put("/notification-settings", async (req, res) => {
  res.json(await updateNotificationSettings(tenant(req), req.auth!.plan, parse(NotificationSettings, req.body)));
});
userRouter.get("/notifications", async (req, res) => {
  const ctx = tenant(req);
  const rows = await query<{ id: string; notification_window: string; status: string; job_count: number; subject: string | null; sent_at: Date | null; created_at: Date }>(
    "SELECT id, notification_window, status, job_count, subject, sent_at, created_at FROM notifications WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 50",
    [ctx.tenantId, ctx.userId],
  );
  const items: NotificationItem[] = rows.map((r) => ({ id: r.id, window: r.notification_window, status: r.status, jobCount: r.job_count, subject: r.subject, sentAt: r.sent_at?.toISOString() ?? null, createdAt: r.created_at.toISOString() }));
  res.json(items);
});

/* ── Agent ── */
userRouter.get("/agent/status", async (req, res) => {
  const ctx = tenant(req);
  const r = await queryOne<{ id: string; status: string; started_at: Date; completed_at: Date | null; jobs_discovered: number; jobs_filtered: number; jobs_matched: number; jobs_selected: number; error: string | null }>(
    "SELECT * FROM agent_runs WHERE tenant_id = $1 AND user_id = $2 AND type IN ('MATCH','RESUME') ORDER BY started_at DESC LIMIT 1",
    [ctx.tenantId, ctx.userId],
  );
  const body: AgentRunStatus = {
    running: r?.status === "RUNNING",
    lastRun: r
      ? { id: r.id, status: r.status, startedAt: r.started_at.toISOString(), completedAt: r.completed_at?.toISOString() ?? null, jobsDiscovered: r.jobs_discovered, jobsFiltered: r.jobs_filtered, jobsMatched: r.jobs_matched, jobsSelected: r.jobs_selected, error: r.error }
      : null,
  };
  res.json(body);
});
/**
 * "Run agent now": crawl this user's sources → match → email new matches. Queued; the dashboard
 * polls GET /agent/run-now for progress. Rate limited per user.
 */
userRouter.post("/agent/run-now", limiter("agent-run-now", { windowMs: 3_600_000, limit: 3, skipFailedRequests: true }), async (req, res) => {
  const ctx = tenant(req);
  const state = await startManualRun(ctx);
  await audit(ctx, "AGENT_MANUAL_RUN", undefined, req.ip);
  res.status(202).json(state);
});
userRouter.get("/agent/run-now", async (req, res) => {
  res.json(await getManualRunState(tenant(req).userId));
});

/** Manual "find matches now". Queued — the API never waits for the agent (PRD §129). */
userRouter.post("/agent/run", limiter("agent-run", { windowMs: 3_600_000, limit: 6 }), async (req, res) => {
  const ctx = tenant(req);
  await enqueue("match", { ...ctx, trigger: "MANUAL" }, { jobId: `match:${ctx.userId}:manual:${Math.floor(Date.now() / 30_000)}` });
  res.status(202).json({ queued: true });
});

