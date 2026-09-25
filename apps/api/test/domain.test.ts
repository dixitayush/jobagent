import { describe, expect, it } from "vitest";
import { classifyFreshness } from "../src/domain/jobs/freshness";
import {
  canonicalizeUrl,
  computeDedupeHash,
  extractRequiredYears,
  htmlToText,
  inferEmploymentType,
  inferSeniority,
  inferWorkMode,
  normalizeTitle,
  parsePostedDate,
} from "../src/domain/jobs/normalize";
import { buildLocationIndex, matchLocations, resolveLocationText } from "../src/domain/locations/resolver";
import { flattenLocationSeed } from "../src/domain/locations/seedRows";
import { computeSkillAffinity, personalizationBoost } from "../src/domain/matching/personalization";
import {
  evaluateExperience,
  evaluateSkills,
  evaluateTitle,
  hardFilter,
  levelFor,
  rankScore,
  scoreJob,
  type CandidateForMatch,
  type JobForMatch,
  type PrefsForMatch,
} from "../src/domain/matching/scoring";
import { extractSkillsFromText, normalizeSkill, normalizeSkills, skillAncestors } from "../src/domain/skills/taxonomy";

const rows = flattenLocationSeed();
const idx = buildLocationIndex(rows);
const idOf = (name: string, type?: string) => rows.find((r) => r.name === name && (!type || r.type === type))!.id;

describe("skill normalization (PRD §26)", () => {
  it("maps synonyms to canonical skills", () => {
    expect(normalizeSkill("Java SE")).toBe("Java");
    expect(normalizeSkill("spring framework")).toBe("Spring");
    expect(normalizeSkill("Spring Boot Framework")).toBe("Spring Boot");
    expect(normalizeSkill("Postgres")).toBe("PostgreSQL");
    expect(normalizeSkill("JS")).toBe("JavaScript");
    expect(normalizeSkill("K8s")).toBe("Kubernetes");
    expect(normalizeSkill("AWS EC2")).toBe("Amazon EC2");
    expect(normalizeSkill("Some Niche Tool")).toBe("Some Niche Tool");
  });

  it("dedupes after normalization", () => {
    expect(normalizeSkills(["k8s", "Kubernetes", "kube"])).toEqual(["Kubernetes"]);
  });

  it("extracts skills from free text including symbols", () => {
    const skills = extractSkillsFromText(
      "We need Java 17, Spring Boot, microservices on AWS with Kafka. C++ and C# a plus. Node.js, React.js, CI/CD, PostgreSQL.",
    );
    for (const s of ["Java", "Spring Boot", "Microservices", "AWS", "Kafka", "C++", "C#", "Node.js", "React", "CI/CD", "PostgreSQL"]) {
      expect(skills).toContain(s);
    }
  });

  it("does not extract ambiguous short tokens from prose", () => {
    const skills = extractSkillsFromText("Let's go to the office. R&D team in C block.");
    expect(skills).not.toContain("Go");
    expect(skills).not.toContain("R");
    expect(skills).not.toContain("C");
  });

  it("knows skill ancestry", () => {
    expect(skillAncestors("Spring Boot")).toEqual(["Spring", "Java"]);
  });
});

