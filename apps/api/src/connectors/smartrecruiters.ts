import { sha256 } from "../lib/hash";
import type { RawJob } from "../domain/jobs/normalize";
import type { JobSourceConnector } from "./types";

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  typeOfEmployment?: { label?: string };
  experienceLevel?: { label?: string };
  department?: { label?: string };
}
interface SrDetail extends SrPosting {
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

const PAGE = 100;
const MAX_PAGES = 10;

function toRaw(company: string, p: SrPosting, detail?: SrDetail): RawJob {
  const loc = p.location ?? {};
  const locText = loc.fullLocation ?? [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(", ");
  const sections = detail?.jobAd?.sections ?? {};
  const html = ["jobDescription", "qualifications", "additionalInformation"]
    .map((k) => sections[k])
    .filter(Boolean)
    .map((s) => `<h3>${s!.title ?? ""}</h3>${s!.text ?? ""}`)
    .join("\n");
  return {
    sourceJobId: p.id,
    title: p.name,
    url: `https://jobs.smartrecruiters.com/${company}/${p.id}`,
    descriptionHtml: html || null,
    locations: [loc.remote ? `Remote${locText ? ` - ${locText}` : ""}` : locText].filter(Boolean),
    employmentTypeRaw: p.typeOfEmployment?.label ?? null,
    workModeRaw: loc.hybrid ? "hybrid" : loc.remote ? "remote" : null,
    isRemote: loc.remote ?? null,
    department: p.department?.label ?? null,
    experienceLevelRaw: p.experienceLevel?.label ?? null,
    postedAt: p.releasedDate ? new Date(p.releasedDate) : null,
    partial: !detail,
  };
}

export const smartRecruitersConnector: JobSourceConnector = {
  type: "SMARTRECRUITERS",
  displayName: "SmartRecruiters",
  detect(url) {
    const segs = url.pathname.split("/").filter(Boolean);
    let company: string | undefined;
    if (/^(careers|jobs)\.smartrecruiters\.com$/i.test(url.hostname)) company = segs[0];
    else if (/^api\.smartrecruiters\.com$/i.test(url.hostname) && segs[0] === "v1" && segs[1] === "companies") company = segs[2];
    else return null;
    if (!company || !/^[a-z0-9_-]+$/i.test(company)) return null;
    return {
      connectorType: "SMARTRECRUITERS",
      identifier: company,
      sourceUrl: `https://careers.smartrecruiters.com/${company}`,
      canonicalKey: `SMARTRECRUITERS:${company.toLowerCase()}`,
      strategy: "SmartRecruiters Posting API (JSON)",
    };
  },
  async discoverJobs(ref, fetcher, state) {
    const postings: SrPosting[] = [];
    let status = 200;
    let complete = true;
    const pages = Math.min(MAX_PAGES, state.maxPages ?? MAX_PAGES);
    let total = 0;
    for (let page = 0; page < pages; page++) {
      const res = await fetcher.fetch(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(ref.identifier)}/postings?limit=${PAGE}&offset=${page * PAGE}`,
        { kind: "api" },
      );
      status = res.status;
      const body = JSON.parse(res.body) as { content?: SrPosting[]; totalFound?: number };
      postings.push(...(body.content ?? []));
      total = Math.max(total, body.totalFound ?? 0);
      if ((body.content?.length ?? 0) < PAGE || postings.length >= (body.totalFound ?? 0)) break;
      if (page === pages - 1) complete = false;
    }
    const contentHash = sha256(JSON.stringify(postings.map((p) => [p.id, p.name, p.releasedDate])));
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, etag: null, lastModified: null, contentHash, httpStatus: status, complete };
    const jobs: RawJob[] = [];
    let detailBudget = state.maxDetailFetches;
    for (const p of postings) {
      if (state.knownJobIds.has(p.id) || detailBudget <= 0) {
        jobs.push(toRaw(ref.identifier, p));
        continue;
      }
      detailBudget--;
      const detail = await this.fetchJobDetails(ref, p.id, fetcher).catch(() => null);
      jobs.push(detail ?? toRaw(ref.identifier, p));
    }
    return { jobs, notModified: false, etag: null, lastModified: null, contentHash, httpStatus: status, complete, totalAvailable: total || undefined };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const res = await fetcher.fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(ref.identifier)}/postings/${encodeURIComponent(id)}`, { kind: "api" });
    const d = JSON.parse(res.body) as SrDetail;
    return toRaw(ref.identifier, d, d);
  },
  supportsIncrementalSync: () => false,
  getLastModified: (job) => job.postedAt ?? null,
};
