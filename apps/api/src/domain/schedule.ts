import { DateTime } from "luxon";

export interface DigestSchedule {
  timezone: string;
  morningEnabled: boolean;
  morningTime: string; // "HH:mm"
  eveningEnabled: boolean;
  eveningTime: string;
}

export interface DueWindow {
  window: string; // "2026-09-25:morning" (user-local date)
  label: "morning" | "evening";
  scheduledAt: Date;
}

const GRACE_MINUTES = 90;

function slots(s: DigestSchedule, day: DateTime): DueWindow[] {
  const out: DueWindow[] = [];
  const add = (enabled: boolean, time: string, label: "morning" | "evening") => {
    if (!enabled) return;
    const [h, m] = time.split(":").map(Number) as [number, number];
    const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    out.push({ window: `${day.toISODate()}:${label}`, label, scheduledAt: at.toJSDate() });
  };
  add(s.morningEnabled, s.morningTime, "morning");
  add(s.eveningEnabled, s.eveningTime, "evening");
  return out;
}

const zoneOrDefault = (tz: string) => (DateTime.now().setZone(tz).isValid ? tz : "Asia/Kolkata");

/**
 * Digest windows due now in the user's own timezone (PRD §33). A window stays due for a
 * grace period so a scheduler outage doesn't silently drop a digest; idempotency keys on
 * the window string prevent double sends.
 */
export function dueWindows(s: DigestSchedule, now = new Date()): DueWindow[] {
  const local = DateTime.fromJSDate(now).setZone(zoneOrDefault(s.timezone));
  return [local.minus({ days: 1 }), local]
    .flatMap((d) => slots(s, d.startOf("day")))
    .filter((w) => w.scheduledAt <= now && now.getTime() - w.scheduledAt.getTime() < GRACE_MINUTES * 60_000);
}

/** Next scheduled digest after `now`, or null when both are disabled. */
export function nextWindow(s: DigestSchedule, now = new Date()): DueWindow | null {
  const local = DateTime.fromJSDate(now).setZone(zoneOrDefault(s.timezone)).startOf("day");
  const upcoming = [local, local.plus({ days: 1 })].flatMap((d) => slots(s, d)).filter((w) => w.scheduledAt > now);
  return upcoming.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0] ?? null;
}

/** True when a window starts within `minutes` — used to refresh crawls just before a digest. */
export function windowStartingWithin(s: DigestSchedule, minutes: number, now = new Date()): boolean {
  const next = nextWindow(s, now);
  return !!next && next.scheduledAt.getTime() - now.getTime() <= minutes * 60_000;
}