describe("job normalization", () => {
  it("normalizes titles", () => {
    expect(normalizeTitle("Sr. Software Eng - Backend (Remote)")).toBe("senior software engineer backend");
    expect(normalizeTitle("SDE II")).toBe("software development engineer 2");
  });

  it("canonicalizes URLs by stripping tracking params", () => {
    expect(canonicalizeUrl("https://Boards.Greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=li#apply")).toBe(
      "https://boards.greenhouse.io/acme/jobs/123",
    );
  });

  it("strips scripts from HTML and decodes entity-encoded HTML", () => {
    expect(htmlToText("<p>Hello</p><script>alert(1)</script><ul><li>Java</li></ul>")).toBe("Hello\n• Java");
    expect(htmlToText("&lt;p&gt;Encoded &amp;amp; ok&lt;/p&gt;")).toContain("Encoded");
  });

  it("extracts required years", () => {
    expect(extractRequiredYears("4+ years of experience with Java")).toBe(4);
    expect(extractRequiredYears("3-5 years experience")).toBe(3);
    expect(extractRequiredYears("At least five years of backend development")).toBe(5);
    expect(extractRequiredYears("Minimum of 2 yrs")).toBe(2);
    expect(extractRequiredYears("Great benefits")).toBeNull();
  });

  it("infers employment type, work mode and seniority", () => {
    expect(inferEmploymentType("Full-time", "Engineer", "")).toBe("FULL_TIME");
    expect(inferEmploymentType(null, "Software Engineering Intern", "")).toBe("INTERNSHIP");
    expect(inferEmploymentType("Contractor", "Engineer", "")).toBe("CONTRACT");
    expect(inferWorkMode(null, false, ["Bengaluru (Hybrid)"], "")).toBe("HYBRID");
    expect(inferWorkMode(null, true, ["India"], "")).toBe("REMOTE");
    expect(inferSeniority("Senior Java Developer")).toBe("SENIOR");
    expect(inferSeniority("Staff Engineer")).toBe("LEAD");
    expect(inferSeniority("Software Engineer")).toBeNull();
  });

  it("parses relative posted dates (Workday style)", () => {
    const now = new Date("2026-09-25T10:00:00Z");
    expect(parsePostedDate("Posted Today", now)?.toISOString()).toBe(now.toISOString());
    expect(parsePostedDate("Posted Yesterday", now)?.toISOString()).toBe("2026-09-24T10:00:00.000Z");
    expect(parsePostedDate("Posted 3 Days Ago", now)?.toISOString()).toBe("2026-09-22T10:00:00.000Z");
    expect(parsePostedDate("Posted 30+ Days Ago", now)?.toISOString()).toBe("2026-08-26T10:00:00.000Z");
    expect(parsePostedDate(1758794400000)?.toISOString()).toBe("2025-09-25T10:00:00.000Z");
    expect(parsePostedDate("2026-09-20T00:00:00Z")?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(parsePostedDate("garbage")).toBeNull();
  });
});

describe("deduplication (PRD §18)", () => {
  it("produces equal hashes for cosmetically different copies of the same job", () => {
    const a = computeDedupeHash("Google LLC", "Sr. Java Developer", "Bengaluru, India", "Build   APIs with Java.");
    const b = computeDedupeHash("google", "Senior Java Developer", "bengaluru india", "build apis with java");
    expect(a).toBe(b);
  });
  it("differs for different jobs", () => {
    expect(computeDedupeHash("Google", "Java Developer", "Pune", "x")).not.toBe(computeDedupeHash("Google", "Java Developer", "Noida", "x"));
  });
});

describe("freshness (PRD §19)", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  const base = { status: "OPEN" as const, postedAt: null, contentUpdatedAt: null, lastSeenAt: now };
  it("classifies NEW / RECENT / EXISTING / CLOSED", () => {
    expect(classifyFreshness({ ...base, firstSeenAt: new Date("2026-09-25T01:00:00Z") }, now)).toBe("NEW");
    expect(classifyFreshness({ ...base, firstSeenAt: new Date("2026-09-21T01:00:00Z") }, now)).toBe("RECENT");
    expect(classifyFreshness({ ...base, firstSeenAt: new Date("2026-09-01T01:00:00Z") }, now)).toBe("EXISTING");
    expect(classifyFreshness({ ...base, status: "CLOSED", firstSeenAt: now }, now)).toBe("CLOSED");
  });
  it("a stale repost first seen today is not NEW", () => {
    expect(classifyFreshness({ ...base, firstSeenAt: now, postedAt: new Date("2026-08-01T00:00:00Z") }, now)).toBe("EXISTING");
  });
  it("detects UPDATED jobs", () => {
    expect(
      classifyFreshness({ ...base, firstSeenAt: new Date("2026-09-01T00:00:00Z"), contentUpdatedAt: new Date("2026-09-25T08:00:00Z") }, now),
    ).toBe("UPDATED");
  });
});

