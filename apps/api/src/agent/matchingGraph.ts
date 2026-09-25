import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { MatchResult } from "@jobagent/shared";
import { embeddingProvider } from "../ai/embeddings";
import { llmAvailable } from "../ai/gateway";
import { understandJobWithLlm } from "../ai/jobUnderstanding";
import { evaluateMatchWithLlm } from "../ai/matchEvaluator";
import { PROMPT_VERSIONS } from "../ai/prompts";
import type { TenantContext } from "../db/tenant";
import { matchLocations, type LocationMatch } from "../domain/locations/resolver";
import { computeSkillAffinity, personalizationBoost, type SkillAffinity } from "../domain/matching/personalization";
import {
  explanationText,
  hardFilter,
  isPreferredCompany,
  rankScore,
  scoreJob,
  toMatchResult,
  type CandidateForMatch,
  type ScoreOutput,
  type ScoringConfig,
} from "../domain/matching/scoring";
import { sha256 } from "../lib/hash";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { getCandidateMemory, memoryToText, recallSimilarDecisions, type CandidateMemory } from "../services/candidateMemory";
import { embedCandidateProfile } from "../services/embeddingService";
import { locationIndex } from "../services/referenceData";
import { finishRun, runEvent, startRun } from "../services/agentRuns";
import { isEnabled } from "../settings/featureFlags";
import { getSettings } from "../settings/platformSettings";
import {
  getCandidatePreferences,
  getCandidateProfile,
  getExistingMatches,
  getInteractionSignals,
  saveJobUnderstanding,
  saveMatches,
  searchJobs,
  type AgentCandidate,
  type AgentPreferences,
  type MatchToSave,
  type RetrievedJob,
} from "./tools";

interface Scored {
  job: RetrievedJob;
  location: LocationMatch;
  out: ScoreOutput;
  result: MatchResult;
  explanation: string;
  promptVersion: string | null;
  cached: boolean;
}

/**
 * Worth an LLM call: uncached, in the borderline band, and with a real description. Jobs stored from
 * listing data only (details not fetched yet) keep their rules score until their details arrive.
 */
const MIN_DESCRIPTION_CHARS = 200;
const llmEligible = (x: Scored, band: { min: number; max: number }) =>
  !x.cached && x.out.score >= band.min && x.out.score <= band.max && x.job.description.trim().length >= MIN_DESCRIPTION_CHARS;

/** Concurrent LLM evaluations per matching run (keeps provider rate limits comfortable). */
const LLM_CONCURRENCY = 5;

const replace = <T>(fallback: () => T) => Annotation<T>({ reducer: (_prev, next) => next, default: fallback });
const add = () => Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 });

/** Shared state flowing through the matching agent's nodes. */
const MatchState = Annotation.Root({
  ctx: Annotation<TenantContext>(),
  trigger: Annotation<string>(),
  runId: Annotation<string>(),
  candidate: replace<AgentCandidate | null>(() => null),
  prefs: replace<AgentPreferences | null>(() => null),
  memory: replace<CandidateMemory | null>(() => null),
  prefsHash: replace<string>(() => ""),
  scoring: replace<ScoringConfig | null>(() => null),
  retrieved: replace<RetrievedJob[]>(() => []),
  scored: replace<Scored[]>(() => []),
  rejected: replace<string[]>(() => []),
  jobsFiltered: add(),
  tokens: add(),
  cost: add(),
  status: replace<"RUNNING" | "SKIPPED" | "SUCCEEDED">(() => "RUNNING"),
  skipReason: replace<string | null>(() => null),
});
type S = typeof MatchState.State;

const toCandidate = (c: AgentCandidate): CandidateForMatch => ({
  profileVersion: c.profileVersion,
  skills: c.profile.skills,
  yearsOfExperience: c.profile.yearsOfExperience,
  seniority: c.profile.seniority,
  jobTitles: c.profile.jobTitles,
});

/* ───────────────────────────── Nodes ───────────────────────────── */

