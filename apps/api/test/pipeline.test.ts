import { describe, expect, it } from "vitest";
import { estimateYearsFromDates, finalizeProfile, heuristicResumeParse } from "../src/ai/resumeExtractor";
import { LocalHashEmbedder } from "../src/ai/embeddings";
import { estimateCost } from "../src/ai/gateway";
import { dueWindows, nextWindow } from "../src/domain/schedule";
import { relativeTime, renderDigest } from "../src/email/digestTemplate";
import { failureBackoffMs } from "../src/services/crawlService";
import { detectKind } from "../src/services/resumeService";

const RESUME = `Ayush Sharma
Senior Software Engineer

Summary
Backend engineer building Java and Spring Boot microservices on AWS.

Experience
Senior Software Engineer | Acme Corp
Jan 2022 – Present
Built REST APIs with Spring Boot, PostgreSQL and Kafka. Deployed with Docker and Kubernetes (k8s).

Software Engineer, Globex
Jun 2019 - Dec 2021
Node.js, TypeScript, React.

Education
B.Tech in Computer Science, IIT Delhi, 2019
Strong communication and leadership.`;

describe("resume parsing fallback (no LLM)", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  it("sums non-overlapping dated roles", () => {
    expect(estimateYearsFromDates("Jan 2022 – Present\nJun 2019 - Dec 2021", now)).toBeCloseTo(7.1, 0);
    expect(estimateYearsFromDates("2015 - 2018\n2016 - 2017", now)).toBe(3);
  });
  it("extracts a normalized profile", () => {
    const p = finalizeProfile(heuristicResumeParse(RESUME), RESUME);
    expect(p.name).toBe("Ayush Sharma");
    expect(p.yearsOfExperience).toBeGreaterThan(6);
    expect(p.technicalSkills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Microservices", "AWS", "PostgreSQL", "Kafka", "Docker", "Kubernetes", "Node.js", "TypeScript", "React", "REST APIs"]));
    expect(p.softSkills).toEqual(expect.arrayContaining(["Communication", "Leadership"]));
    expect(p.jobTitles[0]).toBe("Senior Software Engineer");
    expect(p.education[0]?.year).toBe(2019);
    expect(["SENIOR", "LEAD"]).toContain(p.seniority);
  });
  it("detects file types by magic bytes, not extension", () => {
    expect(detectKind(Buffer.from("%PDF-1.7 ..."), "application/pdf", "cv.pdf")).toBe("pdf");
    expect(detectKind(Buffer.from([0x50, 0x4b, 3, 4]), "application/octet-stream", "cv.docx")).toBe("docx");
    expect(detectKind(Buffer.from("plain text resume"), "text/plain", "cv.txt")).toBe("txt");
    expect(detectKind(Buffer.from([0x4d, 0x5a, 0, 0]), "application/pdf", "cv.pdf")).toBeNull();
  });
});

describe("local embeddings", () => {
  it("are unit length and place synonyms close together", async () => {
    const e = new LocalHashEmbedder();
    const [a, b, c] = await e.embed(["Kubernetes k8s Docker DevOps engineer", "K8s and Docker for a devops role", "Pastry chef baking croissants"]);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(dot(a!, a!)).toBeCloseTo(1, 5);
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!) + 0.2);
  });
});

