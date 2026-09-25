import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateSlugs, discoverUnderlyingBoard, pageEvidence } from "../src/connectors/discovery";
import { findEmbeddedAtsUrls } from "../src/connectors/generic";
import { detectByUrl } from "../src/connectors/registry";
import type { Fetcher } from "../src/connectors/types";
import type { SafeResponse } from "../src/crawl/httpClient";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "discovery");
const fixture = (p: string) => readFileSync(path.join(dir, p), "utf8");

function fakeFetcher(routes: Record<string, string>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetch(url) {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const res: SafeResponse = key
        ? { status: 200, url, headers: new Headers(), body: routes[key]!, notModified: false }
        : { status: 404, url, headers: new Headers(), body: "", notModified: false };
      if (!key) throw Object.assign(new Error("404"), { status: 404 });
      return res;
    },
  };
}

describe("ATS API URL detection", () => {
  it.each([
    ["https://api.greenhouse.io/v1/boards/mongodb/jobs?content=true", "GREENHOUSE", "mongodb"],
    ["https://boards-api.greenhouse.io/v1/boards/okta/jobs", "GREENHOUSE", "okta"],
    ["https://api.lever.co/v0/postings/globex?mode=json", "LEVER", "globex"],
    ["https://api.eu.lever.co/v0/postings/globex", "LEVER", "eu:globex"],
    ["https://api.ashbyhq.com/posting-api/job-board/initech", "ASHBY", "initech"],
    ["https://api.smartrecruiters.com/v1/companies/Umbrella1/postings", "SMARTRECRUITERS", "Umbrella1"],
  ])("%s → %s", (url, type, id) => {
    const ref = detectByUrl(url);
    expect(ref?.connectorType).toBe(type);
    expect(ref?.identifier).toBe(id);
  });

  it("finds a Greenhouse feed referenced inside escaped JSON (MongoDB style)", () => {
    const urls = findEmbeddedAtsUrls(fixture("mongodb-careers.html"));
    expect(urls).toContain("https://api.greenhouse.io/v1/boards/mongodb/jobs?content=true");
  });
});

describe("underlying board discovery", () => {
  it("MongoDB: uses the referenced feed without probing", async () => {
    const f = fakeFetcher({});
    const found = await discoverUnderlyingBoard(fixture("mongodb-careers.html"), "https://www.mongodb.com/company/careers/see-jobs", "MongoDB", f);
    expect(found?.method).toBe("embedded");
    expect(found?.ref.canonicalKey).toBe("GREENHOUSE:mongodb");
    expect(f.calls).toHaveLength(0);
  });

  it("extracts job ids and titles from a custom listing page", () => {
    const e = pageEvidence(fixture("okta-listing.html"), "https://www.okta.com/company/careers/job-listing/");
    expect([...e.jobIds].sort()).toEqual(["7572029", "7703326", "8041551", "8195169"]);
    expect(e.host).toBe("okta.com");
    expect(candidateSlugs("Okta", "https://www.okta.com/company/careers/job-listing/")).toContain("okta");
  });

  it("Okta: probes Greenhouse and accepts the board whose job ids match the page", async () => {
    const f = fakeFetcher({ "https://boards-api.greenhouse.io/v1/boards/okta/jobs": fixture("okta-greenhouse.json") });
    const found = await discoverUnderlyingBoard(fixture("okta-listing.html"), "https://www.okta.com/company/careers/job-listing/", "okta", f);
    expect(found?.method).toBe("probe");
    expect(found?.ref.canonicalKey).toBe("GREENHOUSE:okta");
  });

  it("rejects a same-named board that doesn't belong to the page's company", async () => {
    const f = fakeFetcher({ "https://boards-api.greenhouse.io/v1/boards/okta/jobs": fixture("other-okta-greenhouse.json") });
    const found = await discoverUnderlyingBoard(fixture("okta-listing.html"), "https://www.okta.com/company/careers/job-listing/", "okta", f);
    expect(found).toBeNull();
  });
});
