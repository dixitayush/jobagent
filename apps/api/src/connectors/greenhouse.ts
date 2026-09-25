import { sha256 } from "../lib/hash";
import type { RawJob } from "../domain/jobs/normalize";
import type { DiscoverResult, DiscoverState, Fetcher, JobSourceConnector, SourceRef } from "./types";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  content?: string;
  departments?: { name: string }[];
  offices?: { name: string; location?: string | null }[];
  metadata?: { name: string; value: unknown }[] | null;
}

const HOSTS = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i;
/** Public Job Board API hosts, as referenced by custom career pages: /v1/boards/{token}/... */
const API_HOSTS = /^(boards-api|api)\.greenhouse\.io$/i;

function toRaw(j: GhJob): RawJob {
  const offices = (j.offices ?? []).map((o) => o.location || o.name).filter(Boolean) as string[];
  const meta = (j.metadata ?? []).map((m) => `${m.name} ${String(m.value ?? "")}`).join(" ");
  return {
    sourceJobId: String(j.id),
    title: j.title,
    url: j.absolute_url,
    descriptionHtml: j.content ?? "",
    locations: j.location?.name ? [j.location.name, ...offices.filter((o) => o !== j.location?.name)] : offices,
    employmentTypeRaw: /employment type|job type/i.test(meta) ? meta : null,
    department: j.departments?.[0]?.name ?? null,
    postedAt: j.first_published ? new Date(j.first_published) : null,
    updatedAt: j.updated_at ? new Date(j.updated_at) : null,
  };
}

export const greenhouseConnector: JobSourceConnector = {
  type: "GREENHOUSE",
  displayName: "Greenhouse",
  detect(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    let token: string | null | undefined;
    if (API_HOSTS.test(url.hostname)) token = parts[0] === "v1" && parts[1] === "boards" ? parts[2] : null;
    else if (HOSTS.test(url.hostname)) token = parts[0] === "embed" ? url.searchParams.get("for") : parts[0];
    else return null;
    if (!token || !/^[a-z0-9_-]+$/i.test(token)) return null;
    return {
      connectorType: "GREENHOUSE",
      identifier: token.toLowerCase(),
      sourceUrl: `https://boards.greenhouse.io/${token.toLowerCase()}`,
      canonicalKey: `GREENHOUSE:${token.toLowerCase()}`,
      strategy: "Greenhouse Job Board API (JSON)",
    };
  },
  async discoverJobs(ref: SourceRef, fetcher: Fetcher, state: DiscoverState): Promise<DiscoverResult> {
    const res = await fetcher.fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.identifier)}/jobs?content=true`, {
      kind: "api",
      etag: state.etag,
      lastModified: state.lastModified,
    });
    const meta = { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), httpStatus: res.status };
    if (res.notModified) return { jobs: [], notModified: true, contentHash: state.contentHash, complete: true, ...meta };
    const contentHash = sha256(res.body);
    if (contentHash === state.contentHash) return { jobs: [], notModified: true, contentHash, complete: true, ...meta };
    const body = JSON.parse(res.body) as { jobs?: GhJob[] };
    return { jobs: (body.jobs ?? []).map(toRaw), notModified: false, contentHash, complete: true, ...meta };
  },
  async fetchJobDetails(ref, id, fetcher) {
    const res = await fetcher.fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.identifier)}/jobs/${encodeURIComponent(id)}`, { kind: "api" });
    return toRaw(JSON.parse(res.body) as GhJob);
  },
  supportsIncrementalSync: () => true,
  getLastModified: (job) => job.updatedAt ?? null,
};
