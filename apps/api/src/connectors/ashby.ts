import { sha256 } from "../lib/hash";
import type { RawJob } from "../domain/jobs/normalize";
import type { JobSourceConnector } from "./types";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  department?: string;
  team?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string | null;
  employmentType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  jobUrl: string;
  compensation?: { compensationTierSummary?: string | null } | null;
}

function toRaw(j: AshbyJob): RawJob {
  return {
    sourceJobId: j.id,
    title: j.title,
    url: j.jobUrl,
    descriptionHtml: j.descriptionHtml ?? null,
    descriptionText: j.descriptionHtml ? null : (j.descriptionPlain ?? null),
    locations: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter((x): x is string => !!x),
    employmentTypeRaw: j.employmentType?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? null,
    workModeRaw: j.workplaceType ?? null,
    isRemote: j.isRemote ?? null,
    department: j.department ?? j.team ?? null,
    postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
    salaryText: j.compensation?.compensationTierSummary ?? null,
  };
}

export const ashbyConnector: JobSourceConnector = {
  type: "ASHBY",
  displayName: "Ashby",
  detect(url) {
    // Hosted board (jobs.ashbyhq.com/{org}) or Posting API (api.ashbyhq.com/posting-api/job-board/{org}).
    const segs = url.pathname.split("/").filter(Boolean);
    let org: string | undefined;
    if (/^jobs\.ashbyhq\.com$/i.test(url.hostname)) org = segs[0];
    else if (/^api\.ashbyhq\.com$/i.test(url.hostname) && segs[0] === "posting-api" && segs[1] === "job-board") org = segs[2];
    else return null;
    if (!org || !/^[a-z0-9_.%-]+$/i.test(org)) return null;
    const id = decodeURIComponent(org);
    return {
      connectorType: "ASHBY",
      identifier: id,
      sourceUrl: `https://jobs.ashbyhq.com/${org}`,
      canonicalKey: `ASHBY:${id.toLowerCase()}`,
      strategy: "Ashby Posting API (JSON)",
    };
  },
  async discoverJobs(ref, fetcher, state) {
    const res = await fetcher.fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.identifier)}?includeCompensation=true`, {
      kind: "api",
      etag: state.etag,
    });
    const meta = { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), httpStatus: res.status };
    if (res.notModified) return { jobs: [], notModified: true, contentHash: state.contentHash, complete: true, ...meta };
    const contentHash = sha256(res.body);
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, contentHash, complete: true, ...meta };
    const body = JSON.parse(res.body) as { jobs?: AshbyJob[] };
    return { jobs: (body.jobs ?? []).filter((j) => j.isListed !== false).map(toRaw), notModified: false, contentHash, complete: true, ...meta };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const all = await this.discoverJobs(ref, fetcher, { etag: null, lastModified: null, contentHash: null, knownJobIds: new Set(), maxDetailFetches: 0 });
    return all.jobs.find((j) => j.sourceJobId === id) ?? null;
  },
  supportsIncrementalSync: () => false,
  getLastModified: (job) => job.postedAt ?? null,
};
