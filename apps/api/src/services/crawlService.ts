import type pg from "pg";
import { extractRequirementsByRules, RULES_VERSION } from "../ai/jobUnderstanding";
import { discoverUnderlyingBoard } from "../connectors/discovery";
import { connectorFor, refFromStored } from "../connectors/registry";
import { ConnectorUnavailableError, type Fetcher } from "../connectors/types";
import { createFetcher, RobotsDisallowedError } from "../crawl/fetcher";
import { HttpError } from "../crawl/httpClient";
import { query, queryOne, withTransaction } from "../db/pool";
import { normalizeJob, type NormalizedJob, type RawJob } from "../domain/jobs/normalize";
import { resolveLocationText } from "../domain/locations/resolver";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { enqueue } from "../queue/queues";
import { getSettings } from "../settings/platformSettings";
import { finishRun, runEvent, startRun } from "./agentRuns";
import { locationIndex, replaceJobSkills } from "./referenceData";
import { notifyAdmins } from "./adminAlerts";

interface SourceRow {
  id: string;
  company_id: string;
  company_name: string;
  connector_type: string;
  source_url: string;
  source_identifier: string | null;
  canonical_key: string;
  status: string;
  crawl_interval_minutes: number;
  rate_limit_per_minute: number;
  crawl_delay_ms: number;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  consecutive_failures: number;
  avg_crawl_ms: number | null;
  crawl_count: number;
}

const DEGRADE_AFTER = 4;

/** PRD §46: 1 min → 5 min → 30 min → exponential (capped at 24h). */
export function failureBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 1) return 60_000;
  if (consecutiveFailures === 2) return 5 * 60_000;
  if (consecutiveFailures === 3) return 30 * 60_000;
  return Math.min(30 * 60_000 * 2 ** (consecutiveFailures - 3), 24 * 3_600_000);
}

async function writeJobChildren(client: pg.PoolClient, jobId: string, job: NormalizedJob, title: string): Promise<void> {
  const reqs = extractRequirementsByRules(title, job.description, job.requiredYears);
  await replaceJobSkills(jobId, [...new Set([...reqs.requiredSkills, ...reqs.requiredAnyOf.flat()])], reqs.preferredSkills, client);
  await client.query(
    `UPDATE jobs SET extraction = $2, extraction_version = $3 WHERE id = $1`,
    [jobId, JSON.stringify({ requiredSkills: reqs.requiredSkills, preferredSkills: reqs.preferredSkills, requiredAnyOf: reqs.requiredAnyOf, summary: null, method: reqs.method }), reqs.version],
  );
  const idx = await locationIndex();
  const locs = resolveLocationText(job.locationRaw, idx);
  await client.query("DELETE FROM job_locations WHERE job_id = $1", [jobId]);
  for (const l of locs) {
    await client.query(`INSERT INTO job_locations (job_id, raw, city_id, state_id, country_id, is_remote) VALUES ($1,$2,$3,$4,$5,$6)`, [
      jobId,
      l.raw,
      l.cityId,
      l.stateId,
      l.countryId,
      l.isRemote,
    ]);
  }
}

interface UpsertOutcome {
  kind: "new" | "updated" | "enriched" | "unchanged" | "duplicate";
  jobId: string;
}

