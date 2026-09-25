import { adminEmails } from "../config/env";
import { query } from "../db/pool";
import { emailProvider } from "../email/provider";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Notifies administrators (PRD §46). De-duplicated to one alert per subject per hour. */
export async function notifyAdmins(subject: string, body: string): Promise<void> {
  logger.warn({ event: "ADMIN_ALERT", subject }, body);
  await query("INSERT INTO audit_logs (action, metadata) VALUES ('ADMIN_ALERT', $1)", [JSON.stringify({ subject, body })]).catch(() => undefined);
  const first = await redis()
    .set(`alert:${subject}`, "1", "EX", 3600, "NX")
    .catch(() => "OK");
  if (first !== "OK") return;
  for (const to of adminEmails) {
    await emailProvider()
      .send({ to, subject: `[Job Agent] ${subject}`, text: body, html: `<p>${escapeHtml(body)}</p>` })
      .catch((err) => logger.warn({ err: (err as Error).message }, "admin alert email failed"));
  }
}
