import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { logger } from "./lib/logger";
import { metrics, registry } from "./lib/metrics";
import { redis } from "./lib/redis";
import { csrfProtection, errorHandler, limiter, requireAdmin, requireAuth } from "./http/middleware";
import { buildOpenApi } from "./http/openapi";
import { adminRouter } from "./http/routes/admin";
import { authRouter } from "./http/routes/auth";
import { internalRouter } from "./http/routes/internal";
import { jobsRouter } from "./http/routes/jobs";
import { trackingRouter } from "./http/routes/tracking";
import { userRouter } from "./http/routes/user";

/** Public API (behind Caddy → Traefik). */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Caddy + Traefik sit in front; trust the private proxy hops for req.ip / protocol.
  app.set("trust proxy", "loopback, uniquelocal");
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors({ origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
      customProps: (req) => ({ userId: (req as express.Request).auth?.userId, tenantId: (req as express.Request).auth?.tenantId }),
      serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.replace(/token=[^&]+/, "token=[REDACTED]") }) },
    }),
  );
  app.use((req, res, next) => {
    const end = metrics.httpDuration.startTimer();
    res.on("finish", () => end({ method: req.method, route: req.route?.path ?? (res.statusCode === 404 ? "unmatched" : req.path.replace(/[0-9a-f-]{36}/gi, ":id")), status: String(res.statusCode) }));
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      await redis().ping();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  const v1 = Router();
  v1.use(limiter("api", { windowMs: 60_000, limit: 300, keyGenerator: (req) => req.ip ?? "anon" }));
  v1.get("/openapi.json", (_req, res) => res.json(buildOpenApi()));
  v1.use("/auth", authRouter);
  v1.use("/t", trackingRouter);
  v1.use(requireAuth, csrfProtection);
  v1.use(userRouter);
  v1.use(jobsRouter);
  v1.use("/admin", requireAdmin, adminRouter);
  app.use("/api/v1", v1);

  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}

/** Internal-only server: /internal/* and /metrics. Never routed publicly. */
export function createInternalApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/metrics", async (_req, res) => {
    res.setHeader("content-type", registry.contentType);
    res.end(await registry.metrics());
  });
  app.use("/internal", internalRouter);
  app.use(errorHandler);
  return app;
}