/** Idempotent: re-running a crawl never creates duplicate rows (PRD §128). */
async function upsertJob(source: SourceRow, raw: RawJob): Promise<UpsertOutcome | null> {
  const job = normalizeJob(raw, source.company_name);
  return withTransaction(async (client) => {
    const existing = (
      await client.query<{ id: string; content_hash: string; status: string; listing_only: boolean }>(
        "SELECT id, content_hash, status, description = '' AS listing_only FROM jobs WHERE source_connector_id = $1 AND source_job_id = $2 FOR UPDATE",
        [source.id, job.sourceJobId],
      )
    ).rows[0];

    if (existing) {
      if (existing.content_hash === job.contentHash) {
        await client.query("UPDATE jobs SET last_seen_at = now(), status = 'OPEN', closed_at = NULL WHERE id = $1", [existing.id]);
        return { kind: "unchanged", jobId: existing.id };
      }
      // A listing-only job receiving its description is enrichment, not a material change:
      // no version bump, so it isn't flagged UPDATED or re-sent in a digest (PRD §70).
      const enrichment = existing.listing_only && job.description !== "";
      await client.query(
        `UPDATE jobs SET title=$2, normalized_title=$3, description=$4, location_raw=$5, employment_type=$6, work_mode=$7, seniority=$8,
           required_years=$9, salary_min=$10, salary_max=$11, salary_currency=$12, salary_text=$13, department=$14, url=$15, canonical_url=$16,
           posted_at=COALESCE($17, posted_at), content_hash=$18, dedupe_hash=$19, description_hash=$20,
           version = CASE WHEN $21 THEN version ELSE version + 1 END,
           content_updated_at = CASE WHEN $21 THEN content_updated_at ELSE now() END,
           last_seen_at = now(), status = 'OPEN', closed_at = NULL
         WHERE id = $1`,
        [existing.id, job.title, job.normalizedTitle, job.description, job.locationRaw, job.employmentType, job.workMode, job.seniority, job.requiredYears, job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryText, job.department, job.url, job.canonicalUrl, job.postedAt, job.contentHash, job.dedupeHash, job.descriptionHash, enrichment],
      );
      await writeJobChildren(client, existing.id, job, job.title);
      return { kind: enrichment ? "enriched" : "updated", jobId: existing.id };
    }

    // Cross-source duplicate detection (PRD §18): exact canonical URL or identical content hash.
    const dup = (
      await client.query<{ id: string }>(
        `SELECT id FROM jobs WHERE status = 'OPEN' AND duplicate_of IS NULL AND (canonical_url = $1 OR dedupe_hash = $2) LIMIT 1`,
        [job.canonicalUrl, job.dedupeHash],
      )
    ).rows[0];

    const inserted = (
      await client.query<{ id: string }>(
        `INSERT INTO jobs (source_connector_id, company_id, source, source_job_id, canonical_url, title, normalized_title, description, location_raw,
           employment_type, work_mode, seniority, required_years, salary_min, salary_max, salary_currency, salary_text, department, url, posted_at,
           content_hash, dedupe_hash, description_hash, duplicate_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (source_connector_id, source_job_id) DO UPDATE SET last_seen_at = now()
         RETURNING id`,
        [source.id, source.company_id, source.connector_type, job.sourceJobId, job.canonicalUrl, job.title, job.normalizedTitle, job.description, job.locationRaw, job.employmentType, job.workMode, job.seniority, job.requiredYears, job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryText, job.department, job.url, job.postedAt, job.contentHash, job.dedupeHash, job.descriptionHash, dup?.id ?? null],
      )
    ).rows[0]!;
    await writeJobChildren(client, inserted.id, job, job.title);
    if (dup) metrics.duplicates.inc({ method: "hash_or_url" });
    return { kind: dup ? "duplicate" : "new", jobId: inserted.id };
  });
}

/**
 * A career page first saved as GENERIC may be a front-end for an ATS board (detected later, or
 * saved before detection improved). Upgrade it in place so it's crawled via the board's API.
 * If another source already covers that board, move subscribers onto it instead.
 */
