import type { ConnectorType } from "@jobagent/shared";
import { env } from "../config/env";
import { ConnectorUnavailableError, type JobSourceConnector } from "./types";

/**
 * Job portals (PRD §14). LinkedIn and Naukri prohibit scraping in their terms of service, so
 * these connectors never crawl pages. They only become available once an approved partner /
 * licensed-feed integration is configured; until then they report as unavailable.
 */
function portalConnector(type: ConnectorType, displayName: string, host: RegExp, credential: () => string | undefined): JobSourceConnector {
  return {
    type,
    displayName,
    detect(url) {
      if (!host.test(url.hostname)) return null;
      return { connectorType: type, identifier: type, sourceUrl: url.toString(), canonicalKey: `${type}:portal`, strategy: "Official partner API / licensed feed" };
    },
    async discoverJobs() {
      if (!credential()) {
        throw new ConnectorUnavailableError(`${displayName} requires an approved partner API integration; direct crawling is not permitted by its terms of service.`);
      }
      throw new ConnectorUnavailableError(`${displayName} partner feed adapter is not implemented for this deployment yet.`);
    },
    async fetchJobDetails() {
      return null;
    },
    supportsIncrementalSync: () => true,
    getLastModified: (job) => job.updatedAt ?? job.postedAt ?? null,
  };
}

export const linkedInConnector = portalConnector("LINKEDIN", "LinkedIn", /(^|\.)linkedin\.com$/i, () => env.LINKEDIN_PARTNER_API_KEY);
export const naukriConnector = portalConnector("NAUKRI", "Naukri", /(^|\.)naukri\.com$/i, () => env.NAUKRI_PARTNER_API_KEY);

export const PORTALS = [
  { connector: linkedInConnector, available: () => Boolean(env.LINKEDIN_PARTNER_API_KEY) },
  { connector: naukriConnector, available: () => Boolean(env.NAUKRI_PARTNER_API_KEY) },
];
