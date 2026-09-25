import type { Freshness } from "@jobagent/shared";

export const NEW_WINDOW_MS = 24 * 3_600_000;
export const RECENT_WINDOW_MS = 7 * 24 * 3_600_000;
export const EXPIRE_AFTER_MS = 60 * 24 * 3_600_000;

export interface FreshnessInput {
  status: "OPEN" | "CLOSED";
  firstSeenAt: Date;
  postedAt: Date | null;
  contentUpdatedAt: Date | null;
  lastSeenAt: Date;
}

/**
 * PRD §19. "First seen" is our own observation and is the primary signal; a source's
 * posted date can only make a job *older* (reposted stale jobs shouldn't look new).
 */
export function classifyFreshness(job: FreshnessInput, now = new Date()): Freshness {
  if (job.status === "CLOSED") return "CLOSED";
  const t = now.getTime();
  if (t - job.lastSeenAt.getTime() > EXPIRE_AFTER_MS) return "EXPIRED";
  const effective = Math.min(job.firstSeenAt.getTime(), job.postedAt?.getTime() ?? Infinity);
  if (job.contentUpdatedAt && t - job.contentUpdatedAt.getTime() < NEW_WINDOW_MS && t - effective >= NEW_WINDOW_MS) return "UPDATED";
  const age = t - effective;
  if (age < NEW_WINDOW_MS) return "NEW";
  if (age < RECENT_WINDOW_MS) return "RECENT";
  return "EXISTING";
}
