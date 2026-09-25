import * as cheerio from "cheerio";
import { normalizeTitle } from "../domain/jobs/normalize";
import { eightfoldRefFromPage } from "./eightfold";
import { findEmbeddedAtsUrls } from "./generic";
import { oracleRefFromPage } from "./oracle";
import { detectByUrl } from "./registry";
import type { Fetcher, SourceRef } from "./types";

/**
 * Finds the ATS board behind a custom career page (PRD §13: prefer structured APIs over HTML).
 *
 * 1. The page embeds or references the board / its public API (iframe, script feed URL…).
 * 2. Otherwise probe likely board slugs (company name, domain) on public ATS APIs and accept a
 *    board only with evidence that it is *this* company's: job ids shared with the page's links,
 *    board job URLs pointing back to the page's site, or several matching job titles.
 */

export interface PageEvidence {
  host: string;
  jobIds: Set<string>;
  titles: Set<string>;
}

const baseHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

export function pageEvidence(html: string, pageUrl: string): PageEvidence {
  const $ = cheerio.load(html);
  const jobIds = new Set<string>();
  const titles = new Set<string>();
  const unescaped = html.replace(/\\\//g, "/");
  for (const m of unescaped.matchAll(/gh_jid=(\d{5,})/g)) jobIds.add(m[1]!);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    let path: string;
    try {
      path = new URL(href, pageUrl).pathname;
    } catch {
      return;
    }
    // Job pages typically end in a numeric id ("…-7703326/") or a UUID (Lever/Ashby style).
    const id = path.match(/[-/](\d{6,})\/?$/)?.[1] ?? path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i)?.[1];
    if (!id) return;
    jobIds.add(id.toLowerCase());
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 3 && text.length < 140) titles.add(normalizeTitle(text));
  });
  return { host: baseHost(new URL(pageUrl).hostname), jobIds, titles };
}

interface BoardSample {
  ids: string[];
  titles: string[];
  urls: string[];
}

interface Probe {
  url: (slug: string) => string;
  parse: (body: string) => BoardSample;
}

const PROBES: Probe[] = [
  {
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs`,
    parse: (b) => {
      const jobs = (JSON.parse(b) as { jobs?: { id: number; title: string; absolute_url: string }[] }).jobs ?? [];
      return { ids: jobs.map((j) => String(j.id)), titles: jobs.map((j) => j.title), urls: jobs.map((j) => j.absolute_url) };
    },
  },
  {
    url: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
    parse: (b) => {
      const jobs = JSON.parse(b) as { id: string; text: string; hostedUrl: string }[];
      return { ids: jobs.map((j) => j.id.toLowerCase()), titles: jobs.map((j) => j.text), urls: jobs.map((j) => j.hostedUrl) };
    },
  },
  {
    url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}`,
    parse: (b) => {
      const jobs = (JSON.parse(b) as { jobs?: { id: string; title: string; jobUrl: string }[] }).jobs ?? [];
      return { ids: jobs.map((j) => j.id.toLowerCase()), titles: jobs.map((j) => j.title), urls: jobs.map((j) => j.jobUrl) };
    },
  },
];

/** Candidate board slugs: "MongoDB Inc." → mongodb; www.okta.com → okta. */
export function candidateSlugs(companyName: string | null, pageUrl: string): string[] {
  const out = new Set<string>();
  const host = baseHost(new URL(pageUrl).hostname).split(".");
  const label = host.length >= 2 ? host[host.length - 2]! : host[0]!;
  if (label && !["careers", "jobs", "work"].includes(label)) out.add(label);
  if (companyName) {
    const name = companyName.toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation|technologies|pvt)\b\.?/g, "").trim();
    out.add(name.replace(/[^a-z0-9]/g, ""));
    out.add(name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }
  return [...out].filter((s) => s.length >= 2).slice(0, 3);
}

/** How strongly a board sample matches the page. 0 = no evidence. */
export function evidenceScore(page: PageEvidence, board: BoardSample): number {
  if (!board.ids.length) return 0;
  const idHits = board.ids.filter((id) => page.jobIds.has(id)).length;
  const urlHits = board.urls.filter((u) => {
    try {
      return baseHost(new URL(u).hostname) === page.host;
    } catch {
      return false;
    }
  }).length;
  const titleHits = board.titles.filter((t) => page.titles.has(normalizeTitle(t))).length;
  const need = (n: number) => Math.min(3, Math.max(1, n));
  let score = 0;
  if (page.jobIds.size && idHits >= need(page.jobIds.size)) score += 3;
  if (urlHits >= need(board.urls.length)) score += 2;
  if (page.titles.size && titleHits >= need(page.titles.size)) score += 1;
  return score;
}

export interface DiscoveredBoard {
  ref: SourceRef;
  method: "embedded" | "probe";
}

export async function discoverUnderlyingBoard(html: string, pageUrl: string, companyName: string | null, fetcher: Fetcher): Promise<DiscoveredBoard | null> {
  for (const url of findEmbeddedAtsUrls(html)) {
    const ref = detectByUrl(url);
    if (ref && ref.connectorType !== "GENERIC") return { ref, method: "embedded" };
  }
  // Platform fingerprints: career sites served by Oracle Recruiting or Eightfold (incl. custom domains).
  const platformRef = oracleRefFromPage(html, pageUrl) ?? eightfoldRefFromPage(html, pageUrl);
  if (platformRef) return { ref: platformRef, method: "embedded" };

  const page = pageEvidence(html, pageUrl);
  let best: { ref: SourceRef; score: number } | null = null;
  for (const slug of candidateSlugs(companyName, pageUrl)) {
    for (const probe of PROBES) {
      const url = probe.url(slug);
      const res = await fetcher.fetch(url, { kind: "api", timeoutMs: 10_000 }).catch(() => null);
      if (!res || res.status !== 200) continue;
      let sample: BoardSample;
      try {
        sample = probe.parse(res.body);
      } catch {
        continue;
      }
      const score = evidenceScore(page, sample);
      const ref = detectByUrl(url);
      if (ref && score > (best?.score ?? 0)) best = { ref, score };
    }
    if (best && best.score >= 3) break;
  }
  return best && best.score >= 2 ? { ref: best.ref, method: "probe" } : null;
}
