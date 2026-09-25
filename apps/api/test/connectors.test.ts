import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractRequirementsByRules } from "../src/ai/jobUnderstanding";
import { findEmbeddedAtsUrls } from "../src/connectors/generic";
import { connectorFor, detectByUrl } from "../src/connectors/registry";
import { ConnectorUnavailableError, emptyState, type Fetcher } from "../src/connectors/types";
import type { SafeResponse } from "../src/crawl/httpClient";
import { normalizeJob } from "../src/domain/jobs/normalize";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (p: string) => readFileSync(path.join(dir, p), "utf8");

/** Fixture-based fetcher (PRD §101): a source changing its format fails these tests. */
function fakeFetcher(routes: Record<string, string>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetch(url) {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      const res: SafeResponse = { status: 200, url, headers: new Headers({ etag: '"v1"' }), body: routes[key]!, notModified: false };
      return res;
    },
  };
}

describe("source detection (PRD §13)", () => {
  it.each([
    ["https://boards.greenhouse.io/acme", "GREENHOUSE", "acme"],
    ["https://job-boards.greenhouse.io/acme/jobs/123", "GREENHOUSE", "acme"],
    ["https://boards.greenhouse.io/embed/job_board?for=acme", "GREENHOUSE", "acme"],
    ["https://jobs.lever.co/globex", "LEVER", "globex"],
    ["https://jobs.eu.lever.co/globex", "LEVER", "eu:globex"],
    ["https://jobs.ashbyhq.com/initech", "ASHBY", "initech"],
    ["https://careers.smartrecruiters.com/Umbrella1", "SMARTRECRUITERS", "Umbrella1"],
    ["https://initech.wd5.myworkdayjobs.com/en-US/External", "WORKDAY", "initech.wd5.myworkdayjobs.com|initech|External"],
    ["https://acme.icims.com/jobs/search", "ICIMS", null],
    ["https://acme.taleo.net/careersection/2/jobsearch.ftl", "TALEO", null],
    ["https://jobs.sap.com/search", "SUCCESSFACTORS", null],
    ["https://www.linkedin.com/company/acme/jobs", "LINKEDIN", "LINKEDIN"],
    ["https://www.naukri.com/acme-jobs", "NAUKRI", "NAUKRI"],
    ["https://careers.example.com/openings", "GENERIC", null],
  ])("%s → %s", (url, type, identifier) => {
    const ref = detectByUrl(url);
    expect(ref?.connectorType).toBe(type);
    if (identifier) expect(ref?.identifier).toBe(identifier);
  });

  it("shares one canonical key across URL variants", () => {
    expect(detectByUrl("https://boards.greenhouse.io/Acme")?.canonicalKey).toBe(detectByUrl("https://job-boards.greenhouse.io/acme/jobs/9")?.canonicalKey);
  });

  it("finds ATS boards embedded in custom career pages", () => {
    expect(findEmbeddedAtsUrls(fixture("generic/careers.html"))).toContain("https://boards.greenhouse.io/embed/job_board?for=umbrella");
  });
});

