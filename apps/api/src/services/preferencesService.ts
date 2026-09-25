import type { NotificationSettings, Preferences } from "@jobagent/shared";
import { query, queryOne } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { badRequest, limitExceeded } from "../lib/errors";
import { getSettings, planLimits } from "../settings/platformSettings";
import { locationRows } from "./referenceData";

export async function getPreferences(ctx: TenantContext): Promise<Preferences> {
  const r = await queryOne<{
    job_titles: string[];
    location_ids: number[];
    preferred_companies: string[];
    blocked_companies: string[];
    min_experience: number | null;
    max_experience: number | null;
    work_modes: Preferences["workModes"];
    employment_types: Preferences["employmentTypes"];
    include_recent_jobs: boolean;
    enabled_portals: Preferences["enabledPortals"];
  }>("SELECT * FROM user_preferences WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
  return {
    jobTitles: r?.job_titles ?? [],
    locationIds: r?.location_ids ?? [],
    preferredCompanies: r?.preferred_companies ?? [],
    blockedCompanies: r?.blocked_companies ?? [],
    minExperience: r?.min_experience ?? null,
    maxExperience: r?.max_experience ?? null,
    workModes: r?.work_modes ?? [],
    employmentTypes: r?.employment_types ?? ["FULL_TIME"],
    includeRecentJobs: r?.include_recent_jobs ?? false,
    enabledPortals: r?.enabled_portals ?? [],
  };
}

export async function updatePreferences(ctx: TenantContext, p: Preferences): Promise<Preferences> {
  if (p.minExperience !== null && p.maxExperience !== null && p.minExperience > p.maxExperience) throw badRequest("Minimum experience cannot exceed maximum");
  const valid = new Set((await locationRows()).map((l) => l.id));
  if (p.locationIds.some((id) => !valid.has(id))) throw badRequest("Unknown location selected");
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  await query(
    `INSERT INTO user_preferences (tenant_id, user_id, job_titles, location_ids, preferred_companies, blocked_companies, min_experience, max_experience, work_modes, employment_types, include_recent_jobs, enabled_portals)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id) DO UPDATE SET job_titles = EXCLUDED.job_titles, location_ids = EXCLUDED.location_ids,
       preferred_companies = EXCLUDED.preferred_companies, blocked_companies = EXCLUDED.blocked_companies,
       min_experience = EXCLUDED.min_experience, max_experience = EXCLUDED.max_experience, work_modes = EXCLUDED.work_modes,
       employment_types = EXCLUDED.employment_types, include_recent_jobs = EXCLUDED.include_recent_jobs, enabled_portals = EXCLUDED.enabled_portals`,
    [ctx.tenantId, ctx.userId, clean(p.jobTitles), [...new Set(p.locationIds)], clean(p.preferredCompanies), clean(p.blockedCompanies), p.minExperience, p.maxExperience, [...new Set(p.workModes)], [...new Set(p.employmentTypes)], p.includeRecentJobs, [...new Set(p.enabledPortals)]],
  );
  return getPreferences(ctx);
}

export async function getNotificationSettings(ctx: TenantContext): Promise<NotificationSettings> {
  const r = await queryOne<{
    morning_enabled: boolean;
    morning_time: string;
    evening_enabled: boolean;
    evening_time: string;
    jobs_per_notification: number;
    min_match_level: NotificationSettings["minMatchLevel"];
    email_enabled: boolean;
  }>("SELECT * FROM notification_settings WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
  return {
    morningEnabled: r?.morning_enabled ?? true,
    morningTime: r?.morning_time ?? "10:00",
    eveningEnabled: r?.evening_enabled ?? true,
    eveningTime: r?.evening_time ?? "21:00",
    jobsPerNotification: r?.jobs_per_notification ?? 10,
    minMatchLevel: r?.min_match_level ?? "GOOD",
    emailEnabled: r?.email_enabled ?? true,
  };
}

export async function updateNotificationSettings(ctx: TenantContext, plan: string, s: NotificationSettings): Promise<NotificationSettings> {
  const [limits, settings] = await Promise.all([planLimits(plan), getSettings()]);
  const max = Math.min(limits.maxJobsPerNotification, settings.maxJobsPerNotification);
  if (s.jobsPerNotification > max) throw limitExceeded(`Your plan allows up to ${max} jobs per notification`);
  await query(
    `INSERT INTO notification_settings (tenant_id, user_id, morning_enabled, morning_time, evening_enabled, evening_time, jobs_per_notification, min_match_level, email_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id) DO UPDATE SET morning_enabled = EXCLUDED.morning_enabled, morning_time = EXCLUDED.morning_time,
       evening_enabled = EXCLUDED.evening_enabled, evening_time = EXCLUDED.evening_time, jobs_per_notification = EXCLUDED.jobs_per_notification,
       min_match_level = EXCLUDED.min_match_level, email_enabled = EXCLUDED.email_enabled`,
    [ctx.tenantId, ctx.userId, s.morningEnabled, s.morningTime, s.eveningEnabled, s.eveningTime, s.jobsPerNotification, s.minMatchLevel, s.emailEnabled],
  );
  return getNotificationSettings(ctx);
}
