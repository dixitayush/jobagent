import type { Embeddings } from "@langchain/core/embeddings";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { env, EMBEDDING_DIM } from "../config/env";
import { extractSkillsFromText } from "../domain/skills/taxonomy";
import { getSettings } from "../settings/platformSettings";

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set("a an and are as at be by for from has have in is it of on or our the to we with you your will this that who what".split(" "));

/**
 * Local feature-hashing embedder: zero cost, deterministic, no data leaves the process.
 * Canonical skills are weighted heavily so "k8s" and "Kubernetes" land on the same feature.
 * Used by default and as the offline option; swap in OpenAI/Gemini for true semantics.
 */
export class LocalHashEmbedder implements EmbeddingProvider {
  readonly model = "local-hash-v1";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
  embedOne(text: string): number[] {
    const v = new Float64Array(EMBEDDING_DIM);
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      v[h % EMBEDDING_DIM]! += (h & 0x80000000 ? -1 : 1) * weight;
    };
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t));
    tokens.forEach((t, i) => {
      add(`u:${t}`, 1);
      if (i > 0) add(`b:${tokens[i - 1]}_${t}`, 0.5);
    });
    for (const s of extractSkillsFromText(text)) add(`s:${s.toLowerCase()}`, 4);
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return Array.from(v, (x) => x / norm);
  }
}

/** Adapts any LangChain `Embeddings` implementation to our provider interface. */
class LangChainEmbedder implements EmbeddingProvider {
  constructor(
    readonly model: string,
    private readonly inner: Embeddings,
    private readonly normalize = false,
  ) {}
  async embed(texts: string[]): Promise<number[][]> {
    const vectors = await this.inner.embedDocuments(texts);
    if (!this.normalize) return vectors;
    // Truncated (reduced-dimension) embeddings are not unit-length; normalize for cosine.
    return vectors.map((v) => {
      const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}

const local = new LocalHashEmbedder();

/** Embeddings are only comparable within one model, so the active model is stored per row. */
export async function embeddingProvider(): Promise<EmbeddingProvider> {
  const { embeddingProvider: p } = await getSettings();
  if (p === "openai" && env.OPENAI_API_KEY) {
    return new LangChainEmbedder(env.EMBEDDING_MODEL, new OpenAIEmbeddings({ apiKey: env.OPENAI_API_KEY, model: env.EMBEDDING_MODEL, dimensions: EMBEDDING_DIM }));
  }
  if (p === "gemini" && env.GEMINI_API_KEY) {
    const model = "gemini-embedding-001";
    return new LangChainEmbedder(model, new GoogleGenerativeAIEmbeddings({ apiKey: env.GEMINI_API_KEY, model, outputDimensionality: EMBEDDING_DIM }), true);
  }
  return local;
}

export function candidateEmbeddingText(p: { summary: string; jobTitles: string[]; skills: string[]; industries: string[]; yearsOfExperience: number; seniority: string | null }): string {
  return [
    `Roles: ${p.jobTitles.join(", ")}`,
    `Seniority: ${p.seniority ?? ""}, ${p.yearsOfExperience} years experience`,
    `Skills: ${p.skills.join(", ")}`,
    `Industries: ${p.industries.join(", ")}`,
    p.summary,
  ].join("\n");
}

export function jobEmbeddingText(j: { title: string; company: string; requiredSkills: string[]; preferredSkills: string[]; description: string }): string {
  return [`Role: ${j.title}`, `Company: ${j.company}`, `Skills: ${[...j.requiredSkills, ...j.preferredSkills].join(", ")}`, j.description.slice(0, 6000)].join("\n");
}
