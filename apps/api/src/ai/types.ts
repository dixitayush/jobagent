import type { z } from "zod";

export type ProviderName = "anthropic" | "openai" | "gemini";
export type ModelTier = "small" | "strong";

export interface StructuredRequest<T> {
  /** e.g. "resume_parse", "job_understanding", "job_match" */
  purpose: string;
  /** e.g. "resume_parser_v1" — recorded with every result (PRD §127). */
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  tier: ModelTier;
  maxTokens?: number;
  /**
   * Prompt-cache routing key (OpenAI prompt_cache_key). Requests sharing a static prefix and this key
   * (e.g. every job evaluated for one user in a run) hit the provider's prompt cache.
   */
  promptCacheKey?: string;
}

export interface StructuredResponse<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of inputTokens served from the provider's prompt cache (billed at a discount). */
  cachedInputTokens: number;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface CallOptions {
  model: string;
  temperature: number;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort;
}

/** PRD §50 — provider abstraction so the agent never depends on one vendor. */
export interface LLMProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  generateStructured<T>(req: StructuredRequest<T>, opts: CallOptions): Promise<StructuredResponse<T>>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
