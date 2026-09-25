import type { ConnectorType } from "@jobagent/shared";
import type { SafeFetchOptions, SafeResponse } from "../crawl/httpClient";
import type { RawJob } from "../domain/jobs/normalize";

/** A detected, crawlable source. `identifier` is connector-specific (board token, "host|tenant|site"…). */
export interface SourceRef {
  connectorType: ConnectorType;
  identifier: string;
  sourceUrl: string;
  /** Stable global key used to share one crawl across all users: "GREENHOUSE:stripe". */
  canonicalKey: string;
  strategy: string;
}

export type FetchKind = "api" | "html";

/** Network access handed to connectors; production wraps SSRF-safe fetch + politeness. */
export interface Fetcher {
  fetch(url: string, opts?: SafeFetchOptions & { kind?: FetchKind }): Promise<SafeResponse>;
}

export interface DiscoverState {
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  /** source_job_ids already stored; lets connectors skip expensive detail fetches. */
  knownJobIds: Set<string>;
  maxDetailFetches: number;
  /** Cap on listing pages (validation only needs a sample). */
  maxPages?: number;
}

export interface DiscoverResult {
  jobs: RawJob[];
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  httpStatus: number;
  /** False when pagination was truncated — closing unseen jobs would then be unsafe. */
  complete: boolean;
  /** Total open jobs the source reports, when it says (may exceed jobs.length if paging was capped). */
  totalAvailable?: number;
}

/** PRD §15 common connector interface. */
export interface JobSourceConnector {
  readonly type: ConnectorType;
  readonly displayName: string;
  /** Pure URL-based detection. */
  detect(url: URL): SourceRef | null;
  discoverJobs(ref: SourceRef, fetcher: Fetcher, state: DiscoverState): Promise<DiscoverResult>;
  fetchJobDetails(ref: SourceRef, sourceJobId: string, fetcher: Fetcher): Promise<RawJob | null>;
  supportsIncrementalSync(): boolean;
  getLastModified(job: RawJob): Date | null;
}

export class ConnectorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorUnavailableError";
  }
}

export const emptyState = (): DiscoverState => ({ etag: null, lastModified: null, contentHash: null, knownJobIds: new Set(), maxDetailFetches: 50 });