/** Candidate Profile Agent: loads the normalized profile + preferences. */
async function loadContext(s: S): Promise<Partial<S>> {
  let candidate = await getCandidateProfile(s.ctx);
  if (!candidate) return { status: "SKIPPED", skipReason: "NO_PROFILE" };
  // Embedding model changed (e.g. local → OpenAI): re-embed so vectors stay comparable.
  const { model } = await embeddingProvider();
  if (candidate.embeddingModel !== model) {
    await embedCandidateProfile(s.ctx, candidate.profileId, candidate.profile);
    candidate = { ...candidate, embeddingModel: model };
  }
  const prefs = await getCandidatePreferences(s.ctx);
  const settings = await getSettings();
  const scoring: ScoringConfig = {
    weights: { skills: 30, experience: 20, title: 15, semantic: 15, location: 10, seniority: 5, workMode: 5 },
    thresholds: settings.matchThresholds,
  };
  const prefsHash = sha256(JSON.stringify([prefs.jobTitles, prefs.locationIds, prefs.preferredCompanies, prefs.workModes, prefs.employmentTypes, prefs.minExperience, prefs.maxExperience, settings.matchThresholds]));
  // Long-term agent memory: distilled from the user's own past decisions (advisory LLM context).
  const memory = await getCandidateMemory(s.ctx, prefs.personalizationEnabled);
  return { candidate, prefs, prefsHash, scoring, memory };
}

/** Retrieval: deterministic SQL filters, then pgvector nearest neighbours. */
async function retrieve(s: S): Promise<Partial<S>> {
  const settings = await getSettings();
  const retrieved = await searchJobs(s.ctx, {
    profileId: s.candidate!.profileId,
    embeddingModel: s.candidate!.embeddingModel,
    prefs: s.prefs!,
    limit: settings.retrievalLimit,
    maxAgeDays: 30,
  });
  await runEvent(s.runId, "RETRIEVED", { count: retrieved.length });
  return { retrieved };
}

/** Matching + hard filtering with deterministic scoring; reuses cached matches (PRD §86). */
async function score(s: S): Promise<Partial<S>> {
  const idx = await locationIndex();
  const candidate = toCandidate(s.candidate!);
  const prefs = s.prefs!;
  const existing = await getExistingMatches(s.ctx, s.retrieved.map((j) => j.id));
  let affinity: SkillAffinity = { signals: 0, weights: new Map() };
  if (prefs.personalizationEnabled && (await isEnabled("PERSONALIZED_RANKING"))) affinity = computeSkillAffinity(await getInteractionSignals(s.ctx));

  const scored: Scored[] = [];
  const rejected: string[] = [];
  for (const job of s.retrieved) {
    const location = matchLocations(job.locations, prefs.locationIds, idx);
    const jobForMatch = { ...job };
    const filter = hardFilter(jobForMatch, candidate, prefs, location);
    if (!filter.pass) {
      rejected.push(job.id);
      continue;
    }
    const prev = existing.get(job.id);
    const out = scoreJob({
      job: jobForMatch,
      candidate,
      prefs,
      location,
      similarity: job.similarity,
      embeddingModel: s.candidate!.embeddingModel,
      personalizationBoost: personalizationBoost([...job.requiredSkills, ...job.preferredSkills], affinity),
      config: s.scoring!,
    });
    if (
      prev &&
      prev.evaluatedBy === "LLM" &&
      prev.profileVersion === candidate.profileVersion &&
      prev.jobVersion === job.version &&
      prev.prefsHash === s.prefsHash &&
      prev.promptVersion === PROMPT_VERSIONS.jobMatch
    ) {
      // Same candidate, job, preferences and prompt version: reuse the LLM-evaluated match (PRD §86, §127).
      scored.push({ job, location, out: { ...out, score: prev.result.score, level: prev.result.matchLevel }, result: prev.result, explanation: prev.explanation ?? "", promptVersion: prev.promptVersion, cached: true });
      continue;
    }
    const result = toMatchResult(job.id, out, location, candidate.yearsOfExperience, job.similarity === null ? "RULES" : "RULES_VECTOR");
    scored.push({ job, location, out, result, explanation: explanationText(out.level, out.score, result.reasons, result.concerns), promptVersion: null, cached: false });
  }
  await runEvent(s.runId, "SCORED", { scored: scored.length, rejected: rejected.length, personalizationSignals: affinity.signals });
  return { scored, rejected, jobsFiltered: rejected.length };
}