describe("location resolution & matching (PRD §11)", () => {
  it("resolves aliases and hierarchy", () => {
    const [loc] = resolveLocationText("Bangalore, Karnataka, India", idx);
    expect(loc?.cityId).toBe(idOf("Bengaluru"));
    expect(loc?.stateId).toBe(idOf("Karnataka"));
    expect(loc?.countryId).toBe(idOf("India"));
  });
  it("splits multiple locations and detects remote", () => {
    const locs = resolveLocationText("Gurgaon; Remote - India", idx);
    expect(locs.some((l) => l.cityId === idOf("Gurugram"))).toBe(true);
    expect(locs.some((l) => l.isRemote && l.countryId === idOf("India"))).toBe(true);
  });
  it("does not double-match Greater Noida as Noida", () => {
    const locs = resolveLocationText("Greater Noida, Uttar Pradesh", idx);
    expect(locs).toHaveLength(1);
    expect(locs[0]?.cityId).toBe(idOf("Greater Noida"));
  });
  it("disambiguates US state codes", () => {
    const [loc] = resolveLocationText("Austin, TX", idx);
    expect(loc?.cityId).toBe(idOf("Austin"));
  });
  it("matches selected cities, states and countries", () => {
    const blr = resolveLocationText("Bengaluru", idx);
    expect(matchLocations(blr, [idOf("Bengaluru")], idx).match).toBe(true);
    expect(matchLocations(blr, [idOf("Karnataka")], idx).match).toBe(true);
    expect(matchLocations(blr, [idOf("India", "COUNTRY")], idx).match).toBe(true);
    expect(matchLocations(blr, [idOf("Pune")], idx).match).toBe(false);
  });
  it("matches remote roles against remote preferences", () => {
    const remoteIndia = resolveLocationText("Remote - India", idx);
    expect(matchLocations(remoteIndia, [idOf("Remote - India")], idx).match).toBe(true);
    expect(matchLocations(remoteIndia, [idOf("Remote - Worldwide")], idx).match).toBe(true);
    expect(matchLocations(remoteIndia, [idOf("Remote - United States")], idx).match).toBe(false);
    expect(matchLocations(remoteIndia, [idOf("Noida")], idx).match).toBe(false);
  });
  it("treats unknown job locations as not filterable", () => {
    expect(matchLocations([], [idOf("Noida")], idx).match).toBeNull();
    expect(matchLocations(resolveLocationText("Somewhere Unknown", idx), [idOf("Noida")], idx).match).toBeNull();
  });
});

const candidate: CandidateForMatch = {
  profileVersion: 1,
  skills: ["Java", "Spring Boot", "Microservices", "AWS", "PostgreSQL", "REST APIs", "Docker"],
  yearsOfExperience: 5,
  seniority: "SENIOR",
  jobTitles: ["Senior Software Engineer"],
};
const prefs: PrefsForMatch = {
  jobTitles: ["Java Developer", "Backend Engineer"],
  locationIds: [idOf("Bengaluru")],
  preferredCompanies: ["Google"],
  blockedCompanies: ["Evil Corp"],
  minExperience: null,
  maxExperience: null,
  workModes: [],
  employmentTypes: ["FULL_TIME"],
};
const job: JobForMatch = {
  id: "j1",
  title: "Senior Java Developer",
  company: "Google",
  requiredSkills: ["Java", "Spring Boot", "Microservices", "AWS"],
  preferredSkills: ["Kafka"],
  requiredYears: 4,
  seniority: "SENIOR",
  workMode: "HYBRID",
  employmentType: "FULL_TIME",
  freshness: "NEW",
};
const locOk = { match: true, score: 1, reason: "Bengaluru is in your preferred locations" };

