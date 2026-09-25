import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { rateLimit, type Options } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { ZodError, type z } from "zod";
import { env } from "../config/env";
import { queryOne } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { AppError, badRequest, forbidden, unauthorized } from "../lib/errors";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import "./types";

export const SESSION_COOKIE = "ja_session";
export const CSRF_COOKIE = "ja_csrf";
// Secure cookies whenever the public origin is https (always true in production).
const isProd = env.APP_URL.startsWith("https://");

interface SessionClaims {
  sub: string;
  tid: string;
}

export function issueSession(res: Response, userId: string, tenantId: string): void {
  const token = jwt.sign({ tid: tenantId } satisfies Omit<SessionClaims, "sub">, env.JWT_SECRET, {
    subject: userId,
    expiresIn: `${env.SESSION_TTL_HOURS}h`,
    algorithm: "HS256",
    issuer: "jobagent",
  });
  const maxAge = env.SESSION_TTL_HOURS * 3_600_000;
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge });
  // Double-submit CSRF token, readable by the same-origin frontend only.
  res.cookie(CSRF_COOKIE, randomBytes(24).toString("base64url"), { httpOnly: false, secure: isProd, sameSite: "lax", path: "/", maxAge });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

/**
 * Establishes the authenticated user and tenant from the signed session cookie (PRD §64).
 * The tenant is always derived from the server-side user record — never from the client.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) throw unauthorized();
  let claims: SessionClaims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], issuer: "jobagent" }) as SessionClaims;
  } catch {
    throw unauthorized("Session expired");
  }
  const user = await queryOne<{ id: string; tenant_id: string; role: "user" | "admin"; plan: string; email: string }>(
    "SELECT u.id, u.tenant_id, u.role, t.plan, u.email FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1",
    [claims.sub],
  );
  if (!user || user.tenant_id !== claims.tid) throw unauthorized("Session no longer valid");
  req.auth = { userId: user.id, tenantId: user.tenant_id, role: user.role, plan: user.plan, email: user.email };
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.auth?.role !== "admin") throw forbidden("Admin access required");
  next();
};

/** CSRF: state-changing requests must echo the CSRF cookie in a header (double submit). */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get("x-csrf-token");
  if (!cookie || !header || cookie.length !== header.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    throw forbidden("Invalid CSRF token");
  }
  next();
};

export const tenant = (req: Request): TenantContext => {
  if (!req.auth) throw unauthorized();
  return { tenantId: req.auth.tenantId, userId: req.auth.userId };
};

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

export const uuidParam = (req: Request, name = "id"): string => {
  const v = req.params[name];
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw badRequest(`Invalid ${name}`);
  return v;
};

/** Redis-backed rate limiter shared by all API replicas (PRD §63, §109). */
export function limiter(name: string, opts: Partial<Options> & { windowMs: number; limit: number }): RequestHandler {
  if (env.NODE_ENV === "test") return (_req, _res, next) => next();
  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anon",
    store: new RedisStore({ prefix: `rl:${name}:`, sendCommand: (...args: string[]) => redis().call(args[0]!, ...args.slice(1)) as Promise<RedisReply> }),
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests, please slow down." } }),
    ...opts,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Validation failed", details: err.issues } });
    return;
  }
  const e = err as { type?: string; code?: string; status?: number };
  if (e?.type === "entity.too.large" || e?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: { code: "TOO_LARGE", message: "Upload is too large" } });
    return;
  }
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed JSON" } });
    return;
  }
  logger.error({ err, path: req.path, userId: req.auth?.userId }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