describe("digest scheduling (PRD §33)", () => {
  const sched = { timezone: "Asia/Kolkata", morningEnabled: true, morningTime: "10:00", eveningEnabled: true, eveningTime: "21:00" };
  it("fires at 10:00 IST (04:30 UTC) within the grace period", () => {
    expect(dueWindows(sched, new Date("2026-09-25T04:31:00Z")).map((w) => w.window)).toEqual(["2026-09-25:morning"]);
    expect(dueWindows(sched, new Date("2026-09-25T04:29:00Z"))).toEqual([]);
    expect(dueWindows(sched, new Date("2026-09-25T07:00:00Z"))).toEqual([]);
  });
  it("respects the user's timezone and disabled windows", () => {
    const ny = { ...sched, timezone: "America/New_York", morningEnabled: false };
    expect(dueWindows(ny, new Date("2026-09-26T01:05:00Z")).map((w) => w.window)).toEqual(["2026-09-25:evening"]);
    expect(dueWindows(ny, new Date("2026-09-25T14:05:00Z"))).toEqual([]);
  });
  it("computes the next digest", () => {
    expect(nextWindow(sched, new Date("2026-09-25T05:00:00Z"))?.window).toBe("2026-09-25:evening");
    expect(nextWindow(sched, new Date("2026-09-25T16:00:00Z"))?.window).toBe("2026-09-26:morning");
    expect(nextWindow({ ...sched, morningEnabled: false, eveningEnabled: false })).toBeNull();
  });
});

describe("crawl failure backoff (PRD §46)", () => {
  it("follows 1m → 5m → 30m → exponential", () => {
    expect(failureBackoffMs(1)).toBe(60_000);
    expect(failureBackoffMs(2)).toBe(300_000);
    expect(failureBackoffMs(3)).toBe(1_800_000);
    expect(failureBackoffMs(4)).toBe(3_600_000);
    expect(failureBackoffMs(20)).toBe(24 * 3_600_000);
  });
});

describe("LLM cost estimation", () => {
  it("uses per-model pricing", () => {
    expect(estimateCost("claude-opus-5", 1_000_000, 100_000)).toBeCloseTo(7.5);
    expect(estimateCost("claude-haiku-4-5", 1000, 1000)).toBeCloseTo(0.006);
    expect(estimateCost("gpt-6-sol", 1_000_000, 100_000)).toBeCloseTo(3);
    expect(estimateCost("gpt-6-luna-2026-09-01", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(estimateCost("unknown-model", 1000, 1000)).toBe(0);
  });
});

describe("digest email (PRD §37–38)", () => {
  it("renders match level, score, reasons, gaps and escaped content", () => {
    const now = new Date("2026-09-25T10:00:00Z");
    const out = renderDigest({
      name: "Ayush",
      generatedAt: now,
      timezone: "Asia/Kolkata",
      viewAllUrl: "https://app/jobs",
      settingsUrl: "https://app/notifications",
      openPixelUrl: null,
      jobs: [
        {
          title: "Senior Java Developer <script>",
          company: "Google",
          location: "Bengaluru",
          employmentType: "FULL_TIME",
          workMode: "HYBRID",
          postedAt: new Date("2026-09-25T02:00:00Z"),
          firstSeenAt: new Date("2026-09-25T03:00:00Z"),
          score: 94,
          matchLevel: "VERY_STRONG",
          trackedUrl: "https://api/t/c/x",
          result: {
            jobId: "j",
            score: 94,
            matchLevel: "VERY_STRONG",
            confidence: 0.9,
            skills: { matched: ["Java", "Spring Boot"], missing: [], preferredMissing: ["Kubernetes"], inferred: [] },
            experience: { requiredYears: 4, candidateYears: 5, match: true },
            location: { match: true, reason: "Bengaluru is in your preferred locations" },
            workMode: { match: true },
            reasons: [],
            concerns: [],
            breakdown: { skills: 30, experience: 20, title: 15, semantic: 12, location: 10, seniority: 5, workMode: 5, personalization: 0 },
            aiSummary: null,
            evaluatedBy: "RULES_VECTOR",
          },
        },
      ],
    });
    expect(out.subject).toContain("Senior Java Developer");
    expect(out.html).toContain("Very Strong Match · 94%");
    expect(out.html).toContain("✓ Java");
    expect(out.html).toContain("△ Kubernetes (preferred)");
    expect(out.html).toContain("Posted 8 hours ago");
    expect(out.html).not.toContain("<script>");
    expect(out.text).toContain("VERY STRONG MATCH — 94%");
    expect(relativeTime(new Date("2026-09-23T10:00:00Z"), now)).toBe("2 days ago");
  });
});
