import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { UsageInfo } from "@shared/llm";
import type { EmbeddingInfo, EmbeddingModelOption, EmbeddingProviderId } from "@shared/rag";
import { normalize } from "./vectorMath";

export interface EmbedResult {
  vectors: number[][];
  dims: number;
  ms: number;
  usage: UsageInfo | null;
  info: EmbeddingInfo;
}

export interface Embedder {
  readonly info: EmbeddingInfo;
  embed(texts: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<EmbedResult>;
}

export interface EmbeddingKeys {
  openai?: string;
  google?: string;
}

/** Known models and their published dimensionality. */
export const EMBEDDING_MODELS: { provider: EmbeddingProviderId; model: string; label: string; dims: number; note: string }[] = [
  {
    provider: "openai",
    model: "text-embedding-3-small",
    label: "OpenAI · text-embedding-3-small",
    dims: 1536,
    note: "Real neural embeddings from OpenAI's API. Usage is billed per input token.",
  },
  {
    provider: "openai",
    model: "text-embedding-3-large",
    label: "OpenAI · text-embedding-3-large",
    dims: 3072,
    note: "Real neural embeddings from OpenAI's API, higher dimensional and slower.",
  },
  {
    provider: "gemini",
    model: "gemini-embedding-001",
    label: "Gemini · gemini-embedding-001",
    dims: 768,
    note: "Real neural embeddings from Google's API, requested at 768 dimensions.",
  },
  {
    provider: "local",
    model: "hashed-ngram-256",
    label: "Local · hashed n-grams (no model)",
    dims: 256,
    note: "Computed on this server from word and character n-grams. Real vectors and real cosine math, but no learned meaning: a lexical stand-in so the pipeline runs without a key.",
  },
];

export function embeddingOptions(keys: EmbeddingKeys): EmbeddingModelOption[] {
  return EMBEDDING_MODELS.map((m) => ({
    ...m,
    configured: m.provider === "local" || (m.provider === "openai" ? Boolean(keys.openai) : Boolean(keys.google)),
    source: m.provider === "local" ? "simulation" : "live",
  }));
}

export function createEmbedder(provider: EmbeddingProviderId, model: string, keys: EmbeddingKeys): Embedder {
  const known = EMBEDDING_MODELS.find((m) => m.provider === provider && m.model === model) ?? EMBEDDING_MODELS.find((m) => m.provider === provider)!;
  if (provider === "openai") {
    if (!keys.openai) throw new Error("OpenAI embeddings need an OpenAI API key. Add one in Settings, or pick the local embedding.");
    return new OpenAIEmbedder(known.model, known.dims, keys.openai);
  }
  if (provider === "gemini") {
    if (!keys.google) throw new Error("Gemini embeddings need a Google API key. Add one in Settings, or pick the local embedding.");
    return new GeminiEmbedder(known.model, known.dims, keys.google);
  }
  return new LocalEmbedder(known.dims);
}

const BATCH = 64;

class OpenAIEmbedder implements Embedder {
  readonly info: EmbeddingInfo;
  private readonly client: OpenAI;
  constructor(private readonly model: string, dims: number, apiKey: string) {
    this.client = new OpenAI({ apiKey });
    this.info = { provider: "openai", model, dims, source: "live", note: `Vectors returned by OpenAI's embeddings endpoint for ${model}.` };
  }
  async embed(texts: string[], signal?: AbortSignal, onProgress?: (d: number, t: number) => void): Promise<EmbedResult> {
    const start = Date.now();
    const vectors: number[][] = [];
    let prompt = 0;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const res = await this.client.embeddings.create({ model: this.model, input: batch, encoding_format: "float" }, { signal });
      for (const e of [...res.data].sort((a, b) => a.index - b.index)) vectors.push(e.embedding);
      prompt += res.usage.prompt_tokens;
      onProgress?.(Math.min(texts.length, i + BATCH), texts.length);
    }
    const dims = vectors[0]?.length ?? this.info.dims;
    return { vectors, dims, ms: Date.now() - start, usage: { inputTokens: prompt, outputTokens: 0, totalTokens: prompt }, info: { ...this.info, dims } };
  }
}

class GeminiEmbedder implements Embedder {
  readonly info: EmbeddingInfo;
  private readonly client: GoogleGenAI;
  constructor(private readonly model: string, dims: number, apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.info = { provider: "gemini", model, dims, source: "live", note: `Vectors returned by Google's embedContent endpoint for ${model}, ${dims} dimensions.` };
  }
  async embed(texts: string[], signal?: AbortSignal, onProgress?: (d: number, t: number) => void): Promise<EmbedResult> {
    const start = Date.now();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const batch = texts.slice(i, i + BATCH);
      const res = await this.client.models.embedContent({
        model: this.model,
        contents: batch,
        config: { outputDimensionality: this.info.dims, taskType: "RETRIEVAL_DOCUMENT" },
      });
      // Truncated Gemini vectors are not unit length; normalize so cosine is meaningful.
      for (const e of res.embeddings ?? []) vectors.push(normalize(e.values ?? []));
      onProgress?.(Math.min(texts.length, i + BATCH), texts.length);
    }
    const dims = vectors[0]?.length ?? this.info.dims;
    // Gemini does not report token usage for embeddings.
    return { vectors, dims, ms: Date.now() - start, usage: null, info: { ...this.info, dims } };
  }
}

/**
 * A lexical embedding: word unigrams, bigrams and character trigrams hashed
 * into a fixed number of buckets, then L2-normalized. Chunks that share words
 * land near each other, which is enough to make retrieval work and to teach
 * the mechanics, but it has no learned semantics and the UI says so.
 */
export class LocalEmbedder implements Embedder {
  readonly info: EmbeddingInfo;
  constructor(private readonly dims: number) {
    this.info = {
      provider: "local",
      model: "hashed-ngram-256",
      dims,
      source: "simulation",
      note: "Hashed word and character n-grams computed locally. Real vectors and real cosine similarity, but no learned meaning: a stand-in for a neural embedding model.",
    };
  }
  async embed(texts: string[], _signal?: AbortSignal, onProgress?: (d: number, t: number) => void): Promise<EmbedResult> {
    const start = Date.now();
    const vectors = texts.map((t, i) => {
      onProgress?.(i + 1, texts.length);
      return embedLocal(t, this.dims);
    });
    return { vectors, dims: this.dims, ms: Date.now() - start, usage: null, info: this.info };
  }
}

export function embedLocal(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const bump = (key: string, weight: number) => {
    const h = fnv(key);
    v[h % dims]! += weight * (h & 1 ? 1 : -1);
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    bump(`w:${w}`, 1);
    if (i + 1 < words.length) bump(`b:${w} ${words[i + 1]}`, 0.6);
    for (let j = 0; j + 3 <= w.length; j++) bump(`c:${w.slice(j, j + 3)}`, 0.25);
  }
  return normalize(v);
}

function fnv(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
