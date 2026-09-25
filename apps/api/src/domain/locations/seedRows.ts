import { LOCATION_SEED, REMOTE_SEED } from "./data";
import type { LocationRow } from "./resolver";

/** Flattens the seed tree into rows with sequential ids (parents always precede children). */
export function flattenLocationSeed(): LocationRow[] {
  const rows: LocationRow[] = [];
  let id = 1;
  for (const c of LOCATION_SEED) {
    const countryId = id++;
    rows.push({ id: countryId, name: c.name, type: "COUNTRY", parentId: null, countryCode: c.code, aliases: c.aliases });
    for (const s of c.states) {
      const stateId = id++;
      rows.push({ id: stateId, name: s.name, type: "STATE", parentId: countryId, countryCode: c.code, aliases: s.aliases ?? [] });
      for (const city of s.cities) {
        const def = typeof city === "string" ? { name: city, aliases: [] } : { name: city.name, aliases: city.aliases ?? [] };
        rows.push({ id: id++, name: def.name, type: "CITY", parentId: stateId, countryCode: c.code, aliases: def.aliases });
      }
    }
  }
  for (const r of REMOTE_SEED) rows.push({ id: id++, name: r.name, type: "REMOTE", parentId: null, countryCode: r.countryCode, aliases: [] });
  return rows;
}
