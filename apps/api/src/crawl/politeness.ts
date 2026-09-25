import robotsParser from "robots-parser";
import { env } from "../config/env";
import { redis } from "../lib/redis";
import { safeFetch } from "./httpClient";

/**
 * robots.txt compliance for HTML crawling (PRD §14). Public ATS JSON APIs designed for
 * programmatic job-board consumption (Greenhouse, Lever, Ashby, SmartRecruiters) are
 * accessed via their documented endpoints instead.
 */
export async function isAllowedByRobots(url: string): Promise<{ allowed: boolean; crawlDelayMs: number | null }> {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  const key = `robots:${u.host}`;
  let body: string | null = null;
  try {
    body = await redis().get(key);
  } catch {
    /* ignore cache errors */
  }
  if (body === null) {
    try {
      const res = await safeFetch(robotsUrl, { maxBytes: 512 * 1024, timeoutMs: 8000, headers: { accept: "text/plain" } });
      body = res.body;
    } catch {
      body = ""; // missing/unreachable robots.txt → no restrictions
    }
    await redis().set(key, body, "EX", 86_400).catch(() => undefined);
  }
  const robots = robotsParser(robotsUrl, body);
  const allowed = robots.isAllowed(url, env.CRAWLER_USER_AGENT) ?? true;
  const delay = robots.getCrawlDelay(env.CRAWLER_USER_AGENT);
  return { allowed, crawlDelayMs: delay ? Math.min(delay * 1000, 60_000) : null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-host politeness gate shared by all workers via Redis: enforces a minimum delay between
 * requests and a requests-per-minute ceiling (PRD §47).
 */
export async function acquireHostSlot(host: string, opts: { delayMs: number; perMinute: number; maxWaitMs?: number }): Promise<void> {
  const deadline = Date.now() + (opts.maxWaitMs ?? 120_000);
  const r = redis();
  while (Date.now() < deadline) {
    const minuteKey = `rl:${host}:${Math.floor(Date.now() / 60_000)}`;
    const gate = await r.set(`rl:gate:${host}`, "1", "PX", Math.max(opts.delayMs, 1), "NX");
    if (gate === "OK") {
      const count = await r.incr(minuteKey);
      if (count === 1) await r.expire(minuteKey, 70);
      if (count <= opts.perMinute) return;
      await sleep(60_000 - (Date.now() % 60_000) + 50);
      continue;
    }
    const ttl = await r.pttl(`rl:gate:${host}`);
    await sleep(Math.max(ttl, 50));
  }
  throw new Error(`Timed out waiting for rate-limit slot on ${host}`);
}
