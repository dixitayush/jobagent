import * as cheerio from "cheerio";
import type { ConnectorType } from "@jobagent/shared";
import { sha256 } from "../lib/hash";
import { canonicalizeUrl, parsePostedDate, type RawJob } from "../domain/jobs/normalize";
import type { DiscoverResult, Fetcher, JobSourceConnector, SourceRef } from "./types";

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Collects schema.org JobPosting objects from JSON-LD blocks (handles @graph and ItemList). */
export function extractJobPostingsFromHtml(html: string): Json[] {
  const $ = cheerio.load(html);
  const out: Json[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Json;
    const types = asArray(obj["@type"] as string | string[]);
    if (types.includes("JobPosting")) out.push(obj);
    visit(obj["@graph"]);
    for (const el of asArray(obj.itemListElement as unknown[])) visit((el as Json)?.item ?? el);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {
      /* malformed JSON-LD is common; ignore the block */
    }
  });
  return out;
}

function placeToText(place: unknown): string | null {
  const p = place as Json | null;
  const addr = (p?.address ?? p) as Json | string | null;
  if (typeof addr === "string") return addr;
  if (!addr) return null;
  const country = typeof addr.addressCountry === "object" ? str((addr.addressCountry as Json).name) : str(addr.addressCountry);
  return [str(addr.addressLocality), str(addr.addressRegion), country].filter(Boolean).join(", ") || null;
}

export function jobPostingToRaw(jp: Json, pageUrl: string): RawJob | null {
  const title = str(jp.title) ?? str(jp.name);
  if (!title) return null;
  const url = str(jp.url) ?? pageUrl;
  const identifier = jp.identifier as Json | string | undefined;
  const idValue = typeof identifier === "object" ? str(identifier?.value) : str(identifier);
  const remote = asArray(jp.jobLocationType as string).some((t) => /telecommute/i.test(String(t)));
  const locations = asArray(jp.jobLocation).map(placeToText).filter((x): x is string => !!x);
  const applicant = asArray<Json>(jp.applicantLocationRequirements as Json).map((r) => str(r?.["name"])).filter(Boolean);
  const salary = jp.baseSalary as Json | undefined;
  const salaryValue = salary?.value as Json | undefined;
  return {
    sourceJobId: idValue ?? sha256(canonicalizeUrl(url)).slice(0, 24),
    title,
    url,
    descriptionHtml: str(jp.description) ?? "",
    locations: remote ? [`Remote${applicant.length ? ` - ${applicant.join(", ")}` : ""}`, ...locations] : locations,
    employmentTypeRaw: asArray(jp.employmentType as string).join(" ") || null,
    isRemote: remote,
    postedAt: parsePostedDate(str(jp.datePosted)),
    salaryMin: typeof salaryValue?.minValue === "number" ? salaryValue.minValue : null,
    salaryMax: typeof salaryValue?.maxValue === "number" ? salaryValue.maxValue : null,
    salaryCurrency: str(salary?.currency),
    experienceLevelRaw: typeof jp.experienceRequirements === "string" ? jp.experienceRequirements : null,
  };
}

/** Candidate links to individual job pages on the same site. */
function jobLinks(html: string, base: URL): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href")!, base);
      if (u.hostname !== base.hostname) return;
      if (!/\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?)\/[^/]+/i.test(u.pathname)) return;
      u.hash = "";
      if (u.toString() !== base.toString()) links.add(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  });
  return [...links].slice(0, 200);
}

const ATS_URL_RE = new RegExp(
  [
    "https?://(?:boards|job-boards|boards-api|api)(?:\\.eu)?\\.greenhouse\\.io/[^\"'\\s<>]+",
    "https?://(?:jobs|api)(?:\\.eu)?\\.lever\\.co/[^\"'\\s<>]+",
    "https?://(?:jobs|api)\\.ashbyhq\\.com/[^\"'\\s<>]+",
    "https?://(?:careers|jobs|api)\\.smartrecruiters\\.com/[^\"'\\s<>]+",
    "https?://[a-z0-9-]+\\.wd\\d+\\.myworkdayjobs\\.com/[^\"'\\s<>]+",
  ].join("|"),
  "gi",
);

/**
 * Many custom career pages are front-ends for an ATS: they embed its board, or load its public
 * API as a JSON feed (often inside escaped JSON, e.g. "https:\/\/api.greenhouse.io\/v1\/boards\/x").
 */
