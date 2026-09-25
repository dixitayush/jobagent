import type { FeatureFlag } from "@jobagent/shared";
import { query } from "../db/pool";
import { cached, invalidate } from "../lib/redis";

/** PRD §74. */
export const FLAG_DEFAULTS: FeatureFlag[] = [
  { key: "NEW_MATCHING_ENGINE", enabled: false, description: "Route matching through the next-generation engine" },
  { key: "NEW_EMAIL_TEMPLATE", enabled: false, description: "Use the redesigned digest email template" },
  { key: "NEW_CRAWLER", enabled: false, description: "Enable experimental crawler strategies" },
  { key: "PERSONALIZED_RANKING", enabled: true, description: "Apply aggregated interaction signals to ranking" },
  { key: "GRAPH_RECOMMENDATIONS", enabled: false, description: "Graph-based recommendations (future, requires Neo4j)" },
  { key: "LLM_MATCHING", enabled: true, description: "Use the LLM for borderline match evaluation" },
];

export type FlagKey = "NEW_MATCHING_ENGINE" | "NEW_EMAIL_TEMPLATE" | "NEW_CRAWLER" | "PERSONALIZED_RANKING" | "GRAPH_RECOMMENDATIONS" | "LLM_MATCHING";

const KEY = "platform:flags:v1";

export async function listFlags(): Promise<FeatureFlag[]> {
  return cached(KEY, 30, async () => {
    const rows = await query<FeatureFlag>("SELECT key, enabled, description FROM feature_flags ORDER BY key");
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return FLAG_DEFAULTS.map((d) => byKey.get(d.key) ?? d);
  });
}

export async function isEnabled(key: FlagKey): Promise<boolean> {
  return (await listFlags()).find((f) => f.key === key)?.enabled ?? false;
}

export async function setFlag(key: string, enabled: boolean): Promise<void> {
  const def = FLAG_DEFAULTS.find((f) => f.key === key);
  if (!def) throw new Error(`Unknown flag ${key}`);
  await query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled, def.description],
  );
  await invalidate(KEY);
}