describe("connector fixtures", () => {
  it("Greenhouse", async () => {
    const ref = detectByUrl("https://boards.greenhouse.io/acme")!;
    const res = await connectorFor("GREENHOUSE").discoverJobs(ref, fakeFetcher({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs": fixture("greenhouse/jobs.json") }), emptyState());
    expect(res.jobs).toHaveLength(2);
    expect(res.etag).toBe('"v1"');
    const n = normalizeJob(res.jobs[0]!, "Acme");
    expect(n.title).toBe("Senior Backend Engineer (Java)");
    expect(n.canonicalUrl).toBe("https://boards.greenhouse.io/acme/jobs/4012345");
    expect(n.requiredYears).toBe(5);
    expect(n.description).toContain("Spring Boot");
    const reqs = extractRequirementsByRules(n.title, n.description, n.requiredYears);
    expect(reqs.requiredSkills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Microservices", "AWS"]));
    expect(reqs.preferredSkills).toEqual(["Kafka"]);
  });

  it("skips reprocessing when content hash is unchanged (PRD §83)", async () => {
    const ref = detectByUrl("https://boards.greenhouse.io/acme")!;
    const routes = { "https://boards-api.greenhouse.io/v1/boards/acme/jobs": fixture("greenhouse/jobs.json") };
    const first = await connectorFor("GREENHOUSE").discoverJobs(ref, fakeFetcher(routes), emptyState());
    const second = await connectorFor("GREENHOUSE").discoverJobs(ref, fakeFetcher(routes), { ...emptyState(), contentHash: first.contentHash });
    expect(second.notModified).toBe(true);
    expect(second.jobs).toHaveLength(0);
  });

  it("Lever", async () => {
    const ref = detectByUrl("https://jobs.lever.co/globex")!;
    const res = await connectorFor("LEVER").discoverJobs(ref, fakeFetcher({ "https://api.lever.co/v0/postings/globex": fixture("lever/postings.json") }), emptyState());
    const n = normalizeJob(res.jobs[0]!, "Globex");
    expect(n.workMode).toBe("HYBRID");
    expect(n.employmentType).toBe("FULL_TIME");
    expect(n.locationRaw).toBe("Pune; Remote - India");
    expect(n.salaryText).toContain("INR");
    expect(n.requiredYears).toBe(3);
  });

  it("Ashby filters unlisted jobs", async () => {
    const ref = detectByUrl("https://jobs.ashbyhq.com/initech")!;
    const res = await connectorFor("ASHBY").discoverJobs(ref, fakeFetcher({ "https://api.ashbyhq.com/posting-api/job-board/initech": fixture("ashby/board.json") }), emptyState());
    expect(res.jobs).toHaveLength(1);
    const n = normalizeJob(res.jobs[0]!, "Initech");
    expect(n.locationRaw).toBe("Hyderabad; Bengaluru");
    expect(n.employmentType).toBe("FULL_TIME");
    expect(n.salaryText).toBe("₹30L – ₹45L");
  });

  it("Workday fetches details only for unknown jobs", async () => {
    const ref = detectByUrl("https://initech.wd5.myworkdayjobs.com/en-US/External")!;
    const f = fakeFetcher({
      "https://initech.wd5.myworkdayjobs.com/wday/cxs/initech/External/jobs": fixture("workday/list.json"),
      "https://initech.wd5.myworkdayjobs.com/wday/cxs/initech/External/job/": fixture("workday/detail.json"),
    });
    const res = await connectorFor("WORKDAY").discoverJobs(ref, f, { ...emptyState(), knownJobIds: new Set(["Data-Analyst_R-1002"]) });
    expect(res.jobs).toHaveLength(2);
    const full = res.jobs.find((j) => !j.partial)!;
    expect(full.title).toBe("Software Engineer II");
    expect(full.descriptionHtml).toContain("Spring Boot");
    expect(res.jobs.find((j) => j.partial)?.sourceJobId).toBe("Data-Analyst_R-1002");
    expect(f.calls.filter((c) => c.includes("/job/"))).toHaveLength(1);
  });

  it("SmartRecruiters", async () => {
    const ref = detectByUrl("https://careers.smartrecruiters.com/Umbrella1")!;
    const f = fakeFetcher({
      "https://api.smartrecruiters.com/v1/companies/Umbrella1/postings?": fixture("smartrecruiters/list.json"),
      "https://api.smartrecruiters.com/v1/companies/Umbrella1/postings/744000012345": fixture("smartrecruiters/detail.json"),
    });
    const res = await connectorFor("SMARTRECRUITERS").discoverJobs(ref, f, emptyState());
    const n = normalizeJob(res.jobs[0]!, "Umbrella");
    expect(n.description).toContain("Selenium");
    expect(n.requiredYears).toBe(4);
    expect(n.url).toBe("https://jobs.smartrecruiters.com/Umbrella1/744000012345");
  });

  it("Generic JSON-LD crawling (no JavaScript execution)", async () => {
    const ref = detectByUrl("https://careers.umbrella.example/careers")!;
    const f = fakeFetcher({
      "https://careers.umbrella.example/careers": fixture("generic/careers.html"),
      "https://careers.umbrella.example/jobs/sre-lead": fixture("generic/job-sre.html"),
    });
    const res = await connectorFor("GENERIC").discoverJobs(ref, f, emptyState());
    const titles = res.jobs.map((j) => j.title).sort();
    expect(titles).toEqual(["DevOps Engineer", "SRE Lead"]);
    const devops = res.jobs.find((j) => j.title === "DevOps Engineer")!;
    expect(devops.sourceJobId).toBe("UMB-77");
    expect(devops.locations).toEqual(["Mumbai, MH, IN"]);
    const sre = normalizeJob(res.jobs.find((j) => j.title === "SRE Lead")!, "Umbrella");
    expect(sre.workMode).toBe("REMOTE");
    expect(sre.locationRaw).toBe("Remote - India");
  });

  it("portals refuse to crawl without an approved partner integration (PRD §14)", async () => {
    const ref = detectByUrl("https://www.linkedin.com/company/acme/jobs")!;
    await expect(connectorFor("LINKEDIN").discoverJobs(ref, fakeFetcher({}), emptyState())).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });
});
