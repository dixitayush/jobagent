import { timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { runDigestAgent } from "../../agent/digestGraph";
import { runMatchingAgent } from "../../agent/matchingGraph";
import { env } from "../../config/env";
import { forbidden } from "../../lib/errors";
import { crawlSource } from "../../services/crawlService";
import { sendDigestEmail } from "../../services/emailService";
import { embedJobs } from "../../services/embeddingService";
import { schedulerTick } from "../../services/schedulerService";
import { parse } from "../middleware";

/**
 * Internal APIs (PRD §57). Served on INTERNAL_PORT, which is only reachable on the private
 * Docker network (never routed by Caddy/Traefik), and additionally require a bearer token.
 */
const requireInternalToken: RequestHandler = (req, _res, next) => {
  const given = Buffer.from((req.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(env.INTERNAL_API_TOKEN);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden();
  next();
};

const Ctx = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() });

export const internalRouter = Router();
internalRouter.use(requireInternalToken);

internalRouter.post("/crawl/source", async (req, res) => {
  const { sourceConnectorId } = parse(z.object({ sourceConnectorId: z.string().uuid() }), req.body);
  res.json(await crawlSource(sourceConnectorId, "INTERNAL"));
});
internalRouter.post("/jobs/embed", async (req, res) => {
  const { jobIds } = parse(z.object({ jobIds: z.array(z.string().uuid()).max(500) }), req.body);
  res.json(await embedJobs(jobIds));
});
internalRouter.post("/matching/run", async (req, res) => {
  res.json(await runMatchingAgent(parse(Ctx, req.body), "INTERNAL"));
});
internalRouter.post("/notifications/generate", async (req, res) => {
  const b = parse(Ctx.extend({ window: z.string().regex(/^\d{4}-\d{2}-\d{2}:(morning|evening)$/) }), req.body);
  await runDigestAgent({ tenantId: b.tenantId, userId: b.userId }, b.window, b.window.endsWith("morning") ? "morning" : "evening");
  res.status(204).end();
});
internalRouter.post("/email/send", async (req, res) => {
  const b = parse(Ctx.extend({ notificationId: z.string().uuid() }), req.body);
  await sendDigestEmail({ tenantId: b.tenantId, userId: b.userId }, b.notificationId);
  res.status(204).end();
});
internalRouter.post("/scheduler/tick", async (_req, res) => res.json(await schedulerTick()));