async function needsLlm(s: S): Promise<"llmRefine" | "persist"> {
  if (!(await isEnabled("LLM_MATCHING")) || !(await llmAvailable())) return "persist";
  const { llmBorderline } = await getSettings();
  return s.scored.some((x) => llmEligible(x, llmBorderline)) ? "llmRefine" : "persist";
}

/**
 * Selective LLM evaluation (PRD §48–49): only uncached borderline jobs, capped per run.
 * 1) small model job understanding, cached globally per description;
 * 2) rescore; 3) if still borderline, strong model match evidence; 4) deterministic final score.
 */
async function llmRefine(s: S): Promise<Partial<S>> {
  const settings = await getSettings();
  const { min, max } = settings.llmBorderline;
  const candidate = toCandidate(s.candidate!);
  const prefs = s.prefs!;
  const llmCtx = { agentRunId: s.runId, ...s.ctx };
  const profile = s.candidate!.profile;
  let tokens = 0;
  let cost = 0;
  const budget = settings.llmMaxJobsPerRun;
  const scored = [...s.scored];
  const order = scored
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => llmEligible(x, { min, max }))
    .sort((a, b) => b.x.out.score - a.x.out.score);

  const refineOne = async ({ x, i }: { x: Scored; i: number }) => {
    let job = x.job;
    // Understand the job with the LLM unless it already has been with the current prompt version.
    if (job.extractionVersion !== PROMPT_VERSIONS.jobUnderstanding) {
      const understood = await understandJobWithLlm(
        { title: job.title, company: job.company, location: job.locationRaw, description: job.description, descriptionHash: job.descriptionHash },
        llmCtx,
      );
      if (understood) {
        tokens += understood.tokens;
        cost += understood.cost;
        await saveJobUnderstanding(job.id, understood).catch((err) => logger.warn({ err: (err as Error).message }, "failed to store job understanding"));
        job = {
          ...job,
          requiredSkills: [...understood.requiredSkills, ...understood.requiredAnyOf.flat()],
          preferredSkills: understood.preferredSkills,
          requiredAnyOf: understood.requiredAnyOf,
          requiredYears: understood.requiredYears ?? job.requiredYears,
          extractionMethod: "LLM",
          extractionVersion: understood.version,
        };
      }
    }
    const embeddingModel = s.candidate!.embeddingModel;
    let out = scoreJob({ job, candidate, prefs, location: x.location, similarity: job.similarity, embeddingModel, personalizationBoost: x.out.breakdown.personalization, config: s.scoring! });
    let result = toMatchResult(job.id, out, x.location, candidate.yearsOfExperience, x.result.evaluatedBy);
    let promptVersion: string | null = null;

    if (out.score >= min && out.score <= max) {
      const memoryText = memoryToText(s.memory);
      const similarDecisions = s.memory?.signalCount ? await recallSimilarDecisions(s.ctx, job.id) : "";
      const evidence = await evaluateMatchWithLlm(
        {
          skills: profile.skills,
          yearsOfExperience: profile.yearsOfExperience,
          seniority: profile.seniority,
          jobTitles: profile.jobTitles,
          education: profile.education.map((e) => [e.degree, e.field].filter(Boolean).join(" ")),
          certifications: profile.certifications,
        },
        { locations: prefs.locationNames, workModes: prefs.workModes, employmentTypes: prefs.employmentTypes, jobTitles: prefs.jobTitles },
        { text: memoryText, similarDecisions },
        { title: job.title, company: job.company, location: job.locationRaw, description: job.description },
        llmCtx,
        // Result cache: re-evaluate when the profile, job, preferences or memory change (PRD §86).
        `${s.candidate!.profileId}:${job.id}:${job.version}:${s.prefsHash}:${sha256(memoryText + similarDecisions).slice(0, 12)}`,
      );
      if (evidence) {
        tokens += evidence.tokens;
        cost += evidence.cost;
        promptVersion = evidence.promptVersion;
        // Memory can nudge (never decide): only with enough signals, and bounded with personalization (±3).
        const memoryAdj = (s.memory?.signalCount ?? 0) >= 3 ? (evidence.preferenceFit === "CONFLICTS" ? -2 : evidence.preferenceFit === "ALIGNED" ? 1 : 0) : 0;
        out = scoreJob({
          job,
          candidate,
          prefs,
          location: x.location,
          similarity: job.similarity,
          embeddingModel,
          skillEvidence: evidence,
          requiredYearsOverride: evidence.requiredYears ?? job.requiredYears,
          personalizationBoost: x.out.breakdown.personalization + memoryAdj,
          config: s.scoring!,
        });
        const note = evidence.preferenceNote.trim();
        result = toMatchResult(job.id, out, x.location, candidate.yearsOfExperience, "LLM", evidence.summary || null, {
          reasons: evidence.preferenceFit === "ALIGNED" && note ? [note] : [],
          concerns: [...evidence.concerns, ...(evidence.preferenceFit === "CONFLICTS" && note ? [note] : [])],
        });
      }
    }
    scored[i] = { ...x, job, out, result, explanation: explanationText(out.level, out.score, result.reasons, result.concerns), promptVersion };
  };
  // Bounded parallelism: a handful of concurrent LLM calls instead of one at a time.
  const queue = order.slice(0, Math.max(0, budget));
  await Promise.all(
    Array.from({ length: Math.min(LLM_CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await refineOne(item);
    }),
  );
  await runEvent(s.runId, "LLM_REFINED", { evaluated: Math.min(order.length, settings.llmMaxJobsPerRun), tokens, cost });
  return { scored, tokens, cost };
}

