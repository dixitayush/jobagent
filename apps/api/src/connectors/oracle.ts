import { sha256 } from "../lib/hash";
import { parsePostedDate, type RawJob } from "../domain/jobs/normalize";
import type { JobSourceConnector, SourceRef } from "./types";

/**
 * Oracle Recruiting Cloud ("Candidate Experience") career sites, e.g.
 * careers.americanexpress.com/en/sites/CX_1 backed by egug.fa.us2.oraclecloud.com.
 * Uses the public hcmRestApi recruitingCEJobRequisitions endpoints the career site itself calls.
 * identifier = "apiHost|siteNumber|publicSiteBase".
 */

interface OrcRequisition {
  Id: string;
  Title: string;
  PostedDate?: string | null;
  PrimaryLocation?: string | null;
  secondaryLocations?: { Name?: string }[];
  WorkplaceType?: string | null;
  WorkplaceTypeCode?: string | null;
  JobSchedule?: string | null;
  ContractType?: string | null;
  Department?: string | null;
  JobFamily?: string | null;
  ShortDescriptionStr?: string | null;
  ExternalQualificationsStr?: string | null;
  ExternalResponsibilitiesStr?: string | null;
}
interface OrcDetail extends OrcRequisition {
  ExternalDescriptionStr?: string | null;
  ExternalPostedStartDate?: string | null;
}

const PAGE = 100;
/** Oracle HCM REST responses can be slow; allow longer than the default crawl timeout. */
const TIMEOUT_MS = 45_000;
const MAX_PAGES = 15;

function parts(ref: SourceRef) {
  const [apiHost, site, publicBase] = ref.identifier.split("|") as [string, string, string];
  return { apiHost, site, publicBase };
}

const workMode = (code?: string | null, label?: string | null) =>
  code === "ORA_REMOTE" ? "remote" : code === "ORA_HYBRID" ? "hybrid" : code === "ORA_ON_SITE" ? "onsite" : (label ?? null);

function toRaw(ref: SourceRef, r: OrcRequisition, detail?: OrcDetail): RawJob {
  const { publicBase } = parts(ref);
  const src = detail ?? r;
  const html = [
    detail?.ExternalDescriptionStr,
    src.ExternalResponsibilitiesStr && `<h3>Responsibilities</h3>${src.ExternalResponsibilitiesStr}`,
    src.ExternalQualificationsStr && `<h3>Qualifications</h3>${src.ExternalQualificationsStr}`,
    !detail && src.ShortDescriptionStr,
  ]
    .filter(Boolean)
    .join("\n");
  const locations = [r.PrimaryLocation ?? detail?.PrimaryLocation, ...(r.secondaryLocations ?? []).map((l) => l.Name)].filter((x): x is string => !!x);
  return {
    sourceJobId: String(r.Id),
    title: src.Title,
    url: `${publicBase}/job/${encodeURIComponent(r.Id)}`,
    descriptionHtml: html || null,
    locations: [...new Set(locations)],
    employmentTypeRaw: [src.JobSchedule, src.ContractType].filter(Boolean).join(" ") || null,
    workModeRaw: workMode(src.WorkplaceTypeCode, src.WorkplaceType),
    isRemote: src.WorkplaceTypeCode === "ORA_REMOTE",
    department: src.Department ?? src.JobFamily ?? null,
    postedAt: parsePostedDate(detail?.ExternalPostedStartDate ?? r.PostedDate ?? null),
    partial: !detail,
  };
}

export function oracleRef(apiHost: string, site: string, publicBase: string): SourceRef {
  const host = apiHost.toLowerCase();
  return {
    connectorType: "ORACLE",
    identifier: `${host}|${site}|${publicBase.replace(/\/$/, "")}`,
    sourceUrl: publicBase.replace(/\/$/, ""),
    canonicalKey: `ORACLE:${host}:${site.toLowerCase()}`,
    strategy: "Oracle Recruiting Cloud candidate experience API (JSON)",
  };
}

const ORACLE_HOST = /^[a-z0-9-]+\.fa(\.[a-z0-9-]+)?\.oraclecloud\.com$/i;