async function upgradeGenericSource(source: SourceRow, fetcher: Fetcher): Promise<"upgraded" | "merged" | null> {
  const page = await fetcher.fetch(source.source_url, { kind: "html", headers: { accept: "text/html" } }).catch(() => null);
  if (!page || page.notModified) return null;
  const board = await discoverUnderlyingBoard(page.body, page.url, source.company_name, fetcher).catch(() => null);
  if (!board) return null;
  const { ref } = board;
  return withTransaction(async (client) => {
    const existing = (await client.query<{ id: string }>("SELECT id FROM source_connectors WHERE canonical_key = $1", [ref.canonicalKey])).rows[0];
    if (existing && existing.id !== source.id) {
      await client.query(
        `UPDATE job_sources js SET source_connector_id = $2 WHERE js.source_connector_id = $1
           AND NOT EXISTS (SELECT 1 FROM job_sources o WHERE o.user_id = js.user_id AND o.source_connector_id = $2)`,
        [source.id, existing.id],
      );
      await client.query("DELETE FROM job_sources WHERE source_connector_id = $1", [source.id]);
      await client.query("UPDATE source_connectors SET status = 'DISABLED', last_error = $2 WHERE id = $1", [source.id, `Merged into ${ref.canonicalKey}`]);
      await client.query("UPDATE source_connectors SET next_crawl_at = now() WHERE id = $1", [existing.id]);
      logger.info({ event: "SOURCE_MERGED", from: source.canonical_key, into: ref.canonicalKey }, "generic source merged into existing ATS source");
      return "merged" as const;
    }
    // Keep the user's career-page URL for display; the connector crawls via identifier.
    await client.query(
      `UPDATE source_connectors SET connector_type = $2, source_identifier = $3, canonical_key = $4,
         etag = NULL, last_modified = NULL, content_hash = NULL, consecutive_failures = 0, last_error = NULL
       WHERE id = $1`,
      [source.id, ref.connectorType, ref.identifier, ref.canonicalKey],
    );
    logger.info({ event: "SOURCE_UPGRADED", source: source.canonical_key, to: ref.canonicalKey, method: board.method }, "generic source upgraded to ATS connector");
    return "upgraded" as const;
  });
}

export interface CrawlSummary {
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  discovered: number;
  newJobs: number;
  updated: number;
  duplicates: number;
  closed: number;
  notModified: boolean;
}

/**
 * Crawls one global source once for every user that tracks it (PRD §16).
 * Failures are contained to the source: they update health + backoff and never throw into the
 * pipeline (PRD §46, §130).
 */
