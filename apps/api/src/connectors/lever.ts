import { sha256 } from "../lib/hash";
import type { RawJob } from "../domain/jobs/normalize";
import type { JobSourceConnector } from "./types";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  updatedAt?: number;
  categories?: { location?: string; commitment?: string; team?: string; department?: string; allLocations?: string[] };
  workplaceType?: "remote" | "hybrid" | "on-site" | "onsite" | "unspecified";
  description?: string;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

function toRaw(p: LeverPosting): RawJob {
  const html = [p.description ?? "", ...(p.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), p.additional ?? ""].join("\n");
  const cats = p.categories ?? {};
  return {
    sourceJobId: p.id,
    title: p.text,
    url: p.hostedUrl,
    descriptionHtml: html,
    locations: cats.allLocations?.length ? cats.allLocations : cats.location ? [cats.location] : [],
    employmentTypeRaw: cats.commitment ?? null,
    workModeRaw: p.workplaceType && p.workplaceType !== "unspecified" ? p.workplaceType : null,
    isRemote: p.workplaceType === "remote",
    department: cats.team ?? cats.department ?? null,
    postedAt: p.createdAt ? new Date(p.createdAt) : null,
    updatedAt: p.updatedAt ? new Date(p.updatedAt) : null,
    salaryMin: p.salaryRange?.min ?? null,
    salaryMax: p.salaryRange?.max ?? null,
    salaryCurrency: p.salaryRange?.currency ?? null,
    salaryText: p.salaryRange?.min
      ? `${p.salaryRange.currency ?? ""} ${p.salaryRange.min}–${p.salaryRange.max ?? ""}${p.salaryRange.interval ? ` ${p.salaryRange.interval.replace(/-/g, " ")}` : ""}`.trim()
      : null,
  };
}

const apiBase = (identifier: string) => (identifier.startsWith("eu:") ? "https://api.eu.lever.co" : "https://api.lever.co");
const slug = (identifier: string) => identifier.replace(/^eu:/, "");

export const leverConnector: JobSourceConnector = {
  type: "LEVER",
  displayName: "Lever",
  detect(url) {
    // Hosted board (jobs.lever.co/{company}) or Postings API (api.lever.co/v0/postings/{company}).
    const board = url.hostname.match(/^jobs(\.eu)?\.lever\.co$/i);
    const api = url.hostname.match(/^api(\.eu)?\.lever\.co$/i);
    const m = board ?? api;
    if (!m) return null;
    const segs = url.pathname.split("/").filter(Boolean);
    const company = board ? segs[0] : segs[0] === "v0" && segs[1] === "postings" ? segs[2] : undefined;
    if (!company || !/^[a-z0-9_.-]+$/i.test(company)) return null;
    const id = `${m[1] ? "eu:" : ""}${company.toLowerCase()}`;
    return {
      connectorType: "LEVER",
      identifier: id,
      sourceUrl: `https://jobs${m[1] ?? ""}.lever.co/${company.toLowerCase()}`,
      canonicalKey: `LEVER:${id}`,
      strategy: "Lever Postings API (JSON)",
    };
  },
  async discoverJobs(ref, fetcher, state) {
    const res = await fetcher.fetch(`${apiBase(ref.identifier)}/v0/postings/${encodeURIComponent(slug(ref.identifier))}?mode=json`, {
      kind: "api",
      etag: state.etag,
      lastModified: state.lastModified,
    });
    const meta = { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), httpStatus: res.status };
    if (res.notModified) return { jobs: [], notModified: true, contentHash: state.contentHash, complete: true, ...meta };
    const contentHash = sha256(res.body);
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, contentHash, complete: true, ...meta };
    const postings = JSON.parse(res.body) as LeverPosting[];
    return { jobs: postings.map(toRaw), notModified: false, contentHash, complete: true, ...meta };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const res = await fetcher.fetch(`${apiBase(ref.identifier)}/v0/postings/${encodeURIComponent(slug(ref.identifier))}/${encodeURIComponent(id)}`, { kind: "api" });
    return toRaw(JSON.parse(res.body) as LeverPosting);
  },
  supportsIncrementalSync: () => true,
  getLastModified: (job) => job.updatedAt ?? job.postedAt ?? null,
};
