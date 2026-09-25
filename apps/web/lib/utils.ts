import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { MATCH_LEVEL_LABELS, type MatchLevel } from "@jobagent/shared";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.round(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone });
}

export function formatTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
}

export const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "");

export const levelLabel = (l: MatchLevel | null | undefined) => (l ? MATCH_LEVEL_LABELS[l] : "Not scored");

export const LEVEL_STYLES: Record<MatchLevel, string> = {
  VERY_STRONG: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  STRONG: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  GOOD: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  PARTIAL: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
