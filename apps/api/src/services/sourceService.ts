import type { JobSource, Portal, SourceHealth } from "@jobagent/shared";
import { PORTALS } from "../connectors/portals";
import { query, queryOne, withTransaction } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { normalizeCompanyName } from "../domain/jobs/normalize";
import { badRequest, conflict, limitExceeded, notFound } from "../lib/errors";
import { enqueue } from "../queue/queues";
import { getSettings, planLimits } from "../settings/platformSettings";
import { getPreferences } from "./preferencesService";
import { validateSource } from "./sourceValidation";

interface Row {
  id: string;
  source_connector_id: string;
  display_name: string;
  status: "ACTIVE" | "PAUSED";
  created_at: Date;
  source_url: string;
  connector_type: JobSource["connectorType"];
  global_status: JobSource["globalStatus"];
  last_crawled_at: Date | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_http_status: number | null;
  last_error: string | null;
  jobs_found: number;
  avg_crawl_ms: number | null;
  failure_count: number;
  consecutive_failures: number;
  next_crawl_at: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export const toHealth = (r: Omit<Row, "id" | "source_connector_id" | "display_name" | "status" | "created_at" | "source_url" | "connector_type" | "global_status">): SourceHealth => ({
  lastCrawledAt: iso(r.last_crawled_at),
  lastSuccessAt: iso(r.last_success_at),
  lastFailureAt: iso(r.last_failure_at),
  lastHttpStatus: r.last_http_status,
  lastError: r.last_error,
  jobsFound: r.jobs_found,
  avgCrawlMs: r.avg_crawl_ms,
  failureCount: r.failure_count,
  consecutiveFailures: r.consecutive_failures,
  nextCrawlAt: iso(r.next_crawl_at),
});

const SELECT = `SELECT js.id, js.source_connector_id, js.display_name, js.status, js.created_at, s.source_url, s.connector_type, s.status AS global_status,
  s.last_crawled_at, s.last_success_at, s.last_failure_at, s.last_http_status, s.last_error, s.jobs_found, s.avg_crawl_ms, s.failure_count,
  s.consecutive_failures, s.next_crawl_at
  FROM job_sources js JOIN source_connectors s ON s.id = js.source_connector_id`;

const toSource = (r: Row): JobSource => ({
  id: r.id,
  sourceConnectorId: r.source_connector_id,
  companyName: r.display_name,
  sourceUrl: r.source_url,
  connectorType: r.connector_type,
  status: r.status,
  globalStatus: r.global_status,
  health: toHealth(r),
  createdAt: r.created_at.toISOString(),
});

export async function listSources(ctx: TenantContext): Promise<JobSource[]> {
  const rows = await query<Row>(`${SELECT} WHERE js.tenant_id = $1 AND js.user_id = $2 ORDER BY js.display_name`, [ctx.tenantId, ctx.userId]);
  return rows.map(toSource);
}

/**
 * Adds a career page. If another user already tracks the same board, the existing global
 * source is reused — the company is crawled once no matter how many users follow it (PRD §16).
 */
export async function createSource(ctx: TenantContext, plan: string, input: { companyName: string; sourceUrl: string }): Promise<JobSource> {
  const limits = await planLimits(plan);
  const count = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM job_sources WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
  if ((count?.n ?? 0) >= limits.maxSources) throw limitExceeded(`Your plan allows ${limits.maxSources} career sources`);

  const validation = await validateSource(input.sourceUrl, input.companyName);
  if (!validation.ok || !validation.ref) throw badRequest(validation.checks.find((c) => !c.ok)?.detail ?? "Source could not be validated", validation.checks);
  const ref = validation.ref;
  const settings = await getSettings();
  const companyName = input.companyName.trim();

  const { jobSourceId, sourceConnectorId, isNewConnector } = await withTransaction(async (client) => {
    const company = (
      await client.query<{ id: string }>(
        `INSERT INTO companies (name, normalized_name) VALUES ($1, $2)
         ON CONFLICT (normalized_name) DO UPDATE SET name = companies.name RETURNING id`,
        [companyName, normalizeCompanyName(companyName) || companyName.toLowerCase()],
      )
    ).rows[0]!;
    const inserted = (
      await client.query<{ id: string }>(
        `INSERT INTO source_connectors (company_id, connector_type, source_url, canonical_key, source_identifier, crawl_interval_minutes)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (canonical_key) DO NOTHING RETURNING id`,
        [company.id, ref.connectorType, ref.sourceUrl, ref.canonicalKey, ref.identifier, settings.defaultCrawlIntervalMinutes],
      )
    ).rows[0];
    const connectorId = inserted?.id ?? (await client.query<{ id: string }>("SELECT id FROM source_connectors WHERE canonical_key = $1", [ref.canonicalKey])).rows[0]!.id;
    const js = (
      await client.query<{ id: string }>(
        `INSERT INTO job_sources (tenant_id, user_id, source_connector_id, display_name) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, source_connector_id) DO NOTHING RETURNING id`,
        [ctx.tenantId, ctx.userId, connectorId, companyName],
      )
    ).rows[0];
    if (!js) throw conflict("You are already tracking this career page");
    return { jobSourceId: js.id, sourceConnectorId: connectorId, isNewConnector: !!inserted };
  });

  if (isNewConnector) {
    await enqueue("source-crawl", { sourceConnectorId, trigger: "NEW_SOURCE" }, { jobId: `crawl:${sourceConnectorId}:initial` });
  } else {
    // Existing global source: jobs are already indexed — just match them for this user.
    await enqueue("match", { ...ctx, trigger: "SOURCE_ADDED" }, { jobId: `match:${ctx.userId}:${Date.now()}` });
  }
  const row = await queryOne<Row>(`${SELECT} WHERE js.id = $1 AND js.tenant_id = $2 AND js.user_id = $3`, [jobSourceId, ctx.tenantId, ctx.userId]);
  return toSource(row!);
}

export async function updateSource(ctx: TenantContext, id: string, patch: { companyName?: string; status?: "ACTIVE" | "PAUSED" }): Promise<JobSource> {
  const row = await queryOne<{ id: string }>(
    `UPDATE job_sources SET display_name = COALESCE($4, display_name), status = COALESCE($5, status)
     WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id`,
    [id, ctx.tenantId, ctx.userId, patch.companyName ?? null, patch.status ?? null],
  );
  if (!row) throw notFound("Source not found");
  const r = await queryOne<Row>(`${SELECT} WHERE js.id = $1 AND js.tenant_id = $2 AND js.user_id = $3`, [id, ctx.tenantId, ctx.userId]);
  return toSource(r!);
}

export async function deleteSource(ctx: TenantContext, id: string): Promise<void> {
  const rows = await query("DELETE FROM job_sources WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id", [id, ctx.tenantId, ctx.userId]);
  if (!rows.length) throw notFound("Source not found");
  // Remove matches for jobs that are no longer reachable through any of this user's sources.
  await query(
    `DELETE FROM job_matches m USING jobs j WHERE m.job_id = j.id AND m.tenant_id = $1 AND m.user_id = $2
       AND j.source_connector_id NOT IN (SELECT source_connector_id FROM job_sources WHERE tenant_id = $1 AND user_id = $2)`,
    [ctx.tenantId, ctx.userId],
  );
}

export async function listPortals(ctx: TenantContext): Promise<Portal[]> {
  const prefs = await getPreferences(ctx);
  return PORTALS.map(({ connector, available }) => ({
    type: connector.type,
    name: connector.displayName,
    available: available(),
    enabled: prefs.enabledPortals.includes(connector.type),
    note: available()
      ? "Connected through an approved partner integration."
      : `${connector.displayName} does not permit crawling. It becomes available once an official partner API or licensed feed is configured by the administrator.`,
  }));
}
