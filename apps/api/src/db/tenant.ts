/**
 * Tenant context (PRD §64). Always derived from the authenticated session on the server —
 * never from request bodies/headers. Every tenant-owned query takes this context and filters
 * `WHERE tenant_id = $tenant AND user_id = $user`.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
}
