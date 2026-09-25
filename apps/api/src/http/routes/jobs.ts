import { Router } from "express";
import { CreateSourceInput, DismissInput, FeedbackInput, InteractionInput, JobListQuery, UpdateSourceInput, ValidateSourceInput } from "@jobagent/shared";
import { z } from "zod";
import { badRequest } from "../../lib/errors";
import { dismissJob, getJob, listJobs, recordInteraction, saveJob } from "../../services/jobService";
import { getPreferences, updatePreferences } from "../../services/preferencesService";
import { createSource, deleteSource, listPortals, listSources, updateSource } from "../../services/sourceService";
import { validateSource } from "../../services/sourceValidation";
import { audit } from "../../services/userService";
import { limiter, parse, tenant, uuidParam } from "../middleware";

export const jobsRouter = Router();

/* ── Jobs ── */
jobsRouter.get("/jobs", async (req, res) => res.json(await listJobs(tenant(req), parse(JobListQuery, req.query))));
jobsRouter.get("/matches", async (req, res) => res.json(await listJobs(tenant(req), parse(JobListQuery, { ...req.query, view: "matches" }))));
jobsRouter.get("/jobs/:id", async (req, res) => {
  const job = await getJob(tenant(req), uuidParam(req));
  await recordInteraction(tenant(req), "JOB_OPENED", job.id);
  res.json(job);
});
jobsRouter.post("/jobs/:id/save", async (req, res) => {
  await saveJob(tenant(req), uuidParam(req), true);
  res.status(204).end();
});
jobsRouter.delete("/jobs/:id/save", async (req, res) => {
  await saveJob(tenant(req), uuidParam(req), false);
  res.status(204).end();
});
jobsRouter.post("/jobs/:id/dismiss", async (req, res) => {
  const { reason } = parse(DismissInput, req.body ?? {});
  await dismissJob(tenant(req), uuidParam(req), true, reason);
  res.status(204).end();
});
jobsRouter.delete("/jobs/:id/dismiss", async (req, res) => {
  await dismissJob(tenant(req), uuidParam(req), false);
  res.status(204).end();
});
/** 👍 / 👎 relevance feedback (PRD §89). */
jobsRouter.post("/jobs/:id/feedback", async (req, res) => {
  const { helpful } = parse(FeedbackInput, req.body);
  await recordInteraction(tenant(req), helpful ? "FEEDBACK_GOOD" : "FEEDBACK_BAD", uuidParam(req));
  res.status(204).end();
});
jobsRouter.post("/interactions", limiter("interactions", { windowMs: 60_000, limit: 120 }), async (req, res) => {
  const i = parse(InteractionInput, req.body);
  await recordInteraction(tenant(req), i.type, i.jobId ?? null, i.metadata ?? {});
  res.status(204).end();
});

/* ── Sources ── */
jobsRouter.get("/sources", async (req, res) => res.json(await listSources(tenant(req))));
jobsRouter.post("/sources/validate", limiter("source-validate", { windowMs: 3_600_000, limit: 30 }), async (req, res) => {
  const input = parse(ValidateSourceInput, req.body);
  const { ref: _ref, ...result } = await validateSource(input.sourceUrl, input.companyName);
  res.json(result);
});
jobsRouter.post("/sources", limiter("source-create", { windowMs: 3_600_000, limit: 20 }), async (req, res) => {
  const ctx = tenant(req);
  const source = await createSource(ctx, req.auth!.plan, parse(CreateSourceInput, req.body));
  await audit(ctx, "SOURCE_ADDED", { type: "job_source", id: source.id }, req.ip, { url: source.sourceUrl });
  res.status(201).json(source);
});
jobsRouter.put("/sources/:id", async (req, res) => res.json(await updateSource(tenant(req), uuidParam(req), parse(UpdateSourceInput, req.body))));
jobsRouter.delete("/sources/:id", async (req, res) => {
  await deleteSource(tenant(req), uuidParam(req));
  res.status(204).end();
});

/* ── Portals (LinkedIn, Naukri — partner integrations only) ── */
jobsRouter.get("/portals", async (req, res) => res.json(await listPortals(tenant(req))));
jobsRouter.put("/portals/:type", async (req, res) => {
  const ctx = tenant(req);
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  const portals = await listPortals(ctx);
  const portal = portals.find((p) => p.type === req.params.type);
  if (!portal) throw badRequest("Unknown portal");
  if (enabled && !portal.available) throw badRequest(portal.note);
  const prefs = await getPreferences(ctx);
  const set = new Set(prefs.enabledPortals);
  if (enabled) set.add(portal.type);
  else set.delete(portal.type);
  await updatePreferences(ctx, { ...prefs, enabledPortals: [...set] });
  res.json(await listPortals(ctx));
});
