import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverUnderlyingBoard } from "../src/connectors/discovery";
import { eightfoldRefFromPage } from "../src/connectors/eightfold";
import { oracleRefFromPage } from "../src/connectors/oracle";
import { connectorFor, detectByUrl } from "../src/connectors/registry";
import { emptyState, type Fetcher } from "../src/connectors/types";
import type { SafeResponse } from "../src/crawl/httpClient";
import { normalizeJob } from "../src/domain/jobs/normalize";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (p: string) => readFileSync(path.join(dir, p), "utf8");

function fakeFetcher(routes: [RegExp, string][]): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetch(url) {
      calls.push(url);
      const hit = routes.find(([re]) => re.test(url));
      if (!hit) throw new Error(`unexpected fetch ${url}`);
      const res: SafeResponse = { status: 200, url, headers: new Headers(), body: hit[1], notModified: false };
      return res;
    },
  };
}

describe("Eightfold", () => {
  it("detects *.eightfold.ai URLs that carry ?domain=", () => {
    const ref = detectByUrl("https://nab.eightfold.ai/careers?domain=nab.com.au&start=0");
    expect(ref?.connectorType).toBe("EIGHTFOLD");
    expect(ref?.identifier).toBe("nab.eightfold.ai|nab.com.au");
  });

  it("finds the site domain from the page when the URL lacks it", () => {
    const ref = eightfoldRefFromPage(fixture("eightfold/nab-careers.html"), "https://nab.eightfold.ai/careers?start=0&pid=563980770286235&sort_by=hot");
    expect(ref?.canonicalKey).toBe("EIGHTFOLD:nab.eightfold.ai:nab.com.au");
  });

  it("crawls search + details; stores listing-only data beyond the detail budget", async () => {
    const ref = detectByUrl("https://nab.eightfold.ai/careers?domain=nab.com.au")!;
    const f = fakeFetcher([
      [/\/api\/pcsx\/search\?/, fixture("eightfold/search.json")],
      [/\/api\/pcsx\/position_details\?/, fixture("eightfold/details.json")],
    ]);
    const res = await connectorFor("EIGHTFOLD").discoverJobs(ref, f, { ...emptyState(), maxDetailFetches: 1 });
    expect(res.jobs).toHaveLength(2);
    expect(res.complete).toBe(true);
    const [full, listing] = res.jobs;
    expect(full!.partial).toBe(false);
    expect(listing!.partial).toBe(true);
    expect(listing!.title).toBeTruthy();
    const n = normalizeJob(full!, "NAB");
    expect(n.title).toBe("Director - Process Management");
    expect(n.locationRaw).toContain("Gurugram");
    expect(n.workMode).toBe("ONSITE");
    expect(n.description.length).toBeGreaterThan(100);
    expect(n.url).toBe("https://nab.eightfold.ai/careers/job/563980770771033");
  });
});

describe("Oracle Recruiting Cloud", () => {
  it("fingerprints a custom-domain Oracle career site", () => {
    const ref = oracleRefFromPage(fixture("oracle/amex-site.html"), "https://careers.americanexpress.com/en/sites/CX_1");
    expect(ref?.connectorType).toBe("ORACLE");
    expect(ref?.identifier).toBe("egug.fa.us2.oraclecloud.com|CX_1|https://careers.americanexpress.com/en/sites/CX_1");
  });

  it("detects direct oraclecloud.com candidate-experience URLs", () => {
    const ref = detectByUrl("https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions");
    expect(ref?.canonicalKey).toBe("ORACLE:egug.fa.us2.oraclecloud.com:cx_1");
  });

  it("crawls requisitions + details with public job URLs on the company's domain", async () => {
    const ref = oracleRefFromPage(fixture("oracle/amex-site.html"), "https://careers.americanexpress.com/en/sites/CX_1")!;
    const f = fakeFetcher([
      [/recruitingCEJobRequisitions\?/, fixture("oracle/requisitions.json")],
      [/recruitingCEJobRequisitionDetails\?/, fixture("oracle/detail.json")],
    ]);
    const res = await connectorFor("ORACLE").discoverJobs(ref, f, { ...emptyState(), knownJobIds: new Set(["26011297"]) });
    expect(res.jobs).toHaveLength(2);
    const full = res.jobs.find((j) => !j.partial)!;
    const n = normalizeJob(full, "American Express");
    expect(n.title).toBe("Customer Service Analyst");
    expect(n.url).toBe("https://careers.americanexpress.com/en/sites/CX_1/job/26011138");
    expect(n.locationRaw).toBe("Gurugram, HR, India");
    expect(n.workMode).toBe("HYBRID");
    expect(n.employmentType).toBe("FULL_TIME");
    expect(n.description).toContain("Customer Care");
    // Details are only fetched for unknown jobs.
    expect(f.calls.filter((c) => c.includes("Details")).length).toBe(1);
  });

  it("source discovery upgrades the career page to the Oracle connector", async () => {
    const found = await discoverUnderlyingBoard(fixture("oracle/amex-site.html"), "https://careers.americanexpress.com/en/sites/CX_1", "Amex", fakeFetcher([]));
    expect(found?.ref.connectorType).toBe("ORACLE");
  });
});
