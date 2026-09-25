import type { MatchLevel, MatchResult } from "@jobagent/shared";
import { env } from "../config/env";
import { query, queryOne } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { renderDigest } from "../email/digestTemplate";
import { emailProvider } from "../email/provider";
import { signToken } from "../lib/crypto";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

const TRACK_TTL = 60 * 24 * 3600;

/** Sends a composed digest. Safe to retry: a SENT notification is never re-sent (PRD §69). */
export async function sendDigestEmail(ctx: TenantContext, notificationId: string): Promise<void> {
  const n = await queryOne<{ status: string; email: string; name: string; timezone: string }>(
    `SELECT n.status, u.email, u.name, u.timezone FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.id = $1 AND n.tenant_id = $2 AND n.user_id = $3`,
    [notificationId, ctx.tenantId, ctx.userId],
  );
  if (!n || n.status === "SENT") return;

  const jobs = await query<{
    job_id: string;
    title: string;
    company: string;
    location_raw: string;
    employment_type: string | null;
    work_mode: string | null;
    posted_at: Date | null;
    first_seen_at: Date;
    score: number;
    match_level: MatchLevel;
    result: MatchResult;
  }>(
    `SELECT nj.job_id, j.title, c.name AS company, j.location_raw, j.employment_type, j.work_mode, j.posted_at, j.first_seen_at,
            nj.score, nj.match_level, m.result
     FROM notification_jobs nj
     JOIN jobs j ON j.id = nj.job_id JOIN companies c ON c.id = j.company_id
     JOIN job_matches m ON m.job_id = nj.job_id AND m.user_id = nj.user_id AND m.tenant_id = nj.tenant_id
     WHERE nj.notification_id = $1 AND nj.tenant_id = $2 AND nj.user_id = $3
     ORDER BY nj.position`,
    [notificationId, ctx.tenantId, ctx.userId],
  );
  if (!jobs.length) {
    await query("UPDATE notifications SET status = 'SKIPPED' WHERE id = $1", [notificationId]);
    return;
  }

  const provider = emailProvider();
  const base = env.API_PUBLIC_URL.replace(/\/$/, "");
  const digest = renderDigest({
    name: n.name.split(" ")[0] ?? "",
    generatedAt: new Date(),
    timezone: n.timezone,
    viewAllUrl: `${env.APP_URL}/jobs`,
    settingsUrl: `${env.APP_URL}/notifications`,
    openPixelUrl: `${base}/api/v1/t/o/${signToken({ n: notificationId }, TRACK_TTL)}`,
    jobs: jobs.map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location_raw.split(";")[0]?.trim() ?? "",
      employmentType: j.employment_type,
      workMode: j.work_mode,
      postedAt: j.posted_at,
      firstSeenAt: j.first_seen_at,
      score: j.score,
      matchLevel: j.match_level,
      result: j.result,
      trackedUrl: `${base}/api/v1/t/c/${signToken({ n: notificationId, j: j.job_id }, TRACK_TTL)}`,
    })),
  });

  await query(
    `INSERT INTO email_deliveries (tenant_id, user_id, notification_id, provider, attempts) VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (notification_id) DO UPDATE SET attempts = email_deliveries.attempts + 1`,
    [ctx.tenantId, ctx.userId, notificationId, provider.name],
  );
  try {
    const { messageId } = await provider.send({
      to: n.email,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
      headers: { "List-Unsubscribe": `<${env.APP_URL}/notifications>` },
      idempotencyKey: `digest-${notificationId}`,
    });
    await query("UPDATE email_deliveries SET status = 'SENT', provider_message_id = $2, error = NULL WHERE notification_id = $1", [notificationId, messageId]);
    await query("UPDATE notifications SET status = 'SENT', sent_at = now(), subject = $2, error = NULL WHERE id = $1", [notificationId, digest.subject]);
    metrics.emailsSent.inc({ provider: provider.name, outcome: "sent" });
    logger.info({ event: "EMAIL_SENT", tenantId: ctx.tenantId, userId: ctx.userId, notificationId, jobs: jobs.length }, "digest sent");
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await query("UPDATE email_deliveries SET status = 'FAILED', error = $2 WHERE notification_id = $1", [notificationId, message]);
    await query("UPDATE notifications SET status = 'FAILED', error = $2 WHERE id = $1", [notificationId, message]);
    metrics.emailsSent.inc({ provider: provider.name, outcome: "failed" });
    throw err; // queue retry with backoff (PRD §130)
  }
}
