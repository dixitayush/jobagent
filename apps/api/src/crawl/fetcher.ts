import type { Fetcher } from "../connectors/types";
import { safeFetch } from "./httpClient";
import { acquireHostSlot, isAllowedByRobots } from "./politeness";

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`Blocked by robots.txt: ${new URL(url).pathname}`);
    this.name = "RobotsDisallowedError";
  }
}

export interface PolitenessConfig {
  delayMs: number;
  perMinute: number;
  maxRequests: number;
}

/** Production fetcher: SSRF-safe, per-host rate limited, robots-aware, request-count capped. */
export function createFetcher(cfg: PolitenessConfig): Fetcher & { requests: () => number } {
  let count = 0;
  return {
    requests: () => count,
    async fetch(url, opts = {}) {
      if (++count > cfg.maxRequests) throw new Error(`Crawl request budget exceeded (${cfg.maxRequests})`);
      const { kind = "api", ...rest } = opts;
      let delayMs = cfg.delayMs;
      if (kind === "html") {
        const robots = await isAllowedByRobots(url);
        if (!robots.allowed) throw new RobotsDisallowedError(url);
        if (robots.crawlDelayMs) delayMs = Math.max(delayMs, robots.crawlDelayMs);
      }
      await acquireHostSlot(new URL(url).hostname, { delayMs, perMinute: cfg.perMinute });
      return safeFetch(url, rest);
    },
  };
}
