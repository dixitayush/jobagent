import type { Me, UpdateMeInput } from "@jobagent/shared";
import { adminEmails } from "../config/env";
import { query, queryOne, withTransaction } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { notFound } from "../lib/errors";

export interface IdentityProfile {
  subject: string; // Google `sub` (or "dev:<email>")
  email: string;
  name: string;
  picture: string | null;
}

/**
 * Sign-in upsert. Users are keyed by the immutable Google subject, never by email (PRD §6).
 * Phase 1 multi-tenancy: each new user gets a personal tenant (PRD §7).
 */
export async function upsertUserFromIdentity(id: IdentityProfile): Promise<{ userId: string; tenantId: string; isNew: boolean }> {
  const role = adminEmails.has(id.email.toLowerCase()) ? "admin" : "user";
  return withTransaction(async (client) => {
    const existing = (
      await client.query<{ id: string; tenant_id: string }>(
        `UPDATE users SET email = $2, name = $3, profile_picture = $4, last_login_at = now(), role = CASE WHEN $5 = 'admin' THEN 'admin' ELSE role END
         WHERE google_subject_id = $1 RETURNING id, tenant_id`,
        [id.subject, id.email, id.name, id.picture, role],
      )
    ).rows[0];
    if (existing) return { userId: existing.id, tenantId: existing.tenant_id, isNew: false };

    const tenantId = (await client.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [`${id.name || id.email}'s workspace`])).rows[0]!.id;
    const userId = (
      await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, google_subject_id, email, name, profile_picture, role, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING id`,
        [tenantId, id.subject, id.email, id.name, id.picture, role],
      )
    ).rows[0]!.id;
    await client.query("INSERT INTO user_preferences (tenant_id, user_id) VALUES ($1, $2)", [tenantId, userId]);
    await client.query("INSERT INTO notification_settings (tenant_id, user_id) VALUES ($1, $2)", [tenantId, userId]);
    await client.query("INSERT INTO audit_logs (tenant_id, user_id, action) VALUES ($1, $2, 'USER_SIGNUP')", [tenantId, userId]);
    return { userId, tenantId, isNew: true };
  });
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  profile_picture: string | null;
  role: "user" | "admin";
  timezone: string;
  plan: string;
  onboarding_completed: boolean;
  personalization_enabled: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

export async function getMe(ctx: TenantContext): Promise<Me> {
  const u = await queryOne<UserRow>(
    "SELECT u.*, t.plan FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.tenant_id = $2",
    [ctx.userId, ctx.tenantId],
  );
  if (!u) throw notFound("User not found");
  return {
    id: u.id,
    tenantId: u.tenant_id,
    email: u.email,
    name: u.name,
    profilePicture: u.profile_picture,
    role: u.role,
    timezone: u.timezone,
    plan: u.plan,
    onboardingCompleted: u.onboarding_completed,
    personalizationEnabled: u.personalization_enabled,
    createdAt: u.created_at.toISOString(),
    lastLoginAt: u.last_login_at?.toISOString() ?? null,
  };
}

export async function updateMe(ctx: TenantContext, input: UpdateMeInput): Promise<Me> {
  await query(
    `UPDATE users SET name = COALESCE($3, name), timezone = COALESCE($4, timezone),
       onboarding_completed = COALESCE($5, onboarding_completed), personalization_enabled = COALESCE($6, personalization_enabled)
     WHERE id = $1 AND tenant_id = $2`,
    [ctx.userId, ctx.tenantId, input.name ?? null, input.timezone ?? null, input.onboardingCompleted ?? null, input.personalizationEnabled ?? null],
  );
  return getMe(ctx);
}

export async function audit(ctx: Partial<TenantContext>, action: string, entity?: { type: string; id: string }, ip?: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await query("INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, ip, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    ctx.tenantId ?? null,
    ctx.userId ?? null,
    action,
    entity?.type ?? null,
    entity?.id ?? null,
    ip ?? null,
    JSON.stringify(metadata),
  ]).catch(() => undefined);
}
