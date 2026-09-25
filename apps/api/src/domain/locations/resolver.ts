import type { LocationType } from "@jobagent/shared";

export interface LocationRow {
  id: number;
  name: string;
  type: LocationType;
  parentId: number | null;
  countryCode: string | null;
  aliases: string[];
}

export interface ResolvedLocation {
  raw: string;
  cityId: number | null;
  stateId: number | null;
  countryId: number | null;
  isRemote: boolean;
}

export interface LocationIndex {
  byId: Map<number, LocationRow>;
  /** lower-case name/alias → rows (a name can be ambiguous, e.g. "Cambridge"). */
  cities: Map<string, LocationRow[]>;
  states: Map<string, LocationRow[]>;
  countries: Map<string, LocationRow>;
  countryByCode: Map<string, LocationRow>;
  remoteByCountryCode: Map<string | null, LocationRow>;
  /** City names sorted longest-first for phrase search. */
  cityPhrases: string[];
}

export function buildLocationIndex(rows: LocationRow[]): LocationIndex {
  const idx: LocationIndex = {
    byId: new Map(),
    cities: new Map(),
    states: new Map(),
    countries: new Map(),
    countryByCode: new Map(),
    remoteByCountryCode: new Map(),
    cityPhrases: [],
  };
  const push = (m: Map<string, LocationRow[]>, k: string, r: LocationRow) => {
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  };
  for (const r of rows) {
    idx.byId.set(r.id, r);
    const names = [r.name, ...r.aliases].map((n) => n.toLowerCase());
    if (r.type === "CITY") names.forEach((n) => push(idx.cities, n, r));
    else if (r.type === "STATE") names.forEach((n) => push(idx.states, n, r));
    else if (r.type === "COUNTRY") {
      names.forEach((n) => idx.countries.set(n, r));
      if (r.countryCode) idx.countryByCode.set(r.countryCode.toLowerCase(), r);
    } else if (r.type === "REMOTE") idx.remoteByCountryCode.set(r.countryCode, r);
  }
  idx.cityPhrases = [...idx.cities.keys()].filter((k) => k.length >= 3).sort((a, b) => b.length - a.length);
  return idx;
}

const REMOTE_RE = /\b(remote|work from home|wfh|anywhere|distributed|home[- ]based)\b/i;
const MULTI_SPLIT_RE = /\s*(?:;|\||\n|\s\/\s|\bor\b|\band\b)\s*/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function countryOf(idx: LocationIndex, row: LocationRow | undefined): LocationRow | undefined {
  let cur = row;
  while (cur && cur.type !== "COUNTRY") cur = cur.parentId ? idx.byId.get(cur.parentId) : undefined;
  return cur;
}

function resolvePart(part: string, idx: LocationIndex): ResolvedLocation[] {
  const raw = part.trim();
  const lower = raw.toLowerCase();
  const isRemote = REMOTE_RE.test(lower);
  const segments = lower
    .replace(/[()[\]]/g, ",")
    .split(/[,\-–]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let country: LocationRow | undefined;
  let state: LocationRow | undefined;
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    country ??= idx.countries.get(seg) ?? (isLast && seg.length <= 3 && segments.length > 1 ? idx.countryByCode.get(seg) : undefined);
    if (!state) {
      const candidates = idx.states.get(seg);
      // Two-letter state codes are only trusted when they are not the first segment ("Austin, TX").
      if (candidates && (seg.length > 2 || i > 0)) state = candidates.find((c) => !country || countryOf(idx, c)?.id === country.id) ?? candidates[0];
    }
  });

  const cities: LocationRow[] = [];
  let remaining = lower;
  for (const phrase of idx.cityPhrases) {
    const re = new RegExp(`(?<![a-z])${escapeRe(phrase)}(?![a-z])`, "g");
    if (!re.test(remaining)) continue;
    // Consume the phrase so "Greater Noida" does not also match "Noida".
    remaining = remaining.replace(re, " ");
    const options = idx.cities.get(phrase) ?? [];
    const pick =
      options.find((c) => (state ? c.parentId === state.id : false)) ??
      options.find((c) => (country ? countryOf(idx, c)?.id === country.id : false)) ??
      options[0];
    if (pick && !cities.some((c) => c.id === pick.id)) cities.push(pick);
  }

  if (cities.length === 0) {
    if (!state && !country && !isRemote) return [];
    const st = state;
    return [{ raw, cityId: null, stateId: st?.id ?? null, countryId: (country ?? countryOf(idx, st))?.id ?? null, isRemote }];
  }
  return cities.map((city) => {
    const st = city.parentId ? idx.byId.get(city.parentId) : undefined;
    return { raw, cityId: city.id, stateId: st?.id ?? null, countryId: countryOf(idx, city)?.id ?? country?.id ?? null, isRemote };
  });
}

