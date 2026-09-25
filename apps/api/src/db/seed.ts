import { LOCATION_SEED, REMOTE_SEED } from "../domain/locations/data";
import { SKILL_TAXONOMY } from "../domain/skills/taxonomy";
import { logger } from "../lib/logger";
import { FLAG_DEFAULTS } from "../settings/featureFlags";
import { migrate } from "./migrate";
import { pool, withTransaction } from "./pool";

/** Idempotent reference-data seeding: safe to run on every deploy. */
export async function seed(): Promise<void> {
  await withTransaction(async (c) => {
    const upsertLocation = async (name: string, type: string, parentId: number | null, code: string | null, aliases: string[]) => {
      const found = await c.query<{ id: number }>("SELECT id FROM locations WHERE type = $1 AND name = $2 AND parent_id IS NOT DISTINCT FROM $3", [type, name, parentId]);
      if (found.rows[0]) {
        await c.query("UPDATE locations SET aliases = $2, country_code = $3 WHERE id = $1", [found.rows[0].id, aliases.map((a) => a.toLowerCase()), code]);
        return found.rows[0].id;
      }
      return (await c.query<{ id: number }>("INSERT INTO locations (name, type, parent_id, country_code, aliases) VALUES ($1,$2,$3,$4,$5) RETURNING id", [name, type, parentId, code, aliases.map((a) => a.toLowerCase())])).rows[0]!.id;
    };
    for (const country of LOCATION_SEED) {
      const cid = await upsertLocation(country.name, "COUNTRY", null, country.code, country.aliases);
      for (const state of country.states) {
        const sid = await upsertLocation(state.name, "STATE", cid, country.code, state.aliases ?? []);
        for (const city of state.cities) {
          const def = typeof city === "string" ? { name: city, aliases: [] as string[] } : { name: city.name, aliases: city.aliases ?? [] };
          await upsertLocation(def.name, "CITY", sid, country.code, def.aliases);
        }
      }
    }
    for (const r of REMOTE_SEED) await upsertLocation(r.name, "REMOTE", null, r.countryCode, []);

    for (const s of SKILL_TAXONOMY) {
      await c.query("INSERT INTO skills (name, category) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category", [s.name, s.category]);
    }
    for (const s of SKILL_TAXONOMY) {
      if (s.parent) await c.query("UPDATE skills SET parent_skill_id = (SELECT id FROM skills WHERE name = $2) WHERE name = $1", [s.name, s.parent]);
      for (const alias of s.aliases ?? []) {
        await c.query(
          "INSERT INTO skill_aliases (skill_id, alias) SELECT id, $2 FROM skills WHERE name = $1 ON CONFLICT (alias) DO NOTHING",
          [s.name, alias.toLowerCase()],
        );
      }
    }
    for (const f of FLAG_DEFAULTS) {
      await c.query("INSERT INTO feature_flags (key, enabled, description) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING", [f.key, f.enabled, f.description]);
    }
  });
  logger.info({ skills: SKILL_TAXONOMY.length, countries: LOCATION_SEED.length }, "seed complete");
}

const isMain = /[\\/]seed\.(ts|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  // `seed` also applies pending migrations so a fresh database needs a single command.
  migrate()
    .then(() => seed())
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, "seed failed");
      process.exit(1);
    });
}
