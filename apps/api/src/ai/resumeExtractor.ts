import { CandidateProfileData, type Seniority } from "@jobagent/shared";
import type { CandidateProfileData as CandidateProfileDataT } from "@jobagent/shared";
import { sha256 } from "../lib/hash";
import { seniorityFromYears } from "../domain/matching/scoring";
import { extractSkillsFromText, isSoftSkill, normalizeSkills } from "../domain/skills/taxonomy";
import { generateStructured, type LLMContext } from "./gateway";
import { PROMPT_VERSIONS, RESUME_PARSER_SYSTEM, resumeParserUser } from "./prompts";
import { LlmResumeProfile } from "./schemas";

export interface ResumeExtraction {
  profile: CandidateProfileDataT;
  promptVersion: string;
  method: "LLM" | "RULES";
  tokens: number;
  cost: number;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Sums non-overlapping dated role ranges ("Jan 2019 – Present", "03/2018 - 06/2021", "2016 - 2019"). */
export function estimateYearsFromDates(text: string, now = new Date()): number {
  const month = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  const point = `(?:${month}\\s*[',]?\\s*(\\d{4})|(\\d{1,2})\\/(\\d{4})|(\\d{4}))`;
  const re = new RegExp(`${point}\\s*(?:-|–|—|to|till|until)\\s*(?:(present|current|now|date|today)|${point})`, "gi");
  const toMonthIndex = (m: RegExpExecArray, off: number): number | null => {
    const [mon, y1, mm, y2, yOnly] = [m[off], m[off + 1], m[off + 2], m[off + 3], m[off + 4]];
    if (y1 && mon) return Number(y1) * 12 + (MONTHS[mon.toLowerCase()] ?? 0);
    if (mm && y2) return Number(y2) * 12 + Math.max(0, Math.min(11, Number(mm) - 1));
    if (yOnly) return Number(yOnly) * 12;
    return null;
  };
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(re)) {
    const start = toMonthIndex(m as RegExpExecArray, 1);
    const end = m[6] ? nowIdx : toMonthIndex(m as RegExpExecArray, 7);
    if (start === null || end === null || end < start) continue;
    if (start < 1970 * 12 || end > nowIdx + 1) continue;
    ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const r of ranges) {
    if (!cur || r[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [r[0], r[1]];
    } else cur[1] = Math.max(cur[1], r[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 12) * 10) / 10;
}

const TITLE_RE = /\b(engineer|developer|architect|manager|analyst|consultant|designer|scientist|lead|administrator|specialist|intern|programmer|director|devops|sre|tester|qa)\b/i;
const DEGREE_RE = /\b(b\.?\s?tech|m\.?\s?tech|b\.?e\.?|m\.?e\.?|b\.?sc|m\.?sc|bca|mca|mba|bachelor|master|ph\.?d|diploma|b\.?com|b\.?a\.?)\b/i;

/** Deterministic fallback parser used when no LLM is configured or the call fails. */
export function heuristicResumeParse(text: string): CandidateProfileDataT {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const name = /^[A-Za-z][A-Za-z.'-]*(\s[A-Za-z][A-Za-z.'-]*){1,3}$/.test(first) ? first : "";
  const skills = extractSkillsFromText(text);
  const explicitYears = [...text.matchAll(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years?|yrs?)\s*(?:of\s*)?(?:professional\s*|industry\s*|total\s*)?experience/gi)].map((m) => Number(m[1]));
  const datedYears = estimateYearsFromDates(text);
  const years = Math.min(45, Math.max(datedYears, ...explicitYears.filter((n) => n < 45), 0));
  const jobTitles = [...new Set(lines.filter((l) => l.length < 70 && l.split(/\s+/).length <= 8 && TITLE_RE.test(l) && !/[.:]$/.test(l)).map((l) => l.split(/\s[|@–-]\s|,\s| at /i)[0]!.trim()))].slice(0, 6);
  const education = lines
    .filter((l) => DEGREE_RE.test(l) && l.length < 160)
    .slice(0, 4)
    .map((l) => ({ degree: l.match(DEGREE_RE)?.[0] ?? "", field: "", institution: l, year: Number(l.match(/\b(19|20)\d{2}\b/)?.[0]) || null }));
  const summaryIdx = lines.findIndex((l) => /^(summary|profile|professional summary|objective|about me)\b/i.test(l));
  const summary = summaryIdx >= 0 ? lines.slice(summaryIdx + 1, summaryIdx + 4).join(" ").slice(0, 600) : "";
  const workModes = (["REMOTE", "HYBRID", "ONSITE"] as const).filter((m) => new RegExp(`\\bprefer(?:red|s)?\\b[^.\\n]{0,40}\\b${m === "ONSITE" ? "on-?site" : m.toLowerCase()}\\b`, "i").test(text));
  return CandidateProfileData.parse({
    name,
    summary,
    yearsOfExperience: years,
    education,
    skills,
    technicalSkills: skills.filter((s) => !isSoftSkill(s)),
    softSkills: skills.filter(isSoftSkill),
    jobTitles,
    certifications: lines.filter((l) => /\b(certified|certification|certificate)\b/i.test(l) && l.length < 120).slice(0, 8),
    preferredWorkMode: [...workModes],
    seniority: seniorityFromYears(years),
  });
}

/** Post-processing applied to every extracted profile: normalize skills, clamp values. */
export function finalizeProfile(p: CandidateProfileDataT, resumeText: string): CandidateProfileDataT {
  const textSkills = extractSkillsFromText(resumeText);
  const technical = normalizeSkills([...p.technicalSkills, ...textSkills.filter((s) => !isSoftSkill(s))]);
  const soft = normalizeSkills([...p.softSkills, ...textSkills.filter(isSoftSkill)]);
  const years = Math.max(0, Math.min(60, Math.round(p.yearsOfExperience * 10) / 10));
  return {
    ...p,
    yearsOfExperience: years,
    technicalSkills: technical,
    softSkills: soft,
    skills: normalizeSkills([...p.skills, ...technical, ...soft]),
    jobTitles: [...new Set(p.jobTitles.map((t) => t.trim()).filter(Boolean))].slice(0, 10),
    seniority: (p.seniority ?? seniorityFromYears(years)) as Seniority,
  };
}

export async function extractResumeProfile(resumeText: string, ctx: LLMContext): Promise<ResumeExtraction> {
  const llm = await generateStructured(
    {
      purpose: "resume_parse",
      promptVersion: PROMPT_VERSIONS.resumeParser,
      system: RESUME_PARSER_SYSTEM,
      user: resumeParserUser(resumeText),
      schema: LlmResumeProfile,
      schemaName: "candidate_profile",
      tier: "small",
      maxTokens: 8000,
    },
    ctx,
    sha256(resumeText),
  );
  if (llm) {
    const parsed = CandidateProfileData.safeParse(llm.data);
    if (parsed.success) {
      return { profile: finalizeProfile(parsed.data, resumeText), promptVersion: llm.promptVersion, method: "LLM", tokens: llm.tokens, cost: llm.cost };
    }
  }
  return { profile: finalizeProfile(heuristicResumeParse(resumeText), resumeText), promptVersion: "resume_rules_v1", method: "RULES", tokens: 0, cost: 0 };
}