describe("matching score (PRD §23–24)", () => {
  it("scores skills with required/preferred distinction", () => {
    const s = evaluateSkills(candidate.skills, job.requiredSkills, job.preferredSkills);
    expect(s.matched).toEqual(["Java", "Spring Boot", "Microservices", "AWS"]);
    expect(s.preferredMissing).toEqual(["Kafka"]);
    expect(s.score).toBeCloseTo(4 / 4.5, 5);
  });

  it("credits inferred skills partially", () => {
    const s = evaluateSkills(["Spring Boot"], ["Java"], []);
    expect(s.inferred).toEqual(["Java"]);
    expect(s.score).toBeCloseTo(0.6, 5);
  });

  it("scores experience gaps", () => {
    expect(evaluateExperience(5, 4).score).toBe(1);
    expect(evaluateExperience(3, 4).score).toBe(0.75);
    expect(evaluateExperience(1, 6).score).toBe(0);
    expect(evaluateExperience(5, null).match).toBeNull();
  });

  it("matches titles with synonyms", () => {
    expect(evaluateTitle("Senior Java Developer", ["Java Developer"])).toBeGreaterThan(0.9);
    expect(evaluateTitle("Java Software Engineer", ["Java Developer"])).toBeGreaterThan(0.6);
    expect(evaluateTitle("Marketing Manager", ["Java Developer"])).toBe(0);
  });

  it("produces a very strong match for an aligned job", () => {
    const out = scoreJob({ job, candidate, prefs, location: locOk, similarity: 0.7 });
    expect(out.score).toBeGreaterThanOrEqual(90);
    expect(out.level).toBe("VERY_STRONG");
    const total = Object.values(out.breakdown).reduce((a, b) => a + b, 0);
    expect(Math.round(total)).toBe(out.score);
  });

  it("produces a low match for an unrelated job", () => {
    const out = scoreJob({
      job: { ...job, title: "Marketing Manager", requiredSkills: ["Salesforce", "Product Management"], preferredSkills: [], requiredYears: 8, seniority: "LEAD" },
      candidate,
      prefs,
      location: locOk,
      similarity: 0.1,
    });
    expect(out.level).toBe("LOW");
  });

  it("maps scores to levels with configurable thresholds", () => {
    expect(levelFor(95)).toBe("VERY_STRONG");
    expect(levelFor(85)).toBe("STRONG");
    expect(levelFor(72)).toBe("GOOD");
    expect(levelFor(60)).toBe("PARTIAL");
    expect(levelFor(20)).toBe("LOW");
    expect(levelFor(85, { veryStrong: 85, strong: 75, good: 65, partial: 50 })).toBe("VERY_STRONG");
  });

  it("ranks by score with freshness and preferred company nudges", () => {
    expect(rankScore(80, "NEW", true)).toBe(85);
    expect(rankScore(80, "EXISTING", false)).toBe(80);
    expect(rankScore(81, "EXISTING", false)).toBeGreaterThan(rankScore(80, "RECENT", false));
  });
});

describe("hard filters (PRD §22 step 4)", () => {
  it("passes an aligned job", () => expect(hardFilter(job, candidate, prefs, locOk).pass).toBe(true));
  it("rejects blocked companies", () => expect(hardFilter({ ...job, company: "Evil Corp" }, candidate, prefs, locOk).reason).toBe("BLOCKED_COMPANY"));
  it("rejects location mismatch", () =>
    expect(hardFilter(job, candidate, prefs, { match: false, score: 0, reason: "" }).reason).toBe("LOCATION"));
  it("rejects wrong employment type", () => expect(hardFilter({ ...job, employmentType: "CONTRACT" }, candidate, prefs, locOk).reason).toBe("EMPLOYMENT_TYPE"));
  it("rejects large experience gaps", () => expect(hardFilter({ ...job, requiredYears: 10 }, candidate, prefs, locOk).reason).toBe("EXPERIENCE"));
  it("rejects work mode mismatch when preference set", () =>
    expect(hardFilter({ ...job, workMode: "ONSITE" }, candidate, { ...prefs, workModes: ["REMOTE"] }, locOk).reason).toBe("WORK_MODE"));
});

describe("personalization (PRD §31–32)", () => {
  it("ignores small numbers of signals", () => {
    const aff = computeSkillAffinity([{ type: "JOB_SAVED", skills: ["Java"] }]);
    expect(personalizationBoost(["Java"], aff)).toBe(0);
  });
  it("boosts after aggregated signals, bounded", () => {
    const aff = computeSkillAffinity(Array.from({ length: 12 }, () => ({ type: "JOB_SAVED", skills: ["Java", "Spring Boot", "AWS"] })));
    const boost = personalizationBoost(["Java", "Spring Boot", "AWS"], aff);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(3);
  });
});