/** Page fingerprint: custom career domains front an *.oraclecloud.com tenant and a siteNumber. */
export function oracleRefFromPage(html: string, pageUrl: string): SourceRef | null {
  const hosts = [...html.matchAll(/https?:\/\/([a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com)/gi)].map((m) => m[1]!.toLowerCase());
  const site = html.match(/siteNumber=([A-Za-z0-9_]+)/)?.[1] ?? new URL(pageUrl).pathname.match(/\/sites\/([A-Za-z0-9_]+)/)?.[1];
  if (!hosts.length || !site) return null;
  const apiHost = hosts.sort((a, b) => hosts.filter((h) => h === b).length - hosts.filter((h) => h === a).length)[0]!;
  const url = new URL(pageUrl);
  const lang = url.pathname.match(/\/([a-z]{2}(?:-[A-Z]{2})?)\/sites\//)?.[1] ?? "en";
  const publicBase = ORACLE_HOST.test(url.hostname)
    ? `https://${url.hostname}/hcmUI/CandidateExperience/${lang}/sites/${site}`
    : `${url.origin}/${lang}/sites/${site}`;
  return oracleRef(apiHost, site, publicBase);
}

export const oracleConnector: JobSourceConnector = {
  type: "ORACLE",
  displayName: "Oracle Recruiting",
  detect(url) {
    if (!ORACLE_HOST.test(url.hostname)) return null;
    const m = url.pathname.match(/\/hcmUI\/CandidateExperience\/([a-z]{2}(?:-[A-Z]{2})?)\/sites\/([A-Za-z0-9_]+)/);
    if (!m) return null;
    return oracleRef(url.hostname, m[2]!, `https://${url.hostname}/hcmUI/CandidateExperience/${m[1]}/sites/${m[2]}`);
  },
  async discoverJobs(ref, fetcher, state) {
    const { apiHost, site } = parts(ref);
    const reqs: OrcRequisition[] = [];
    let total = Infinity;
    let status = 200;
    for (let page = 0; page < Math.min(MAX_PAGES, state.maxPages ?? MAX_PAGES) && reqs.length < total; page++) {
      const finder = `findReqs;siteNumber=${site},limit=${PAGE},offset=${page * PAGE},sortBy=POSTING_DATES_DESC`;
      const res = await fetcher.fetch(
        `https://${apiHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`,
        { kind: "api", timeoutMs: TIMEOUT_MS },
      );
      status = res.status;
      const item = (JSON.parse(res.body) as { items?: { TotalJobsCount?: number; requisitionList?: OrcRequisition[] }[] }).items?.[0];
      const batch = item?.requisitionList ?? [];
      total = item?.TotalJobsCount ?? reqs.length + batch.length;
      reqs.push(...batch);
      if (batch.length < PAGE) break;
    }
    const complete = reqs.length >= total;
    const contentHash = sha256(JSON.stringify(reqs.map((r) => [r.Id, r.Title, r.PrimaryLocation, r.PostedDate])));
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, etag: null, lastModified: null, contentHash, httpStatus: status, complete };
    const jobs: RawJob[] = [];
    let budget = state.maxDetailFetches;
    for (const r of reqs) {
      if (state.knownJobIds.has(String(r.Id)) || budget <= 0) {
        jobs.push(toRaw(ref, r));
        continue;
      }
      budget--;
      const detail = await this.fetchJobDetails(ref, String(r.Id), fetcher).catch(() => null);
      // Keep listing-level locations (the detail payload omits secondary locations).
      jobs.push(detail ? { ...detail, locations: toRaw(ref, r).locations } : toRaw(ref, r));
    }
    return { jobs, notModified: false, etag: null, lastModified: null, contentHash, httpStatus: status, complete, totalAvailable: Number.isFinite(total) ? total : undefined };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const { apiHost, site } = parts(ref);
    const finder = `ById;Id="${id}",siteNumber=${site}`;
    const res = await fetcher.fetch(
      `https://${apiHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`,
      { kind: "api", timeoutMs: TIMEOUT_MS },
    );
    const d = (JSON.parse(res.body) as { items?: OrcDetail[] }).items?.[0];
    return d ? toRaw(ref, { ...d, Id: id }, d) : null;
  },
  supportsIncrementalSync: () => false,
  getLastModified: (job) => job.postedAt ?? null,
};
