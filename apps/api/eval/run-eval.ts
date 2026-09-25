/**
 * Offline matching evaluation (PRD §88, §102). Runs the production scoring pipeline (rules +
 * local embeddings, no network) over a labelled dataset and reports Precision@k, NDCG and
 * false-positive rate. Run on every scoring/threshold/prompt change:  npm run eval
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRequirementsByRules } from "../src/ai/jobUnderstanding";
import { LocalHashEmbedder, candidateEmbeddingText, jobEmbeddingText } from "../src/ai/embeddings";
import { extractRequiredYears, inferEmploymentType, inferSeniority, inferWorkMode } from "../src/domain/jobs/normalize";
import { buildLocationIndex, matchLocations, resolveLocationText } from "../src/domain/locations/resolver";
import { flattenLocationSeed } from "../src/domain/locations/seedRows";
import { hardFilter, levelFor, rankScore, scoreJob, type CandidateForMatch, type PrefsForMatch } from "../src/domain/matching/scoring";

type Label = "VERY_RELEVANT" | "RELEVANT" | "BORDERLINE" | "IRRELEVANT";
const GAIN: Record<Label, number> = { VERY_RELEVANT: 3, RELEVANT: 2, BORDERLINE: 1, IRRELEVANT: 0 };
const isRelevant = (l: Label) => l === "VERY_RELEVANT" || l === "RELEVANT";

interface Dataset {
  candidates: {
    id: string;
    profile: Omit<CandidateForMatch, "profileVersion">;
    prefs: { jobTitles: string[]; locations: string[]; workModes: PrefsForMatch["workModes"]; employmentTypes: PrefsForMatch["employmentTypes"] };
    jobs: { id: string; label: Label; title: string; company: string; location: string; description: string }[];
  }[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, "dataset.json"), "utf8")) as Dataset;
const rows = flattenLocationSeed();
const idx = buildLocationIndex(rows);
const embedder = new LocalHashEmbedder();
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

function dcg(gains: number[]) {
  return gains.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
}

const K = [5, 10];
const totals = { p: Object.fromEntries(K.map((k) => [k, 0])) as Record<number, number>, ndcg: 0, recall: 0, fp: 0, recommended: 0 };

for (const c of data.candidates) {
  const candidate: CandidateForMatch = { ...c.profile, profileVersion: 1 };
  const prefs: PrefsForMatch = {
    jobTitles: c.prefs.jobTitles,
    locationIds: c.prefs.locations.map((n) => rows.find((r) => r.name === n)!.id),
    preferredCompanies: [],
    blockedCompanies: [],
    minExperience: null,
    maxExperience: null,
    workModes: c.prefs.workModes,
    employmentTypes: c.prefs.employmentTypes,
  };
  const candVec = embedder.embedOne(candidateEmbeddingText({ summary: "", industries: [], ...c.profile }));
  const ranked: { id: string; label: Label; rank: number; score: number; passed: boolean }[] = [];
  for (const j of c.jobs) {
    const years = extractRequiredYears(j.description);
    const reqs = extractRequirementsByRules(j.title, j.description, years);
    const job = {
      id: j.id,
      title: j.title,
      company: j.company,
      requiredSkills: reqs.requiredSkills,
      preferredSkills: reqs.preferredSkills,
      requiredAnyOf: reqs.requiredAnyOf,
      requiredYears: years,
      seniority: inferSeniority(j.title),
      workMode: inferWorkMode(null, null, [j.location], j.description),
      employmentType: inferEmploymentType(null, j.title, j.description),
      freshness: "NEW" as const,
    };
    const location = matchLocations(resolveLocationText(j.location, idx), prefs.locationIds, idx);
    const passed = hardFilter(job, candidate, prefs, location).pass;
    const similarity = dot(candVec, embedder.embedOne(jobEmbeddingText({ ...job, description: j.description })));
    const out = scoreJob({ job, candidate, prefs, location, similarity, embeddingModel: embedder.model });
    ranked.push({ id: j.id, label: j.label, score: out.score, rank: passed ? rankScore(out.score, "NEW", false) : -1, passed });
  }
  ranked.sort((a, b) => b.rank - a.rank);
  // "Recommended" = passed hard filters and reached at least GOOD.
  const recommended = ranked.filter((r) => r.passed && levelFor(r.score) !== "LOW" && levelFor(r.score) !== "PARTIAL");
  const relevantTotal = c.jobs.filter((j) => isRelevant(j.label)).length;

  console.log(`\n▸ ${c.id}`);
  for (const r of ranked) console.log(`   ${r.passed ? " " : "✗"} ${String(r.score).padStart(3)}  ${levelFor(r.score).padEnd(11)} ${r.label.padEnd(13)} ${c.jobs.find((j) => j.id === r.id)!.title}`);

  for (const k of K) totals.p[k]! += ranked.slice(0, k).filter((r) => r.passed && isRelevant(r.label)).length / Math.min(k, ranked.length);
  const ideal = dcg(c.jobs.map((j) => GAIN[j.label]).sort((a, b) => b - a).slice(0, 10));
  totals.ndcg += ideal ? dcg(ranked.slice(0, 10).map((r) => (r.passed ? GAIN[r.label] : 0))) / ideal : 0;
  totals.recall += relevantTotal ? recommended.filter((r) => isRelevant(r.label)).length / relevantTotal : 1;
  totals.fp += recommended.filter((r) => r.label === "IRRELEVANT").length;
  totals.recommended += recommended.length;
}

const n = data.candidates.length;
console.log("\n── Results ─────────────────────────────");
for (const k of K) console.log(`Precision@${k}:        ${(totals.p[k]! / n).toFixed(3)}`);
console.log(`NDCG@10:             ${(totals.ndcg / n).toFixed(3)}`);
console.log(`Recall (≥GOOD):      ${(totals.recall / n).toFixed(3)}`);
console.log(`False positive rate: ${(totals.recommended ? totals.fp / totals.recommended : 0).toFixed(3)}  (${totals.fp}/${totals.recommended} recommended were irrelevant)`);
