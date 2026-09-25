import type { Location } from "@jobagent/shared";
import { query, type Queryable } from "../db/pool";
import { buildLocationIndex, type LocationIndex, type LocationRow } from "../domain/locations/resolver";

const TTL_MS = 10 * 60_000;
let locCache: { at: number; rows: LocationRow[]; index: LocationIndex } | null = null;
let skillCache: { at: number; ids: Map<string, number> } | null = null;

export async function locationRows(): Promise<LocationRow[]> {
  if (!locCache || Date.now() - locCache.at > TTL_MS) {
    const rows = await query<LocationRow>(
      `SELECT id, name, type, parent_id AS "parentId", country_code AS "countryCode", aliases FROM locations ORDER BY type, name`,
    );
    locCache = { at: Date.now(), rows, index: buildLocationIndex(rows) };
  }
  return locCache.rows;
}

export async function locationIndex(): Promise<LocationIndex> {
  await locationRows();
  return locCache!.index;
}

export async function publicLocations(): Promise<Location[]> {
  return (await locationRows()).map(({ id, name, type, parentId, countryCode }) => ({ id, name, type, parentId, countryCode }));
}

export async function skillIds(): Promise<Map<string, number>> {
  if (!skillCache || Date.now() - skillCache.at > TTL_MS) {
    const rows = await query<{ id: number; name: string }>("SELECT id, name FROM skills");
    skillCache = { at: Date.now(), ids: new Map(rows.map((r) => [r.name.toLowerCase(), r.id])) };
  }
  return skillCache.ids;
}

export async function replaceJobSkills(jobId: string, required: string[], preferred: string[], db: Queryable): Promise<void> {
  const ids = await skillIds();
  await db.query("DELETE FROM job_skills WHERE job_id = $1", [jobId]);
  const rows = [...required.map((s) => [s, "REQUIRED"]), ...preferred.map((s) => [s, "PREFERRED"])] as [string, string][];
  if (!rows.length) return;
  await db.query(
    `INSERT INTO job_skills (job_id, skill_id, skill_name, requirement)
     SELECT $1, u.skill_id, u.skill_name, u.requirement
     FROM unnest($2::int[], $3::text[], $4::text[]) AS u(skill_id, skill_name, requirement)
     ON CONFLICT (job_id, skill_name) DO NOTHING`,
    [jobId, rows.map(([s]) => ids.get(s.toLowerCase()) ?? null), rows.map(([s]) => s), rows.map(([, r]) => r)],
  );
}
