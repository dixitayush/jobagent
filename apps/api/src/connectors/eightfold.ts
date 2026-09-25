import { sha256 } from "../lib/hash";
import type { RawJob } from "../domain/jobs/normalize";
import type { JobSourceConnector, SourceRef } from "./types";

/**
 * Eightfold career sites ({tenant}.eightfold.ai or a custom domain such as jobs.amdocs.com).
 * Uses the site's public search API (/api/pcsx/*, explicitly allowed in its robots.txt).
 * identifier = "host|domain", e.g. "nab.eightfold.ai|nab.com.au".
 */

interface EfPosition {
  id: number;
  name: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  creationTs?: number;
  department?: string;
  workLocationOption?: string | null;
  positionUrl?: string;
  publicUrl?: string;
  jobDescription?: string;
}

const PAGE = 10; // the API ignores larger page sizes
const MAX_PAGES = 80;

function parts(ref: SourceRef) {
  const [host, domain] = ref.identifier.split("|") as [string, string];
  return { host, domain };
}

function toRaw(host: string, p: EfPosition, detail?: EfPosition): RawJob {
  const src = detail ?? p;
  const url = src.publicUrl ?? `https://${host}${src.positionUrl ?? `/careers/job/${p.id}`}`;
  return {
    sourceJobId: String(p.id),
    title: src.name,
    url,
    descriptionHtml: detail?.jobDescription ?? null,
    locations: src.locations?.length ? src.locations : (src.standardizedLocations ?? []),
    workModeRaw: src.workLocationOption ?? null,
    isRemote: src.workLocationOption === "remote",
    department: src.department ?? null,
    postedAt: src.postedTs ? new Date(src.postedTs * 1000) : src.creationTs ? new Date(src.creationTs * 1000) : null,
    partial: !detail,
  };
}

/** Builds a ref from a URL/page. The site's `domain` comes from the URL or the page's HTML. */
export function eightfoldRef(host: string, domain: string): SourceRef {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return {
    connectorType: "EIGHTFOLD",
    identifier: `${h}|${d}`,
    sourceUrl: `https://${h}/careers?domain=${encodeURIComponent(d)}`,
    canonicalKey: `EIGHTFOLD:${h}:${d}`,
    strategy: "Eightfold career site search API (JSON)",
  };
}

/** Page fingerprint for Eightfold sites on custom domains. */
export function eightfoldRefFromPage(html: string, pageUrl: string): SourceRef | null {
  const url = new URL(pageUrl);
  const isEightfold = /\.eightfold\.ai$/i.test(url.hostname) || /eightfold|pcsx/i.test(html);
  if (!isEightfold) return null;
  // The site's `domain` comes from the URL, else the value the page itself uses most often.
  const seen = [...html.matchAll(/[?&;]domain=([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) => m[1]!.toLowerCase());
  const mostCommon = seen.sort((a, b) => seen.filter((x) => x === b).length - seen.filter((x) => x === a).length)[0];
  const domain = url.searchParams.get("domain") ?? mostCommon ?? null;
  return domain ? eightfoldRef(url.hostname, domain) : null;
}

export const eightfoldConnector: JobSourceConnector = {
  type: "EIGHTFOLD",
  displayName: "Eightfold",
  detect(url) {
    if (!/\.eightfold\.ai$/i.test(url.hostname)) return null;
    const domain = url.searchParams.get("domain");
    // Without ?domain= the page must be fetched to learn it (handled by source discovery).
    return domain ? eightfoldRef(url.hostname, domain) : null;
  },
  async discoverJobs(ref, fetcher, state) {
    const { host, domain } = parts(ref);
    const positions: EfPosition[] = [];
    let total = Infinity;
    let status = 200;
    for (let page = 0; page < Math.min(MAX_PAGES, state.maxPages ?? MAX_PAGES) && positions.length < total; page++) {
      const res = await fetcher.fetch(`https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}&start=${page * PAGE}&sort_by=timestamp`, { kind: "api" });
      status = res.status;
      const body = JSON.parse(res.body) as { data?: { positions?: EfPosition[]; count?: number } };
      const batch = body.data?.positions ?? [];
      total = body.data?.count ?? positions.length + batch.length;
      positions.push(...batch);
      if (batch.length < PAGE) break;
    }
    const complete = positions.length >= total;
    const contentHash = sha256(JSON.stringify(positions.map((p) => [p.id, p.name, p.locations, p.postedTs])));
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, etag: null, lastModified: null, contentHash, httpStatus: status, complete };
    const jobs: RawJob[] = [];
    let budget = state.maxDetailFetches;
    for (const p of positions) {
      if (state.knownJobIds.has(String(p.id)) || budget <= 0) {
        jobs.push(toRaw(host, p));
        continue;
      }
      budget--;
      const detail = await this.fetchJobDetails(ref, String(p.id), fetcher).catch(() => null);
      jobs.push(detail ?? toRaw(host, p));
    }
    return { jobs, notModified: false, etag: null, lastModified: null, contentHash, httpStatus: status, complete, totalAvailable: Number.isFinite(total) ? total : undefined };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const { host, domain } = parts(ref);
    const res = await fetcher.fetch(`https://${host}/api/pcsx/position_details?position_id=${encodeURIComponent(id)}&domain=${encodeURIComponent(domain)}&hl=en`, { kind: "api" });
    const d = (JSON.parse(res.body) as { data?: EfPosition }).data;
    return d ? toRaw(host, d, d) : null;
  },
  supportsIncrementalSync: () => false,
  getLastModified: (job) => job.postedAt ?? null,
};