/** Parses free-text job locations ("Bengaluru, Karnataka, India; Remote - India") into normalized entities. */
export function resolveLocationText(raw: string, idx: LocationIndex): ResolvedLocation[] {
  if (!raw.trim()) return [];
  const out: ResolvedLocation[] = [];
  for (const part of raw.split(MULTI_SPLIT_RE)) {
    if (!part.trim()) continue;
    for (const r of resolvePart(part, idx)) {
      if (!out.some((o) => o.cityId === r.cityId && o.stateId === r.stateId && o.countryId === r.countryId && o.isRemote === r.isRemote)) out.push(r);
    }
  }
  return out;
}

export interface LocationMatch {
  /** null = job location unknown; do not hard-filter. */
  match: boolean | null;
  score: number;
  reason: string;
}

/** Compares job locations against the user's selected location ids. */
export function matchLocations(jobLocs: ResolvedLocation[], selectedIds: number[], idx: LocationIndex): LocationMatch {
  if (selectedIds.length === 0) return { match: true, score: 1, reason: "No location preference set" };
  if (jobLocs.length === 0) return { match: null, score: 0.5, reason: "Job location not specified" };

  const selected = selectedIds.map((id) => idx.byId.get(id)).filter((r): r is LocationRow => !!r);
  const selCountries = new Set(selected.filter((s) => s.type === "COUNTRY").map((s) => s.id));
  const selStates = new Set(selected.filter((s) => s.type === "STATE").map((s) => s.id));
  const selCities = new Set(selected.filter((s) => s.type === "CITY").map((s) => s.id));
  const selRemote = selected.filter((s) => s.type === "REMOTE");
  const cityCountry = (id: number) => countryOf(idx, idx.byId.get(id))?.id;
  const nameOf = (id: number | null) => (id ? idx.byId.get(id)?.name ?? "" : "");

  let partial: LocationMatch | null = null;
  for (const loc of jobLocs) {
    if (loc.isRemote) {
      const jobCountryCode = loc.countryId ? idx.byId.get(loc.countryId)?.countryCode ?? null : null;
      const remote = selRemote.find((r) => r.countryCode === null || jobCountryCode === null || r.countryCode === jobCountryCode);
      if (remote) return { match: true, score: 1, reason: `Remote role matches "${remote.name}"` };
      if (loc.cityId === null && loc.stateId === null) continue;
    }
    if (loc.cityId && (selCities.has(loc.cityId) || (loc.stateId && selStates.has(loc.stateId)) || (loc.countryId && selCountries.has(loc.countryId)))) {
      return { match: true, score: 1, reason: `${nameOf(loc.cityId)} is in your preferred locations` };
    }
    if (!loc.cityId && loc.stateId) {
      if (selStates.has(loc.stateId) || (loc.countryId && selCountries.has(loc.countryId)))
        return { match: true, score: 0.9, reason: `${nameOf(loc.stateId)} is in your preferred locations` };
      const citiesInState = [...selCities].filter((c) => idx.byId.get(c)?.parentId === loc.stateId);
      if (citiesInState.length) partial ??= { match: true, score: 0.7, reason: `Job lists ${nameOf(loc.stateId)} (city not specified)` };
    }
    if (!loc.cityId && !loc.stateId && loc.countryId) {
      if (selCountries.has(loc.countryId)) return { match: true, score: 0.9, reason: `${nameOf(loc.countryId)} is in your preferred locations` };
      const anyInCountry = [...selCities, ...selStates].some((id) => cityCountry(id) === loc.countryId);
      if (anyInCountry) partial ??= { match: true, score: 0.6, reason: `Job lists ${nameOf(loc.countryId)} (city not specified)` };
    }
  }
  if (partial) return partial;
  const labels = jobLocs.map((l) => (l.isRemote ? "Remote" : nameOf(l.cityId) || nameOf(l.stateId) || nameOf(l.countryId) || l.raw));
  return { match: false, score: 0, reason: `${[...new Set(labels)].join(", ")} is outside your preferred locations` };
}
