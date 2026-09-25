import { MATCH_LEVEL_LABELS, type MatchLevel, type MatchResult } from "@jobagent/shared";

export interface DigestJob {
  title: string;
  company: string;
  location: string;
  employmentType: string | null;
  workMode: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  score: number;
  matchLevel: MatchLevel;
  result: MatchResult;
  trackedUrl: string;
}

export interface DigestInput {
  name: string;
  generatedAt: Date;
  timezone: string;
  jobs: DigestJob[];
  viewAllUrl: string;
  settingsUrl: string;
  openPixelUrl: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LEVEL_COLORS: Record<MatchLevel, string> = {
  VERY_STRONG: "#047857",
  STRONG: "#15803d",
  GOOD: "#1d4ed8",
  PARTIAL: "#b45309",
  LOW: "#6b7280",
};

const pretty = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);

export function relativeTime(d: Date, now = new Date()): string {
  const h = Math.max(0, Math.round((now.getTime() - d.getTime()) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function jobBlock(j: DigestJob, now: Date): string {
  const posted = relativeTime(j.postedAt && j.postedAt < j.firstSeenAt ? j.postedAt : j.firstSeenAt, now);
  const meta = [j.location && `📍 ${esc(j.location)}`, pretty(j.employmentType) && `💼 ${pretty(j.employmentType)}`, pretty(j.workMode) && `🏠 ${pretty(j.workMode)}`, `🕒 Posted ${posted}`]
    .filter(Boolean)
    .join("<br>");
  const matched = j.result.skills.matched.slice(0, 6).map((s) => `✓ ${esc(s)}`);
  const inferred = j.result.skills.inferred.slice(0, 2).map((s) => `✓ ${esc(s)} (related experience)`);
  const exp = j.result.experience;
  const expLine = exp.requiredYears !== null && exp.candidateYears !== null ? `${exp.match ? "✓" : "△"} ${exp.requiredYears}+ years requested · you have ~${exp.candidateYears}` : null;
  const gaps = [...j.result.skills.missing.slice(0, 3).map((s) => `△ ${esc(s)} (required)`), ...j.result.skills.preferredMissing.slice(0, 2).map((s) => `△ ${esc(s)} (preferred)`)];
  const color = LEVEL_COLORS[j.matchLevel];
  return `
  <tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;">
    <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:${color};text-transform:uppercase;">${MATCH_LEVEL_LABELS[j.matchLevel]} · ${j.score}%</div>
    <div style="font-size:18px;font-weight:700;color:#111827;margin-top:6px;line-height:1.3;">${esc(j.title)}</div>
    <div style="font-size:15px;color:#374151;margin-top:2px;">${esc(j.company)}</div>
    <div style="font-size:13px;color:#4b5563;margin-top:10px;line-height:1.7;">${meta}</div>
    ${matched.length || inferred.length ? `<div style="font-size:13px;color:#111827;margin-top:12px;font-weight:600;">Why it matches</div><div style="font-size:13px;color:#065f46;line-height:1.7;">${[...matched, ...inferred].join("<br>")}${expLine ? `<br>${esc(expLine)}` : ""}<br>${j.result.location.match ? `✓ ${esc(j.result.location.reason)}` : ""}</div>` : ""}
    ${gaps.length ? `<div style="font-size:13px;color:#111827;margin-top:10px;font-weight:600;">Potential gaps</div><div style="font-size:13px;color:#92400e;line-height:1.7;">${gaps.join("<br>")}</div>` : ""}
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:14px;"><tr><td style="border-radius:8px;background:#111827;">
      <a href="${esc(j.trackedUrl)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">View Job</a>
    </td></tr></table>
  </td></tr>`;
}

/** Responsive, table-based HTML (works in Gmail, Outlook, Apple Mail, mobile) — PRD §36–38. */
export function renderDigest(input: DigestInput): { subject: string; html: string; text: string } {
  const n = input.jobs.length;
  const top = input.jobs[0];
  const subject = n === 1 && top ? `New match: ${top.title} at ${top.company}` : `${n} new jobs matching your profile${top ? ` — ${top.title} at ${top.company} and more` : ""}`;
  const date = input.generatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: input.timezone });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title>
<style>@media (max-width:620px){.container{width:100%!important}.px{padding-left:16px!important;padding-right:16px!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(top ? `${top.title} at ${top.company} — ${MATCH_LEVEL_LABELS[top.matchLevel]}` : "")}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td class="px" style="padding:28px 24px 20px;background:#111827;">
    <div style="font-size:13px;color:#9ca3af;letter-spacing:.08em;text-transform:uppercase;">Your AI Job Digest</div>
    <div style="font-size:24px;font-weight:700;color:#ffffff;margin-top:6px;">${n} New Job${n === 1 ? "" : "s"} Matching Your Profile</div>
    <div style="font-size:13px;color:#d1d5db;margin-top:6px;">Hi ${esc(input.name || "there")} · Generated ${esc(date)}</div>
  </td></tr>
  ${input.jobs.map((j) => jobBlock(j, input.generatedAt)).join("")}
  <tr><td align="center" style="padding:24px;border-top:1px solid #e5e7eb;">
    <a href="${esc(input.viewAllUrl)}" style="display:inline-block;padding:12px 22px;border-radius:8px;border:1px solid #111827;font-size:14px;font-weight:600;color:#111827;text-decoration:none;">View All Jobs</a>
  </td></tr>
  <tr><td style="padding:16px 24px 24px;font-size:12px;color:#6b7280;line-height:1.6;">
    Match levels are based on the information in your resume and preferences and are not a guarantee of fit.<br>
    <a href="${esc(input.settingsUrl)}" style="color:#6b7280;">Notification settings</a>
  </td></tr>
</table></td></tr></table>
${input.openPixelUrl ? `<img src="${esc(input.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;">` : ""}
</body></html>`;

  const text = [
    `Your AI Job Digest — ${n} new job${n === 1 ? "" : "s"} matching your profile (${date})`,
    "",
    ...input.jobs.flatMap((j) => [
      `${MATCH_LEVEL_LABELS[j.matchLevel].toUpperCase()} — ${j.score}%`,
      `${j.title} — ${j.company}`,
      j.location ? `Location: ${j.location}` : "",
      j.result.skills.matched.length ? `Matched: ${j.result.skills.matched.slice(0, 6).join(", ")}` : "",
      j.result.skills.missing.length ? `Gaps: ${j.result.skills.missing.slice(0, 3).join(", ")}` : "",
      `View: ${j.trackedUrl}`,
      "",
    ]),
    `View all jobs: ${input.viewAllUrl}`,
    `Notification settings: ${input.settingsUrl}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { subject, html, text };
}