export async function crawlSource(sourceConnectorId: string, trigger: string): Promise<CrawlSummary> {
  const load = () =>
    queryOne<SourceRow>(`SELECT s.*, c.name AS company_name FROM source_connectors s JOIN companies c ON c.id = s.company_id WHERE s.id = $1`, [sourceConnectorId]);
  let source = await load();
  const skipped: CrawlSummary = { status: "SKIPPED", discovered: 0, newJobs: 0, updated: 0, duplicates: 0, closed: 0, notModified: false };
  if (!source || source.status === "DISABLED" || source.status === "PAUSED") return skipped;
  if ((await getSettings()).crawlingPaused) return skipped;

  const runId = await startRun("CRAWL", { sourceConnectorId, trigger });
  const started = Date.now();
  const fetcher = createFetcher({ delayMs: source.crawl_delay_ms, perMinute: source.rate_limit_per_minute, maxRequests: 400 });
  if (source.connector_type === "GENERIC") {
    const upgrade = await upgradeGenericSource(source, fetcher);
    if (upgrade === "merged") {
      await finishRun(runId, "CRAWL", "SKIPPED", {}, "Merged into an existing ATS source");
      return skipped;
    }
    if (upgrade === "upgraded") source = (await load())!;
  }
  const connector = connectorFor(source.connector_type as never);
  // "Known" = stored with a description; listing-only jobs still get their details fetched.
  const known = new Set(
    (await query<{ source_job_id: string }>("SELECT source_job_id FROM jobs WHERE source_connector_id = $1 AND description <> ''", [source.id])).map((r) => r.source_job_id),
  );

  try {
    const result = await connector.discoverJobs(refFromStored(source), fetcher, {
      etag: source.etag,
      lastModified: source.last_modified,
      contentHash: source.content_hash,
      knownJobIds: known,
      maxDetailFetches: 60,
    });
    const summary: CrawlSummary = { status: "SUCCEEDED", discovered: 0, newJobs: 0, updated: 0, duplicates: 0, closed: 0, notModified: result.notModified };
    const changed: string[] = [];

    if (result.notModified) {
      await query("UPDATE jobs SET last_seen_at = now() WHERE source_connector_id = $1 AND status = 'OPEN'", [source.id]);
    } else {
      const seen: string[] = [];
      for (const raw of result.jobs) {
        seen.push(raw.sourceJobId);
        if (raw.partial) {
          // Listing-only entry (details not fetched this crawl): refresh a known job, or store a new
          // one from listing data so it's visible now; its description is filled in on a later crawl.
          const touched = await query("UPDATE jobs SET last_seen_at = now(), status = 'OPEN', closed_at = NULL WHERE source_connector_id = $1 AND source_job_id = $2 RETURNING id", [source.id, raw.sourceJobId]);
          if (touched.length || !raw.title) continue;
        }
        if (!raw.title) continue;
        try {
          const out = await upsertJob(source, raw);
          if (!out) continue;
          summary.discovered++;
          if (out.kind === "new") summary.newJobs++;
          if (out.kind === "updated") summary.updated++;
          if (out.kind === "duplicate") summary.duplicates++;
          if (out.kind === "new" || out.kind === "updated" || out.kind === "enriched") changed.push(out.jobId);
          metrics.jobsDiscovered.inc({ connector: source.connector_type, kind: out.kind });
        } catch (err) {
          logger.warn({ err: (err as Error).message, sourceJobId: raw.sourceJobId, source: source.id }, "failed to store job; continuing");
        }
      }
      // Only close unseen jobs when the listing was complete — truncated pagination must not close jobs.
      if (result.complete) {
        const closed = await query<{ id: string }>(
          `UPDATE jobs SET status = 'CLOSED', closed_at = now() WHERE source_connector_id = $1 AND status = 'OPEN' AND NOT (source_job_id = ANY($2::text[])) RETURNING id`,
          [source.id, seen],
        );
        summary.closed = closed.length;
        // A duplicate hidden behind a job that just closed becomes the visible copy again.
        const promoted = await query<{ id: string }>(
          "UPDATE jobs SET duplicate_of = NULL WHERE duplicate_of = ANY($1::uuid[]) AND status = 'OPEN' RETURNING id",
          [closed.map((c) => c.id)],
        );
        changed.push(...promoted.map((p) => p.id));
      }
    }

    for (let i = 0; i < changed.length; i += 50) {
      await enqueue("job-embed", { jobIds: changed.slice(i, i + 50) });
    }

    const elapsed = Date.now() - started;
    const openCount = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE source_connector_id = $1 AND status = 'OPEN' AND duplicate_of IS NULL", [source.id]);
    await query(
      `UPDATE source_connectors SET last_crawled_at = now(), last_success_at = now(), last_http_status = $2, last_error = NULL,
         consecutive_failures = 0, jobs_found = $3, crawl_count = crawl_count + 1,
         avg_crawl_ms = CASE WHEN avg_crawl_ms IS NULL THEN $4 ELSE ((avg_crawl_ms * LEAST(crawl_count, 19)) + $4) / (LEAST(crawl_count, 19) + 1) END,
         etag = COALESCE($5, etag), last_modified = COALESCE($6, last_modified), content_hash = COALESCE($7, content_hash),
         status = CASE WHEN status = 'DEGRADED' THEN 'ACTIVE' ELSE status END,
         next_crawl_at = now() + make_interval(mins => crawl_interval_minutes)
       WHERE id = $1`,
      [source.id, result.httpStatus, openCount?.n ?? 0, elapsed, result.etag, result.lastModified, result.contentHash],
    );
    metrics.crawls.inc({ connector: source.connector_type, outcome: result.notModified ? "not_modified" : "success" });
    metrics.crawlDuration.observe({ connector: source.connector_type }, elapsed / 1000);
    await runEvent(runId, "CRAWL_COMPLETED", { ...summary, requests: fetcher.requests(), elapsedMs: elapsed });
    await finishRun(runId, "CRAWL", "SUCCEEDED", { jobsDiscovered: summary.newJobs + summary.updated });
    logger.info({ event: "SOURCE_CRAWLED", source: source.canonical_key, ...summary, elapsedMs: elapsed }, "crawl complete");
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const httpStatus = err instanceof HttpError ? err.status : null;
    const failures = source.consecutive_failures + 1;
    // Permanent conditions (portal unavailable, robots disallow) degrade immediately.
    const permanent = err instanceof ConnectorUnavailableError || err instanceof RobotsDisallowedError || httpStatus === 404;
    const degraded = permanent || failures >= DEGRADE_AFTER;
    await query(
      `UPDATE source_connectors SET last_crawled_at = now(), last_failure_at = now(), last_http_status = $2, last_error = $3,
         failure_count = failure_count + 1, consecutive_failures = $4,
         status = CASE WHEN $5 AND status = 'ACTIVE' THEN 'DEGRADED' ELSE status END,
         next_crawl_at = now() + ($6 || ' milliseconds')::interval
       WHERE id = $1`,
      [source.id, httpStatus, message.slice(0, 500), failures, degraded, String(permanent ? 24 * 3_600_000 : failureBackoffMs(failures))],
    );
    metrics.crawls.inc({ connector: source.connector_type, outcome: "failure" });
    await finishRun(runId, "CRAWL", "FAILED", {}, message);
    logger.warn({ event: "SOURCE_CRAWL_FAILED", source: source.canonical_key, failures, err: message }, "crawl failed");
    if (degraded && source.status === "ACTIVE") {
      await notifyAdmins(`Source degraded: ${source.company_name}`, `${source.canonical_key} failed ${failures} time(s). Last error: ${message}`);
    }
    return { status: "FAILED", discovered: 0, newJobs: 0, updated: 0, duplicates: 0, closed: 0, notModified: false };
  }
}

