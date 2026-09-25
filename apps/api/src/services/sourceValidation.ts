import type { SourceValidation } from "@jobagent/shared";
import { discoverUnderlyingBoard } from "../connectors/discovery";
import { PORTALS } from "../connectors/portals";
import { CONNECTORS, connectorFor, detectByUrl } from "../connectors/registry";
import { ConnectorUnavailableError, emptyState, type SourceRef } from "../connectors/types";
import { createFetcher, RobotsDisallowedError } from "../crawl/fetcher";
import { HttpError } from "../crawl/httpClient";
import { SsrfError, validateUrlShape } from "../crawl/ssrf";
import { sha256 } from "../lib/hash";
import { redis } from "../lib/redis";
import { env } from "../config/env";

export interface ValidationOutcome extends SourceValidation {
  ref: SourceRef | null;
}

type Check = SourceValidation["checks"][number];

async function runValidation(sourceUrl: string, companyName: string | null): Promise<ValidationOutcome> {
  const checks: Check[] = [];
  const fail = (label: string, detail: string): ValidationOutcome => ({
    ok: false,
    connectorType: null,
    normalizedUrl: null,
    jobsDetected: 0,
    crawlStrategy: null,
    checks: [...checks, { label, ok: false, detail }],
    sampleTitles: [],
    ref: null,
  });

  try {
    if (!env.CRAWL_ALLOW_PRIVATE_NETWORKS) validateUrlShape(sourceUrl);
  } catch (err) {
    return fail("URL is allowed", err instanceof SsrfError ? err.message : "Invalid URL");
  }

  let ref = detectByUrl(sourceUrl);
  if (!ref) return fail("Source type detected", "Unrecognized URL");

  const portal = PORTALS.find((p) => p.connector.type === ref!.connectorType);
  if (portal) {
    return fail("Source type detected", `${portal.connector.displayName} jobs are available only through an approved partner integration. Enable it under Job Portals instead.`);
  }

  const fetcher = createFetcher({ delayMs: 300, perMinute: 60, maxRequests: 25 });

  // Custom career pages are usually front-ends for an ATS; switch to its structured API when found.
  if (ref.connectorType === "GENERIC") {
    try {
      const page = await fetcher.fetch(ref.sourceUrl, { kind: "html", headers: { accept: "text/html" } });
      checks.push({ label: "URL accessible", ok: true, detail: `HTTP ${page.status}` });
      const board = await discoverUnderlyingBoard(page.body, page.url, companyName, fetcher);
      if (board) {
        ref = board.ref;
        checks.push({
          label: "Underlying job board found",
          ok: true,
          detail: `${connectorFor(board.ref.connectorType).displayName} (${board.method === "embedded" ? "referenced by the page" : "matched to the page's job listings"})`,
        });
      }
    } catch (err) {
      if (err instanceof RobotsDisallowedError) return fail("Crawling permitted", "The site's robots.txt disallows crawling this page");
      return fail("URL accessible", err instanceof HttpError ? `HTTP ${err.status}` : "Could not reach the URL");
    }
  }

  const connector = connectorFor(ref.connectorType);
  checks.push({ label: "Source type detected", ok: true, detail: connector.displayName });
  checks.push({ label: "Crawl strategy detected", ok: true, detail: ref.strategy });

  try {
    const result = await connector.discoverJobs(ref, fetcher, { ...emptyState(), maxDetailFetches: 3, maxPages: 2 });
    const jobsDetected = Math.max(result.jobs.length, result.totalAvailable ?? 0);
    if (!checks.some((c) => c.label === "URL accessible")) checks.unshift({ label: "URL accessible", ok: true, detail: `HTTP ${result.httpStatus}` });
    const titles = result.jobs.map((j) => j.title).filter(Boolean);
    checks.push({ label: "Jobs detected", ok: jobsDetected > 0, detail: jobsDetected ? `${jobsDetected}${result.complete || result.totalAvailable ? "" : "+"} open roles` : "No job postings found yet" });
    return {
      ok: true,
      connectorType: ref.connectorType,
      normalizedUrl: ref.sourceUrl,
      jobsDetected,
      crawlStrategy: ref.strategy,
      checks,
      sampleTitles: titles.slice(0, 5),
      ref,
    };
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return fail("Source available", err.message);
    if (err instanceof RobotsDisallowedError) return fail("Crawling permitted", "The site's robots.txt disallows crawling this page");
    const detail = err instanceof HttpError ? (err.status === 404 ? "Job board not found (check the company slug)" : `HTTP ${err.status}`) : "Could not read jobs from this source";
    return fail("URL accessible", detail);
  }
}

/** Changes whenever connectors are added/changed, so a deploy never serves pre-deploy detection results. */
const DETECTION_VERSION = sha256(`3|${CONNECTORS.map((c) => c.type).join(",")}`).slice(0, 10);

/** Cached for 10 minutes so "Validate" then "Save" doesn't crawl twice. */
export async function validateSource(sourceUrl: string, companyName: string | null = null): Promise<ValidationOutcome> {
  const url = sourceUrl.trim();
  const name = companyName?.trim() || null;
  const key = `validate:${DETECTION_VERSION}:${sha256(`${url}|${name ?? ""}`)}`;
  const hit = await redis().get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as ValidationOutcome;
  const result = await runValidation(url, name);
  // Only successes are cached: a failure (site hiccup, older build) must not stick for 10 minutes.
  if (result.ok) await redis().set(key, JSON.stringify(result), "EX", 600).catch(() => undefined);
  return result;
}
