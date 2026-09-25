import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../../config/env";
import { LLMError, type CallOptions, type LLMProvider, type ProviderName, type StructuredRequest, type StructuredResponse } from "../types";

/** Claude models that accept the server-side refusal fallback chain. */
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5", "claude-fable-5-1"]);

/** OpenAI reasoning families (o-series, GPT-5, GPT-6) take reasoning_effort and max_completion_tokens, not temperature. */
const OPENAI_REASONING = /^(o\d|gpt-5(?!-chat)|gpt-6)/;

/** Models @langchain/openai itself treats as reasoning models (see isReasoningModel in the package). */
const LANGCHAIN_KNOWS_REASONING = /^(o\d|gpt-5(?!-chat))/;


function buildChatModel(provider: ProviderName, opts: CallOptions, maxTokens: number, cacheKey?: string): BaseChatModel {
  switch (provider) {
    case "anthropic":
      // Sampling params are omitted for current Claude models by the integration itself.
      return new ChatAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        model: opts.model,
        maxTokens,
        maxRetries: 2,
        clientOptions: { timeout: opts.timeoutMs },
        ...(FALLBACK_MODELS.has(opts.model)
          ? { betas: ["server-side-fallback-2026-07-01"], invocationKwargs: { fallbacks: "default" } }
          : {}),
      });
    case "openai":
      if (OPENAI_REASONING.test(opts.model)) {
        // Reasoning models (GPT-5/6, o-series): reasoning effort + max_completion_tokens, no temperature.
        // verbosity "low": structured JSON only. promptCacheKey routes same-prefix requests to a warm cache.
        const common = { apiKey: env.OPENAI_API_KEY, model: opts.model, maxRetries: 2, timeout: opts.timeoutMs, verbosity: "low" as const, ...(cacheKey ? { promptCacheKey: cacheKey } : {}) };
        // LangChain recognises o-series/GPT-5 natively. Its request builder overwrites modelKwargs with
        // its own (possibly undefined) fields, so native fields must be used for those models; newer
        // names it doesn't know yet (e.g. gpt-6) need raw kwargs instead.
        return LANGCHAIN_KNOWS_REASONING.test(opts.model)
          ? new ChatOpenAI({ ...common, maxTokens, reasoning: { effort: opts.reasoningEffort } })
          : new ChatOpenAI({ ...common, modelKwargs: { max_completion_tokens: maxTokens, reasoning_effort: opts.reasoningEffort } });
      }
      return new ChatOpenAI({ apiKey: env.OPENAI_API_KEY, model: opts.model, temperature: opts.temperature, maxTokens, maxRetries: 2, timeout: opts.timeoutMs, ...(cacheKey ? { promptCacheKey: cacheKey } : {}) });
    case "gemini":
      return new ChatGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY, model: opts.model, temperature: opts.temperature, maxOutputTokens: maxTokens, maxRetries: 2 });
  }
}

const isConfigured: Record<ProviderName, () => boolean> = {
  anthropic: () => Boolean(env.ANTHROPIC_API_KEY),
  openai: () => Boolean(env.OPENAI_API_KEY),
  gemini: () => Boolean(env.GEMINI_API_KEY),
};

/**
 * LangChain-backed provider (PRD §50). One implementation covers Anthropic, OpenAI and
 * Gemini: each is a LangChain chat model driven through `withStructuredOutput`, using the
 * provider's native JSON-schema mode so the result is schema-validated (PRD §51).
 */
export class LangChainProvider implements LLMProvider {
  constructor(readonly name: ProviderName) {}

  isConfigured(): boolean {
    return isConfigured[this.name]();
  }

  async generateStructured<T>(req: StructuredRequest<T>, opts: CallOptions): Promise<StructuredResponse<T>> {
    const model = buildChatModel(this.name, opts, req.maxTokens ?? 8000, req.promptCacheKey);
    // Native JSON-schema structured output. LangChain re-requests on its own when the output fails to
    // parse, so no extra repair loop is layered on top here.
    const structured = model.withStructuredOutput(req.schema, { name: req.schemaName, method: "jsonSchema", includeRaw: true });
    let result: { raw: unknown; parsed: unknown };
    try {
      result = (await structured.invoke([new SystemMessage(req.system), new HumanMessage(req.user)], {
        signal: AbortSignal.timeout(opts.timeoutMs),
        runName: `${req.purpose}:${req.promptVersion}`,
      })) as { raw: unknown; parsed: unknown };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      throw new LLMError(`${this.name} call failed${status ? ` (${status})` : ""}: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`, retryable);
    }
    const raw = result.raw instanceof AIMessage ? result.raw : null;
    // Anthropic reports stop_reason; OpenAI reports finish_reason and a refusal field.
    const stopReason = (raw?.response_metadata?.stop_reason ?? raw?.response_metadata?.finish_reason) as string | undefined;
    if (stopReason === "refusal" || raw?.additional_kwargs?.refusal) throw new LLMError("Model declined the request", false);
    if (stopReason === "max_tokens" || stopReason === "length") throw new LLMError("Response truncated at the token limit", false);
    const parsed = req.schema.safeParse(result.parsed);
    if (!parsed.success) throw new LLMError("Structured output failed schema validation", false);
    return {
      data: parsed.data,
      model: (raw?.response_metadata?.model as string | undefined) ?? (raw?.response_metadata?.model_name as string | undefined) ?? opts.model,
      inputTokens: raw?.usage_metadata?.input_tokens ?? 0,
      outputTokens: raw?.usage_metadata?.output_tokens ?? 0,
      cachedInputTokens: raw?.usage_metadata?.input_token_details?.cache_read ?? 0,
    };
  }
}
