import { PlatformSettings } from "@jobagent/shared";
import type { PlatformSettings as PlatformSettingsT } from "@jobagent/shared";
import { env } from "../config/env";
import { query } from "../db/pool";
import { cached, invalidate } from "../lib/redis";

/** Configuration-driven behaviour (PRD §73, §110, §125). Env provides defaults; admins override in DB. */
export function defaultSettings(): PlatformSettingsT {
  return {
    crawlingPaused: false,
    notificationsPaused: false,
    llmProvider: env.LLM_PROVIDER,
    llmModel: env.LLM_MODEL,
    llmSmallModel: env.LLM_SMALL_MODEL,
    llmTemperature: 0,
    embeddingProvider: env.EMBEDDING_PROVIDER,
    defaultCrawlIntervalMinutes: 360,
    maxJobsPerNotification: 50,
    matchThresholds: { veryStrong: 90, strong: 80, good: 70, partial: 55 },
    llmBorderline: { min: 60, max: 85 },
    retrievalLimit: 100,
    llmMaxJobsPerRun: 20,
    planLimits: {
      free: { maxSources: 5, maxResumeVersions: 5, maxJobsPerNotification: 10, notificationsPerDay: 2 },
      pro: { maxSources: 50, maxResumeVersions: 20, maxJobsPerNotification: 25, notificationsPerDay: 2 },
      premium: { maxSources: 200, maxResumeVersions: 50, maxJobsPerNotification: 50, notificationsPerDay: 4 },
    },
    retentionDays: { agentLogs: 90, llmRequests: 90 },
  };
}

const KEY = "platform:settings:v1";

export async function getSettings(): Promise<PlatformSettingsT> {
  return cached(KEY, 30, async () => {
    const rows = await query<{ value: Partial<PlatformSettingsT> }>("SELECT value FROM platform_settings WHERE key = 'platform'");
    const merged = { ...defaultSettings(), ...(rows[0]?.value ?? {}) };
    const parsed = PlatformSettings.safeParse(merged);
    return parsed.success ? parsed.data : defaultSettings();
  });
}

export async function updateSettings(patch: Partial<PlatformSettingsT>): Promise<PlatformSettingsT> {
  const next = PlatformSettings.parse({ ...(await getSettings()), ...patch });
  await query(
    `INSERT INTO platform_settings (key, value) VALUES ('platform', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(next)],
  );
  await invalidate(KEY);
  return next;
}

export async function planLimits(plan: string) {
  const s = await getSettings();
  return s.planLimits[plan] ?? s.planLimits.free ?? defaultSettings().planLimits.free!;
}
