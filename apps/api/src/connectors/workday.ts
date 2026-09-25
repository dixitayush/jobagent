import { sha256 } from "../lib/hash";
import { parsePostedDate, type RawJob } from "../domain/jobs/normalize";
import type { JobSourceConnector, SourceRef } from "./types";

interface WdListing {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}
interface WdDetail {
  jobPostingInfo?: {
    id?: string;
    title: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    postedOn?: string;
    startDate?: string;
    jobReqId?: string;
    externalUrl?: string;
    remoteType?: string;
  };
}

const PAGE = 20;
const MAX_PAGES = 15;

/** identifier = "host|tenant|site", e.g. "acme.wd5.myworkdayjobs.com|acme|External". */
function parts(ref: SourceRef) {
  const [host, tenant, site] = ref.identifier.split("|") as [string, string, string];
  return { host, tenant, site, api: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}` };
}

const idFromPath = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

function listingToRaw(ref: SourceRef, l: WdListing): RawJob {
  const { host, site } = parts(ref);
  return {
    sourceJobId: idFromPath(l.externalPath),
    title: l.title,
    url: `https://${host}/${site}${l.externalPath}`,
    locations: l.locationsText && !/^\d+ locations?$/i.test(l.locationsText) ? [l.locationsText] : [],
    postedAt: parsePostedDate(l.postedOn ?? null),
    partial: true,
  };
}

function detailToRaw(ref: SourceRef, path: string, d: WdDetail): RawJob | null {
  const info = d.jobPostingInfo;
  if (!info) return null;
  const { host, site } = parts(ref);
  return {
    sourceJobId: idFromPath(path),
    title: info.title,
    url: info.externalUrl ?? `https://${host}/${site}${path}`,
    descriptionHtml: info.jobDescription ?? "",
    locations: [info.location, ...(info.additionalLocations ?? [])].filter((x): x is string => !!x),
    employmentTypeRaw: info.timeType ?? null,
    workModeRaw: info.remoteType ?? null,
    postedAt: parsePostedDate(info.startDate ?? info.postedOn ?? null),
  };
}

export const workdayConnector: JobSourceConnector = {
  type: "WORKDAY",
  displayName: "Workday",
  detect(url) {
    const m = url.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
    if (!m) return null;
    const segs = url.pathname.split("/").filter(Boolean);
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(segs[0] ?? "") ? segs[1] : segs[0];
    if (!site) return null;
    const tenant = m[1]!.toLowerCase();
    const host = url.hostname.toLowerCase();
    return {
      connectorType: "WORKDAY",
      identifier: `${host}|${tenant}|${site}`,
      sourceUrl: `https://${host}/${site}`,
      canonicalKey: `WORKDAY:${host}/${site.toLowerCase()}`,
      strategy: "Workday CXS job search API (JSON)",
    };
  },
  async discoverJobs(ref, fetcher, state) {
    const { api } = parts(ref);
    const listings: WdListing[] = [];
    let status = 200;
    let complete = true;
    const pages = Math.min(MAX_PAGES, state.maxPages ?? MAX_PAGES);
    let total = 0;
    for (let page = 0; page < pages; page++) {
      const res = await fetcher.fetch(`${api}/jobs`, {
        kind: "api",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: "" }),
      });
      status = res.status;
      const body = JSON.parse(res.body) as { total?: number; jobPostings?: WdListing[] };
      listings.push(...(body.jobPostings ?? []));
      total = Math.max(total, body.total ?? 0);
      if ((body.jobPostings?.length ?? 0) < PAGE || listings.length >= (body.total ?? 0)) break;
      if (page === pages - 1) complete = false;
    }
    const contentHash = sha256(JSON.stringify(listings.map((l) => [l.externalPath, l.title, l.locationsText])));
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, etag: null, lastModified: null, contentHash, httpStatus: status, complete };
    const jobs: RawJob[] = [];
    let budget = state.maxDetailFetches;
    for (const l of listings) {
      const id = idFromPath(l.externalPath);
      if (state.knownJobIds.has(id) || budget <= 0) {
        jobs.push(listingToRaw(ref, l));
        continue;
      }
      budget--;
      const res = await fetcher.fetch(`${api}${l.externalPath}`, { kind: "api" }).catch(() => null);
      const detail = res ? detailToRaw(ref, l.externalPath, JSON.parse(res.body) as WdDetail) : null;
      jobs.push(detail ? { ...detail, postedAt: detail.postedAt ?? parsePostedDate(l.postedOn ?? null) } : listingToRaw(ref, l));
    }
    return { jobs, notModified: false, etag: null, lastModified: null, contentHash, httpStatus: status, complete, totalAvailable: total || undefined };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const { api } = parts(ref);
    const res = await fetcher.fetch(`${api}/job/${encodeURIComponent(id)}`, { kind: "api" });
    return detailToRaw(ref, `/job/${id}`, JSON.parse(res.body) as WdDetail);
  },
  supportsIncrementalSync: () => false,
  getLastModified: (job) => job.postedAt ?? null,
};
