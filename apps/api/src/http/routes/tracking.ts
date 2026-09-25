import { Router } from "express";
import { env } from "../../config/env";
import { query, queryOne } from "../../db/pool";
import { verifyToken } from "../../lib/crypto";
import { metrics } from "../../lib/metrics";

/** Email open/click tracking (PRD §112). Tokens are HMAC-signed; redirects only go to stored job URLs. */
export const trackingRouter = Router();

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

trackingRouter.get("/o/:token", async (req, res) => {
  const t = verifyToken<{ n: string }>(req.params.token);
  if (t) {
    const rows = await query<{ tenant_id: string; user_id: string }>(
      "UPDATE email_deliveries SET opened_at = COALESCE(opened_at, now()) WHERE notification_id = $1 AND opened_at IS NULL RETURNING tenant_id, user_id",
      [t.n],
    );
    if (rows[0]) {
      metrics.emailEvents.inc({ event: "open" });
      await query("INSERT INTO user_interactions (tenant_id, user_id, type, metadata) VALUES ($1,$2,'EMAIL_OPENED',$3)", [rows[0].tenant_id, rows[0].user_id, JSON.stringify({ notificationId: t.n })]);
    }
  }
  res.setHeader("content-type", "image/gif");
  res.setHeader("cache-control", "no-store");
  res.end(PIXEL);
});

trackingRouter.get("/c/:token", async (req, res) => {
  const t = verifyToken<{ n: string; j: string }>(req.params.token);
  if (!t) return res.redirect(302, `${env.APP_URL}/jobs`);
  const row = await queryOne<{ url: string; tenant_id: string; user_id: string }>(
    `SELECT j.url, nj.tenant_id, nj.user_id FROM notification_jobs nj JOIN jobs j ON j.id = nj.job_id WHERE nj.notification_id = $1 AND nj.job_id = $2`,
    [t.n, t.j],
  );
  if (!row || !/^https?:\/\//i.test(row.url)) return res.redirect(302, `${env.APP_URL}/jobs`);
  metrics.emailEvents.inc({ event: "click" });
  await query("UPDATE email_deliveries SET clicked_at = COALESCE(clicked_at, now()) WHERE notification_id = $1", [t.n]);
  await query("INSERT INTO user_interactions (tenant_id, user_id, job_id, type, metadata) VALUES ($1,$2,$3,'EMAIL_CLICKED',$4)", [row.tenant_id, row.user_id, t.j, JSON.stringify({ notificationId: t.n })]);
  return res.redirect(302, row.url);
});
