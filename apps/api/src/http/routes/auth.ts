import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { AuthConfig, DevAuthInput, GoogleAuthInput } from "@jobagent/shared";
import { env } from "../../config/env";
import { forbidden, unauthorized } from "../../lib/errors";
import { audit, getMe, upsertUserFromIdentity } from "../../services/userService";
import { clearSession, issueSession, limiter, parse } from "../middleware";

const google = new OAuth2Client();
const devLoginEnabled = () => env.AUTH_DEV_LOGIN && env.APP_ENV !== "production";

export const authRouter = Router();
authRouter.use(limiter("auth", { windowMs: 60_000, limit: 20, keyGenerator: (req) => req.ip ?? "anon" }));

authRouter.get("/config", (_req, res) => {
  const body: AuthConfig = { googleClientId: env.GOOGLE_CLIENT_ID ?? null, devLoginEnabled: devLoginEnabled() };
  res.json(body);
});

/**
 * Google Sign-In (OIDC). The browser obtains an ID token from Google Identity Services;
 * we verify its signature, audience and issuer server-side. No Google OAuth access/refresh
 * tokens are requested or stored.
 */
authRouter.post("/google", async (req, res) => {
  if (!env.GOOGLE_CLIENT_ID) throw forbidden("Google sign-in is not configured");
  const { credential } = parse(GoogleAuthInput, req.body);
  let payload;
  try {
    const ticket = await google.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized("Invalid Google credential");
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) throw unauthorized("Google account email is not verified");
  const { userId, tenantId, isNew } = await upsertUserFromIdentity({
    subject: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split("@")[0]!,
    picture: payload.picture ?? null,
  });
  issueSession(res, userId, tenantId);
  await audit({ userId, tenantId }, isNew ? "LOGIN_FIRST" : "LOGIN", undefined, req.ip);
  res.json(await getMe({ userId, tenantId }));
});

/** Local development only — disabled (and refused at boot) in production. */
authRouter.post("/dev", async (req, res) => {
  if (!devLoginEnabled()) throw forbidden("Dev login is disabled");
  const { email, name } = parse(DevAuthInput, req.body);
  const { userId, tenantId } = await upsertUserFromIdentity({ subject: `dev:${email.toLowerCase()}`, email, name, picture: null });
  issueSession(res, userId, tenantId);
  res.json(await getMe({ userId, tenantId }));
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.status(204).end();
});
