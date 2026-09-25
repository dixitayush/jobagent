import * as cheerio from "cheerio";
import type { EmploymentType, Seniority, WorkMode } from "@jobagent/shared";
import { sha256 } from "../../lib/hash";

/** Raw job as returned by a connector, before normalization. */
export interface RawJob {
  sourceJobId: string;
  title: string;
  url: string;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  locations: string[];
  employmentTypeRaw?: string | null;
  workModeRaw?: string | null;
  isRemote?: boolean | null;
  department?: string | null;
  postedAt?: Date | null;
  updatedAt?: Date | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryText?: string | null;
  experienceLevelRaw?: string | null;
  /** Listing-only stub (details not fetched this crawl): only refreshes last_seen_at. */
  partial?: boolean;
}

export interface NormalizedJob {
  sourceJobId: string;
  title: string;
  normalizedTitle: string;
  canonicalUrl: string;
  url: string;
  description: string;
  locationRaw: string;
  employmentType: EmploymentType | null;
  workMode: WorkMode | null;
  seniority: Seniority | null;
  requiredYears: number | null;
  department: string | null;
  postedAt: Date | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryText: string | null;
  contentHash: string;
  dedupeHash: string;
  descriptionHash: string;
}

const MAX_DESCRIPTION_CHARS = 20_000;

/** Converts untrusted HTML to plain text. Never executes scripts; strips script/style entirely. */
export function htmlToText(html: string): string {
  // Some ATS APIs (Greenhouse) return entity-encoded HTML; decode once first.
  const decoded = /&lt;[a-z]/i.test(html) ? cheerio.load(`<textarea>${html}</textarea>`)("textarea").text() : html;
  const $ = cheerio.load(decoded);
  $("script, style, noscript, iframe, object, embed, svg").remove();
  $("br").replaceWith("\n");
  $("li").each((_, el) => {
    $(el).prepend("• ");
  });
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, ul, ol, section").each((_, el) => {
    $(el).append("\n");
  });
  return $.root()
    .text()
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

const TITLE_ABBREVIATIONS: [RegExp, string][] = [
  [/\bsr\.?(?=\s|$)/g, "senior"],
  [/\bjr\.?(?=\s|$)/g, "junior"],
  [/\bsde\b/g, "software development engineer"],
  [/\bswe\b/g, "software engineer"],
  [/\beng\.?(?=\s|$)/g, "engineer"],
  [/\bdev\b/g, "developer"],
  [/\bmgr\.?(?=\s|$)/g, "manager"],
  [/\bml\b/g, "machine learning"],
  [/\bqa\b/g, "quality assurance"],
  [/\bfe\b/g, "frontend"],
  [/\bbe\b/g, "backend"],
  [/\bfront[\s-]end\b/g, "frontend"],
  [/\bback[\s-]end\b/g, "backend"],
  [/\bfull[\s-]stack\b/g, "fullstack"],
];

export function normalizeTitle(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(/\(.*?\)|\[.*?\]/g, " "); // drop "(Remote)", "[Req 123]"
  t = t.replace(/[-–|,:/]+/g, " ");
  for (const [re, rep] of TITLE_ABBREVIATIONS) t = t.replace(re, rep);
  t = t.replace(/\b(i{1,3}|iv|v)\b/g, (m) => ({ i: "1", ii: "2", iii: "3", iv: "4", v: "5" })[m] ?? m);
  return t.replace(/[^a-z0-9+# ]/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9+# ]/g, "").trim();
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|pvt|private|corp|corporation|gmbh|plc|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strips tracking params and fragments so the same posting from different links collapses. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|source|src|ref|lever-source|trk|trackingid)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function inferEmploymentType(raw: string | null | undefined, title: string, text: string): EmploymentType | null {
  const s = `${raw ?? ""} ${title}`.toLowerCase();
  if (/\bintern(ship)?\b/.test(s)) return "INTERNSHIP";
  if (/\b(contract|contractor|freelance|c2h|contract[- ]to[- ]hire)\b/.test(s)) return "CONTRACT";
  if (/\bpart[\s_-]?time\b|parttime/.test(s)) return "PART_TIME";
  if (/\b(temporary|temp|seasonal|fixed[- ]term)\b/.test(s)) return "TEMPORARY";
  if (/\bfull[\s_-]?time\b|fulltime|permanent|regular/.test(s)) return "FULL_TIME";
  const t = text.slice(0, 3000).toLowerCase();
  if (/\bthis is a contract (role|position)\b/.test(t)) return "CONTRACT";
  if (/\bfull[\s-]time\b/.test(t)) return "FULL_TIME";
  return raw ? null : "FULL_TIME";
}

export function inferWorkMode(raw: string | null | undefined, isRemote: boolean | null | undefined, locations: string[], text: string): WorkMode | null {
  const s = `${raw ?? ""} ${locations.join(" ")}`.toLowerCase();
  if (/\bhybrid\b/.test(s)) return "HYBRID";
  if (/\b(on[\s-]?site|in[\s-]?office|onsite)\b/.test(s)) return "ONSITE";
  if (isRemote || /\b(remote|work from home|wfh|anywhere)\b/.test(s)) return "REMOTE";
  const t = text.slice(0, 4000).toLowerCase();
  if (/\bhybrid\b/.test(t)) return "HYBRID";
  if (/\b(fully remote|100% remote|remote[- ]first)\b/.test(t)) return "REMOTE";
  if (/\b(on[\s-]?site|in[\s-]office)\b/.test(t)) return "ONSITE";
  return null;
}

export function inferSeniority(title: string, levelRaw?: string | null): Seniority | null {
  const t = `${title} ${levelRaw ?? ""}`.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return "INTERN";
  if (/\b(vp|vice president|director|head of|chief|cto|ceo)\b/.test(t)) return "EXECUTIVE";
  if (/\b(principal|distinguished|fellow|architect)\b/.test(t)) return "PRINCIPAL";
  if (/\b(staff|lead|tech lead|team lead|manager|mgr)\b/.test(t)) return "LEAD";
  if (/\b(senior|sr\.?|iii|level 3|l5|sde\s?3|sde\s?iii)\b/.test(t)) return "SENIOR";
  if (/\b(junior|jr\.?|entry|graduate|fresher|new grad|associate|i\b|level 1)\b/.test(t)) return "JUNIOR";
  if (/\b(ii|level 2|mid|intermediate|sde\s?2)\b/.test(t)) return "MID";
  return null;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };

/** Extracts the minimum required years of experience ("4+ years", "3-5 yrs", "at least five years"). */
export function extractRequiredYears(text: string): number | null {
  const t = text.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\b/g, (m) => String(WORD_NUMBERS[m]));
  const patterns = [
    /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g,
    /(?:minimum|min\.?|at least|over)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g,
    /(\d{1,2})\s*\+\s*(?:years?|yrs?)/g,
    /(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:\w+\s){0,4}?(?:experience|exp\b)/g,
  ];
  const found: number[] = [];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const n = Number(m[1]);
      if (n > 0 && n <= 30) found.push(n);
    }
  }
  if (!found.length) return null;
  // Use the most common/lowest stated minimum; avoids picking "10 years of company history".
  return Math.min(...found);
}