export function findEmbeddedAtsUrls(html: string): string[] {
  const unescaped = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  return [...new Set(unescaped.match(ATS_URL_RE) ?? [])];
}

/** Hosted ATS platforms without a public JSON API we use; crawled via JSON-LD (PRD §13). */
const HOSTED_PLATFORMS: { type: ConnectorType; re: RegExp; name: string }[] = [
  { type: "ICIMS", re: /(^|\.)icims\.com$/i, name: "iCIMS" },
  { type: "TALEO", re: /(^|\.)taleo\.net$/i, name: "Taleo" },
  { type: "SUCCESSFACTORS", re: /(^|\.)(successfactors\.(com|eu)|jobs\.sap\.com)$/i, name: "SuccessFactors" },
];

export function detectHostedPlatform(url: URL): { type: ConnectorType; name: string } | null {
  return HOSTED_PLATFORMS.find((p) => p.re.test(url.hostname)) ?? null;
}

function genericRef(url: URL, type: ConnectorType, strategy: string): SourceRef {
  const normalized = canonicalizeUrl(url.toString());
  return { connectorType: type, identifier: normalized, sourceUrl: normalized, canonicalKey: `${type}:${normalized.replace(/^https?:\/\//, "").toLowerCase()}`, strategy };
}

function makeGenericConnector(type: ConnectorType, displayName: string, detectFn: (url: URL) => boolean): JobSourceConnector {
  return {
    type,
    displayName,
    detect(url) {
      return detectFn(url) ? genericRef(url, type, "schema.org JobPosting structured data (HTML, no JavaScript execution)") : null;
    },
    async discoverJobs(ref, fetcher: Fetcher, state): Promise<DiscoverResult> {
      const res = await fetcher.fetch(ref.sourceUrl, { kind: "html", etag: state.etag, lastModified: state.lastModified, headers: { accept: "text/html" } });
      const meta = { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), httpStatus: res.status };
      if (res.notModified) return { jobs: [], notModified: true, contentHash: state.contentHash, complete: true, ...meta };
      const base = new URL(res.url);
      const found = new Map<string, RawJob>();
      for (const jp of extractJobPostingsFromHtml(res.body)) {
        const raw = jobPostingToRaw(jp, base.toString());
        if (raw) found.set(raw.sourceJobId, raw);
      }
      const links = jobLinks(res.body, base);
      const contentHash = sha256(JSON.stringify([[...found.keys()].sort(), links]));
      if (contentHash === state.contentHash) return { jobs: [], notModified: true, contentHash, complete: true, ...meta };
      let budget = state.maxDetailFetches;
      let complete = true;
      for (const link of links) {
        const knownId = sha256(canonicalizeUrl(link)).slice(0, 24);
        if (state.knownJobIds.has(knownId)) {
          found.set(knownId, { sourceJobId: knownId, title: "", url: link, locations: [], partial: true });
          continue;
        }
        if (budget-- <= 0) {
          complete = false;
          break;
        }
        const detail = await fetcher.fetch(link, { kind: "html", headers: { accept: "text/html" } }).catch(() => null);
        if (!detail) continue;
        for (const jp of extractJobPostingsFromHtml(detail.body)) {
          const raw = jobPostingToRaw(jp, link);
          // Detail pages are keyed by their URL so the next crawl recognises them as known.
          if (raw) found.set(knownId, { ...raw, sourceJobId: knownId });
        }
      }
      return { jobs: [...found.values()], notModified: false, contentHash, complete, ...meta };
    },
    async fetchJobDetails(_ref, sourceJobId, fetcher) {
      if (!/^https?:\/\//.test(sourceJobId)) return null;
      const res = await fetcher.fetch(sourceJobId, { kind: "html" });
      const jp = extractJobPostingsFromHtml(res.body)[0];
      return jp ? jobPostingToRaw(jp, sourceJobId) : null;
    },
    supportsIncrementalSync: () => true,
    getLastModified: (job) => job.postedAt ?? null,
  };
}

export const genericConnector = makeGenericConnector("GENERIC", "Custom career page", () => true);
export const icimsConnector = makeGenericConnector("ICIMS", "iCIMS", (u) => detectHostedPlatform(u)?.type === "ICIMS");
export const taleoConnector = makeGenericConnector("TALEO", "Taleo", (u) => detectHostedPlatform(u)?.type === "TALEO");
export const successFactorsConnector = makeGenericConnector("SUCCESSFACTORS", "SuccessFactors", (u) => detectHostedPlatform(u)?.type === "SUCCESSFACTORS");