/**
 * Re-applies rule-based extraction to jobs extracted by an older rules version (bounded batch).
 * LLM-understood jobs are left alone; they are refreshed when next evaluated.
 */
export async function reextractStaleJobs(limit = 500): Promise<number> {
  const rows = await query<{ id: string; title: string; description: string; required_years: number | null }>(
    `SELECT id, title, description, required_years FROM jobs
     WHERE status = 'OPEN' AND extraction_version LIKE 'job_rules_%' AND extraction_version <> $1 LIMIT $2`,
    [RULES_VERSION, limit],
  );
  for (const r of rows) {
    const reqs = extractRequirementsByRules(r.title, r.description, r.required_years);
    await withTransaction(async (client) => {
      await replaceJobSkills(r.id, [...new Set([...reqs.requiredSkills, ...reqs.requiredAnyOf.flat()])], reqs.preferredSkills, client);
      await client.query("UPDATE jobs SET extraction = $2, extraction_version = $3 WHERE id = $1", [
        r.id,
        JSON.stringify({ requiredSkills: reqs.requiredSkills, preferredSkills: reqs.preferredSkills, requiredAnyOf: reqs.requiredAnyOf, summary: null, method: reqs.method }),
        reqs.version,
      ]);
    });
  }
  return rows.length;
}

/** Sources due for a crawl that at least one user actively tracks. */
export async function dueSources(limit = 200): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT s.id FROM source_connectors s
     WHERE s.status IN ('ACTIVE', 'DEGRADED') AND s.next_crawl_at <= now()
       AND EXISTS (SELECT 1 FROM job_sources js WHERE js.source_connector_id = s.id AND js.status = 'ACTIVE')
     ORDER BY s.next_crawl_at LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

