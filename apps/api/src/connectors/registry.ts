import type { ConnectorType } from "@jobagent/shared";
import { ashbyConnector } from "./ashby";
import { eightfoldConnector } from "./eightfold";
import { genericConnector, icimsConnector, successFactorsConnector, taleoConnector } from "./generic";
import { greenhouseConnector } from "./greenhouse";
import { leverConnector } from "./lever";
import { oracleConnector } from "./oracle";
import { linkedInConnector, naukriConnector } from "./portals";
import { smartRecruitersConnector } from "./smartrecruiters";
import type { JobSourceConnector, SourceRef } from "./types";
import { workdayConnector } from "./workday";

/** Ordered: specialized API connectors first, generic HTML last (PRD §13). */
export const CONNECTORS: JobSourceConnector[] = [
  greenhouseConnector,
  leverConnector,
  ashbyConnector,
  smartRecruitersConnector,
  workdayConnector,
  eightfoldConnector,
  oracleConnector,
  icimsConnector,
  taleoConnector,
  successFactorsConnector,
  linkedInConnector,
  naukriConnector,
  genericConnector,
];

const byType = new Map(CONNECTORS.map((c) => [c.type, c]));

export function connectorFor(type: ConnectorType): JobSourceConnector {
  const c = byType.get(type);
  if (!c) throw new Error(`No connector for ${type}`);
  return c;
}

/** Pure URL-based detection. */
export function detectByUrl(rawUrl: string): SourceRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const c of CONNECTORS) {
    const ref = c.detect(url);
    if (ref) return ref;
  }
  return null;
}

export function refFromStored(row: { connector_type: string; source_identifier: string | null; source_url: string; canonical_key: string }): SourceRef {
  return {
    connectorType: row.connector_type as ConnectorType,
    identifier: row.source_identifier ?? row.source_url,
    sourceUrl: row.source_url,
    canonicalKey: row.canonical_key,
    strategy: "",
  };
}