/**
 * Parses relative/absolute dates from sources, e.g. Workday "Posted 3 Days Ago",
 * "Posted Today", "Posted 30+ Days Ago", ISO strings, epoch millis.
 */
export function parsePostedDate(input: string | number | null | undefined, now = new Date()): Date | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") {
    const d = new Date(input < 1e12 ? input * 1000 : input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = input.trim().toLowerCase();
  const day = 86_400_000;
  if (/\b(today|just posted|just now)\b/.test(s)) return new Date(now.getTime());
  if (/\byesterday\b/.test(s)) return new Date(now.getTime() - day);
  const rel = s.match(/(\d+)\+?\s*(minute|hour|day|week|month)s?\s*ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = { minute: 60_000, hour: 3_600_000, day, week: 7 * day, month: 30 * day }[rel[2] as "day"];
    return new Date(now.getTime() - n * unit);
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function computeDedupeHash(company: string, title: string, location: string, description: string): string {
  return sha256(
    [normalizeCompanyName(company), normalizeTitle(title), normalizeText(location), normalizeText(description).slice(0, 5000)].join("|"),
  );
}

export function normalizeJob(raw: RawJob, companyName: string): NormalizedJob {
  const description = (raw.descriptionText?.trim() || (raw.descriptionHtml ? htmlToText(raw.descriptionHtml) : "")).slice(0, MAX_DESCRIPTION_CHARS);
  const title = raw.title.replace(/\s+/g, " ").trim();
  const locations = raw.locations.map((l) => l.trim()).filter(Boolean);
  const locationRaw = [...new Set(locations)].join("; ");
  const salaryText =
    raw.salaryText ??
    (raw.salaryMin || raw.salaryMax
      ? `${raw.salaryCurrency ?? ""} ${raw.salaryMin ?? ""}${raw.salaryMax ? ` – ${raw.salaryMax}` : ""}`.trim()
      : null);
  return {
    sourceJobId: raw.sourceJobId,
    title,
    normalizedTitle: normalizeTitle(title),
    canonicalUrl: canonicalizeUrl(raw.url),
    url: raw.url,
    description,
    locationRaw,
    employmentType: inferEmploymentType(raw.employmentTypeRaw, title, description),
    workMode: inferWorkMode(raw.workModeRaw, raw.isRemote, locations, description),
    seniority: inferSeniority(title, raw.experienceLevelRaw),
    requiredYears: extractRequiredYears(description),
    department: raw.department ?? null,
    postedAt: raw.postedAt ?? null,
    salaryMin: raw.salaryMin ?? null,
    salaryMax: raw.salaryMax ?? null,
    salaryCurrency: raw.salaryCurrency ?? null,
    salaryText,
    contentHash: sha256(JSON.stringify([title, description, locationRaw, raw.employmentTypeRaw ?? "", raw.workModeRaw ?? "", salaryText ?? ""])),
    dedupeHash: computeDedupeHash(companyName, title, locationRaw, description),
    descriptionHash: sha256(normalizeText(`${title}\n${description}`)),
  };
}
