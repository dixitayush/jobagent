import { Router } from "express";
import { AdminSourceUpdate, PlatformSettings } from "@jobagent/shared";
import { z } from "zod";
import { notFound } from "../../lib/errors";
import { enqueue } from "../../queue/queues";
import { adminOverview, adminSources, deadLetters, recentRuns, updateAdminSource } from "../../services/adminService";
import { audit } from "../../services/userService";
import { listFlags, setFlag } from "../../settings/featureFlags";
import { getSettings, updateSettings } from "../../settings/platformSettings";
import { parse, tenant, uuidParam } from "../middleware";

/** PRD §72–74. Mounted behind requireAuth + requireAdmin. */
export const adminRouter = Router();

adminRouter.get("/overview", async (_req, res) => res.json(await adminOverview()));
adminRouter.get("/sources", async (_req, res) => res.json(await adminSources()));
adminRouter.put("/sources/:id", async (req, res) => {
  const ok = await updateAdminSource(uuidParam(req), parse(AdminSourceUpdate, req.body));
  if (!ok) throw notFound("Source not found");
  await audit(tenant(req), "ADMIN_SOURCE_UPDATED", { type: "source_connector", id: uuidParam(req) }, req.ip, req.body as Record<string, unknown>);
  res.json(await adminSources());
});
adminRouter.post("/sources/:id/crawl", async (req, res) => {
  await enqueue("source-crawl", { sourceConnectorId: uuidParam(req), trigger: "MANUAL" }, { jobId: `crawl:${uuidParam(req)}:manual:${Math.floor(Date.now() / 60_000)}` });
  res.status(202).json({ queued: true });
});
adminRouter.get("/settings", async (_req, res) => res.json(await getSettings()));
adminRouter.put("/settings", async (req, res) => {
  const next = await updateSettings(parse(PlatformSettings.partial(), req.body));
  await audit(tenant(req), "ADMIN_SETTINGS_UPDATED", undefined, req.ip, { keys: Object.keys(req.body as object) });
  res.json(next);
});
adminRouter.get("/flags", async (_req, res) => res.json(await listFlags()));
adminRouter.put("/flags/:key", async (req, res) => {
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  await setFlag(String(req.params.key), enabled);
  await audit(tenant(req), "ADMIN_FLAG_UPDATED", { type: "flag", id: String(req.params.key) }, req.ip, { enabled });
  res.json(await listFlags());
});
adminRouter.get("/runs", async (_req, res) => res.json(await recentRuns()));
adminRouter.get("/dead-letters", async (_req, res) => res.json(await deadLetters()));
