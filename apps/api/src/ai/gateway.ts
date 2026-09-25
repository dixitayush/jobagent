import { env } from "../config/env";
import { query, queryOne } from "../db/pool";
import { sha256 } from "../lib/hash";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { getSettings } from "../settings/platformSettings";
import { LangChainProvider } from "./providers/langchain";
import { LLMError, type LLMProvider, type ProviderName, type StructuredRequest } from "./types";

const providers: Record<ProviderName, LLMProvider> = {
  anthropic: new LangChainProvider("anthropic"),
  openai: new LangChainProvider("openai"),
  gemini: new LangChainProvider("gemini"),
};

/** USD per 1M tokens [input, output, cachedInput?]. Override/extend with LLM_PRICING_JSON. */
const PRICING: Record<string, [number, number, number?]> = {
  "gpt-5": [1.25, 10, 0.125],
  "gpt-5-mini": [0.25, 2, 0.025],
  "gpt-5-nano": [0.05, 0.4, 0.005],
  "gpt-5.1": [1.25, 10, 0.125],
  "gpt-5.2": [1.75, 14, 0.175],
  "gpt-5.4": [2.5, 15, 0.25],
  "gpt-5.4-mini": [0.75, 4.5, 0.075],
  "gpt-5.4-nano": [0.2, 1.25, 0.02],
  "gpt-5.5": [5, 30, 0.5],
  "gpt-5.6-sol": [4, 20, 0.4],
  "gpt-5.6-terra": [2, 12, 0.2],
  "gpt-5.6-luna": [0.2, 1.2, 0.02],
  "gpt-6-astra": [10, 50],
  "gpt-6-sol": [2, 10, 0.2],
  "gpt-6-luna": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  ...(process.env.LLM_PRICING_JSON ? (JSON.parse(process.env.LLM_PRICING_JSON) as Record<string, [number, number, number?]>) : {}),
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
  const key = Object.keys(PRICING)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  if (!key) return 0;
  const [inp, out, cachedRate] = PRICING[key]!;
  const cached = Math.min(cachedInputTokens, inputTokens);
  return ((inputTokens - cached) * inp + cached * (cachedRate ?? inp) + outputTokens * out) / 1_000_000;
}

export interface LLMContext {
  agentRunId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
}

export interface LLMResult<T> {
  data: T;
  model: string;
  provider: ProviderName;
  promptVersion: string;
  tokens: number;
  cost: number;
  cached: boolean;
}

export async function llmAvailable(): Promise<boolean> {
  const s = await getSettings();
  return s.llmProvider !== "none" && providers[s.llmProvider].isConfigured();
}

async function record(
  ctx: LLMContext,
  row: { provider: string; model: string; purpose: string; promptVersion: string; input: number; output: number; latency: number; cost: number; success: boolean; cached: boolean; cachedInput?: number; error?: string },
) {
  await query(
    `INSERT INTO llm_requests (agent_run_id, tenant_id, user_id, provider, model, purpose, prompt_version, input_tokens, output_tokens, latency_ms, estimated_cost, success, cached, error, cached_input_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [ctx.agentRunId ?? null, ctx.tenantId ?? null, ctx.userId ?? null, row.provider, row.model, row.purpose, row.promptVersion, row.input, row.output, row.latency, row.cost, row.success, row.cached, row.error ?? null, row.cachedInput ?? 0],
  ).catch((err) => logger.warn({ err: err.message }, "failed to record llm request"));
}

/**
 * Single entry point for every LLM call. Handles provider/model selection from admin
 * settings, result caching (PRD §85), cost/latency recording (PRD §126) and graceful
 * degradation: returns null instead of throwing so callers fall back to rules (PRD §130).
 */
export async function generateStructured<T>(req: StructuredRequest<T>, ctx: LLMContext = {}, cacheKey?: string): Promise<LLMResult<T> | null> {
  const settings = await getSettings();
  if (settings.llmProvider === "none") return null;
  const provider = providers[settings.llmProvider];
  if (!provider.isConfigured()) return null;
  const model = req.tier === "strong" ? settings.llmModel : settings.llmSmallModel;
  const fullCacheKey = cacheKey ? sha256(`${req.purpose}|${req.promptVersion}|${provider.name}|${model}|${cacheKey}`) : null;

  if (fullCacheKey) {
    const hit = await queryOne<{ value: unknown }>("SELECT value FROM llm_cache WHERE cache_key = $1", [fullCacheKey]);
    const parsed = hit ? req.schema.safeParse(hit.value) : null;
    if (parsed?.success) {
      await record(ctx, { provider: provider.name, model, purpose: req.purpose, promptVersion: req.promptVersion, input: 0, output: 0, latency: 0, cost: 0, success: true, cached: true });
      return { data: parsed.data, model, provider: provider.name, promptVersion: req.promptVersion, tokens: 0, cost: 0, cached: true };
    }
  }

  const started = Date.now();
  const labels = { provider: provider.name, model, purpose: req.purpose };
  try {
    const res = await provider.generateStructured(req, {
      model,
      temperature: settings.llmTemperature,
      timeoutMs: env.LLM_TIMEOUT_MS,
      reasoningEffort: req.tier === "strong" ? env.LLM_REASONING_EFFORT : env.LLM_SMALL_REASONING_EFFORT,
    });
    const latency = Date.now() - started;
    const cost = estimateCost(res.model, res.inputTokens, res.outputTokens, res.cachedInputTokens);
    metrics.llmLatency.observe(labels, latency / 1000);
    metrics.llmCost.inc(labels, cost);
    metrics.llmTokens.inc({ provider: provider.name, model, direction: "input" }, res.inputTokens);
    metrics.llmTokens.inc({ provider: provider.name, model, direction: "output" }, res.outputTokens);
    await record(ctx, { provider: provider.name, model: res.model, purpose: req.purpose, promptVersion: req.promptVersion, input: res.inputTokens, output: res.outputTokens, cachedInput: res.cachedInputTokens, latency, cost, success: true, cached: false });
    if (fullCacheKey) {
      await query(
        `INSERT INTO llm_cache (cache_key, purpose, value) VALUES ($1, $2, $3) ON CONFLICT (cache_key) DO UPDATE SET value = EXCLUDED.value`,
        [fullCacheKey, req.purpose, JSON.stringify(res.data)],
      ).catch(() => undefined);
    }
    return { data: res.data, model: res.model, provider: provider.name, promptVersion: req.promptVersion, tokens: res.inputTokens + res.outputTokens, cost, cached: false };
  } catch (err) {
    const latency = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    metrics.llmErrors.inc(labels);
    logger.warn({ ...labels, err: message, retryable: err instanceof LLMError ? err.retryable : false }, "llm call failed; degrading to rules");
    await record(ctx, { provider: provider.name, model, purpose: req.purpose, promptVersion: req.promptVersion, input: 0, output: 0, latency, cost: 0, success: false, cached: false, error: message.slice(0, 500) });
    return null;
  }
}
