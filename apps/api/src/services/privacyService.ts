import { query, withTransaction } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { logger } from "../lib/logger";
import { storage } from "../storage/storage";

/** PRD §67 "Export my data": everything we hold about the user, as JSON. */
export async function exportUserData(ctx: TenantContext): Promise<Record<string, unknown>> {
  const q = (sql: string) => query(sql, [ctx.tenantId, ctx.userId]);
  const [user, preferences, notificationSettings, resumes, profiles, sources, matches, saved, dismissed, interactions, notifications] = await Promise.all([
    q("SELECT id, email, name, timezone, created_at, last_login_at, personalization_enabled FROM users WHERE tenant_id = $1 AND id = $2"),
    q("SELECT * FROM user_preferences WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT * FROM notification_settings WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT id, version, file_name, mime_type, size_bytes, status, created_at FROM resumes WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT id, version, profile, created_at FROM candidate_profiles WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT js.display_name, s.source_url, js.status, js.created_at FROM job_sources js JOIN source_connectors s ON s.id = js.source_connector_id WHERE js.tenant_id = $1 AND js.user_id = $2"),
    q("SELECT m.job_id, j.title, m.score, m.match_level, m.result, m.created_at FROM job_matches m JOIN jobs j ON j.id = m.job_id WHERE m.tenant_id = $1 AND m.user_id = $2"),
    q("SELECT job_id, created_at FROM saved_jobs WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT job_id, reason, created_at FROM dismissed_jobs WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT type, job_id, metadata, created_at FROM user_interactions WHERE tenant_id = $1 AND user_id = $2"),
    q("SELECT notification_window, status, job_count, sent_at FROM notifications WHERE tenant_id = $1 AND user_id = $2"),
  ]);
  return { exportedAt: new Date().toISOString(), user: user[0], preferences: preferences[0], notificationSettings: notificationSettings[0], resumes, profiles, sources, matches, saved, dismissed, interactions, notifications };
}

/** "Delete job history": matches, saved/dismissed jobs, interactions and notification history. */
export async function deleteJobHistory(ctx: TenantContext): Promise<void> {
  await withTransaction(async (c) => {
    for (const table of ["job_matches", "saved_jobs", "dismissed_jobs", "user_interactions", "notifications"]) {
      await c.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND user_id = $2`, [ctx.tenantId, ctx.userId]);
    }
  });
}

/**
 * Hard-deletes the account (PRD §66–67). Removing the tenant cascades every tenant-owned
 * row (profiles, embeddings, matches, notifications…); stored resume files are removed too.
 */
export async function deleteAccount(ctx: TenantContext): Promise<void> {
  const files = await query<{ storage_key: string }>("SELECT storage_key FROM resumes WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
  await withTransaction(async (c) => {
    await c.query("DELETE FROM users WHERE tenant_id = $1 AND id = $2", [ctx.tenantId, ctx.userId]);
    // Phase 1 tenants are personal; drop the tenant once it has no users left.
    await c.query("DELETE FROM tenants WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = $1)", [ctx.tenantId]);
  });
  for (const f of files) await storage().delete(f.storage_key).catch((err) => logger.warn({ err: (err as Error).message }, "resume file delete failed"));
}