/** Ranking Agent + persistence. */
async function persist(s: S): Promise<Partial<S>> {
  const prefs = s.prefs!;
  const matches: MatchToSave[] = s.scored.map((x) => ({
    jobId: x.job.id,
    jobVersion: x.job.version,
    score: x.out.score,
    rankScore: rankScore(x.out.score, x.job.freshness, isPreferredCompany(x.job.company, prefs.preferredCompanies)),
    result: x.result,
    explanation: x.explanation,
    promptVersion: x.promptVersion,
  }));
  await saveMatches(s.ctx, s.candidate!.profileVersion, s.prefsHash, matches, s.rejected);
  return { status: "SUCCEEDED" };
}

/* ───────────────────────────── Graph ───────────────────────────── */

export const matchingGraph = new StateGraph(MatchState)
  .addNode("loadContext", loadContext)
  .addNode("retrieve", retrieve)
  .addNode("score", score)
  .addNode("llmRefine", llmRefine)
  .addNode("persist", persist)
  .addEdge(START, "loadContext")
  .addConditionalEdges("loadContext", (s: S) => (s.status === "SKIPPED" ? END : "retrieve"))
  .addEdge("retrieve", "score")
  .addConditionalEdges("score", needsLlm, { llmRefine: "llmRefine", persist: "persist" })
  .addEdge("llmRefine", "persist")
  .addEdge("persist", END)
  .compile();

export interface MatchRunSummary {
  runId: string;
  status: "SUCCEEDED" | "SKIPPED" | "FAILED";
  retrieved: number;
  matched: number;
  filtered: number;
  tokens: number;
  cost: number;
}

/** Runs the matching agent for one user with run tracking (PRD §60). */
export async function runMatchingAgent(ctx: TenantContext, trigger: string): Promise<MatchRunSummary> {
  const runId = await startRun("MATCH", { ...ctx, trigger });
  const timer = metrics.matchingDuration.startTimer();
  try {
    const final = await matchingGraph.invoke({ ctx, trigger, runId }, { runName: "job-matching-agent", metadata: { runId } });
    const summary: MatchRunSummary = {
      runId,
      status: final.status === "SKIPPED" ? "SKIPPED" : "SUCCEEDED",
      retrieved: final.retrieved.length,
      matched: final.scored.length,
      filtered: final.jobsFiltered,
      tokens: final.tokens,
      cost: final.cost,
    };
    await finishRun(runId, "MATCH", summary.status, {
      jobsDiscovered: summary.retrieved,
      jobsFiltered: summary.filtered,
      jobsMatched: summary.matched,
      tokensUsed: summary.tokens,
      estimatedCost: summary.cost,
    }, final.skipReason ?? undefined);
    logger.info({ event: "MATCHING_COMPLETED", tenantId: ctx.tenantId, userId: ctx.userId, ...summary }, "matching run complete");
    return summary;
  } catch (err) {
    await finishRun(runId, "MATCH", "FAILED", {}, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    timer();
  }
}
