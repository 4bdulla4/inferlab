/**
 * Shared contract for the RAG lab: what the server can honestly report about a
 * knowledge base and a query, and what the browser is allowed to treat as LIVE.
 *
 * The same rule as the LLM lab applies. `DataSource` on a value means:
 *   - "live"        → computed from the user's real documents by real code, or
 *                     observed from a real provider API (embeddings, the LLM)
 *   - "simulation"  → a conceptual visualization, or a stand-in method that is
 *                     not what a production system would use
 */
import type { DataSource, ProviderId, UsageInfo } from "./llm";

export type { DataSource };

/* ────────────────────────────── settings ────────────────────────────── */

/** Who turns text into vectors. "local" is a lexical stand-in and is labelled as such. */
export type EmbeddingProviderId = "openai" | "gemini" | "local";

/** Both index kinds are real algorithms run in the server's memory. */
export type VectorIndexKind = "flat" | "ivf";

export type RetrievalStrategy = "similarity" | "mmr" | "hybrid";

export interface RagSettings {
  /** Target chunk length in tokens (o200k_base). */
  chunkSize: number;
  /** Tokens shared between consecutive chunks. */
  chunkOverlap: number;
  embeddingProvider: EmbeddingProviderId;
  /** Model id for the embedding provider; ignored for "local". */
  embeddingModel: string;
  vectorIndex: VectorIndexKind;
  topK: number;
  /** Cosine similarity floor; candidates below it are dropped before the cut. */
  similarityThreshold: number;
  retrievalStrategy: RetrievalStrategy;
  /** Token budget for the assembled context. */
  contextBudget: number;
  llmProvider: ProviderId;
  maxOutputTokens: number;
  temperature: number;
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  chunkSize: 256,
  chunkOverlap: 40,
  embeddingProvider: "local",
  embeddingModel: "hashed-ngram-256",
  vectorIndex: "flat",
  topK: 4,
  similarityThreshold: 0.1,
  retrievalStrategy: "similarity",
  contextBudget: 1600,
  llmProvider: "claude",
  maxOutputTokens: 500,
  temperature: 0.3,
};

/** Embedding models the server knows how to call, with what it can say about each. */
export interface EmbeddingModelOption {
  provider: EmbeddingProviderId;
  model: string;
  label: string;
  dims: number;
  /** Whether a key is available so this option actually works right now. */
  configured: boolean;
  /** How this option's vectors should be labelled in the UI. */
  source: DataSource;
  note: string;
}

/* ─────────────────────────── knowledge base ─────────────────────────── */

export type DocumentKind = "pdf" | "docx" | "markdown" | "html" | "text" | "url";

export interface RagDocument {
  id: string;
  name: string;
  kind: DocumentKind;
  /** Where the bytes came from. */
  origin: "upload" | "paste" | "url";
  url?: string;
  bytes: number;
  chars: number;
  pages?: number;
  addedAt: number;
  /** How the text was pulled out, e.g. "pdf-parse (pdf.js) text layer, 12 pages". */
  extraction: string;
  /** Warnings from the extractor, such as scanned pages with no text layer. */
  warnings: string[];
}

export interface RagChunk {
  id: string;
  docId: string;
  /** 0-based position within its document. */
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  /** Tokens shared with the previous chunk (0 for the first). */
  overlapTokens: number;
  page?: number;
}

export interface EmbeddingInfo {
  provider: EmbeddingProviderId;
  model: string;
  dims: number;
  source: DataSource;
  note: string;
}

export interface IndexStats {
  kind: VectorIndexKind;
  vectors: number;
  dims: number;
  /** IVF only: how many coarse lists the vectors were clustered into. */
  lists?: number;
  /** IVF only: how many lists a query probes. */
  probes?: number;
  builtAt: number;
  buildMs: number;
}

/** What the browser knows about a knowledge base at any moment. */
export interface KnowledgeBaseSnapshot {
  id: string;
  createdAt: number;
  settings: RagSettings;
  documents: RagDocument[];
  chunks: RagChunk[];
  embedding: EmbeddingInfo | null;
  index: IndexStats | null;
  /** Total tokens across all chunks (o200k_base). */
  totalTokens: number;
  /** Real vectors are large; the snapshot carries a 2-D projection instead. */
  projection: ProjectedPoint[] | null;
  /** True once chunks or settings changed after the last index build. */
  stale: boolean;
}

/**
 * A 2-D projection (PCA) of the real vectors, so the browser can draw the space.
 * The projection is a lossy view of real data: positions are conceptual, the
 * neighbourhoods they preserve are not.
 */
export interface ProjectedPoint {
  chunkId: string;
  x: number;
  y: number;
}

/* ──────────────────────────── retrieval ─────────────────────────────── */

export interface ScoredChunk {
  chunkId: string;
  docId: string;
  /** Final rank after the strategy ran (1 = best). */
  rank: number;
  /** Score the strategy ranked by (cosine, MMR score, or fused RRF score). */
  score: number;
  /** Cosine similarity between the query vector and this chunk's vector. */
  vectorScore: number;
  /** Hybrid only: BM25 score for the lexical side. */
  lexicalScore?: number;
  /** Hybrid only: rank on each side before fusion. */
  vectorRank?: number;
  lexicalRank?: number;
  /** MMR only: how much redundancy with already-picked chunks cost this one. */
  redundancyPenalty?: number;
  /** One sentence on why this chunk ended up where it did. */
  reason: string;
  /** Query terms that appear in this chunk, for highlighting. */
  matchedTerms: string[];
}

export interface SearchReport {
  strategy: RetrievalStrategy;
  index: VectorIndexKind;
  /** How many stored vectors were actually compared against the query. */
  compared: number;
  total: number;
  /** IVF only: which coarse lists were probed. */
  probedLists?: number[];
  /** Every candidate that was scored, ordered by cosine similarity. */
  candidates: { chunkId: string; vectorScore: number }[];
  /** Candidates rejected by the threshold. */
  belowThreshold: number;
  ms: number;
}

export interface ContextPiece {
  citation: number;
  chunkId: string;
  docId: string;
  docName: string;
  page?: number;
  tokenCount: number;
  text: string;
}

export interface AssembledContext {
  pieces: ContextPiece[];
  text: string;
  tokenCount: number;
  budget: number;
  /** Chunks retrieved but left out because the budget was full. */
  dropped: ScoredChunk[];
}

export interface AssembledPrompt {
  system: string;
  user: string;
  /** o200k_base token estimate for the whole prompt. */
  tokenEstimate: number;
}

export interface Citation {
  /** The [n] marker as it appears in the answer. */
  marker: number;
  chunkId: string;
  docId: string;
  docName: string;
  page?: number;
}

/* ───────────────────────────── SSE events ───────────────────────────── */

/** Emitted while a document is being added or the index rebuilt. */
export type RagIngestEvent =
  | { type: "ingest_started"; at: number; document: { id: string; name: string; kind: DocumentKind; bytes: number } }
  | { type: "document_loaded"; at: number; docId: string; note: string }
  | { type: "text_extracted"; at: number; docId: string; chars: number; pages?: number; extraction: string; warnings: string[]; sample: string }
  | { type: "chunked"; at: number; docId: string; chunks: RagChunk[]; settings: { chunkSize: number; chunkOverlap: number } }
  | { type: "embedding_started"; at: number; count: number; embedding: EmbeddingInfo }
  | { type: "embedding_progress"; at: number; done: number; total: number }
  | { type: "embedded"; at: number; count: number; dims: number; ms: number; usage: UsageInfo | null; embedding: EmbeddingInfo; sampleVector: number[] }
  | { type: "indexed"; at: number; index: IndexStats; projection: ProjectedPoint[] }
  | { type: "ingest_completed"; at: number; snapshot: KnowledgeBaseSnapshot }
  | { type: "notice"; at: number; level: "info" | "warn"; message: string }
  | { type: "error"; at: number; message: string; status?: number; retryable: boolean };

/** Emitted while a question runs through the pipeline. */
export type RagQueryEvent =
  | { type: "query_received"; at: number; runId: string; question: string; settings: RagSettings; tokenCount: number }
  | { type: "query_embedded"; at: number; dims: number; ms: number; usage: UsageInfo | null; embedding: EmbeddingInfo; vector: number[]; projected: { x: number; y: number } | null }
  | { type: "search_started"; at: number; index: IndexStats; strategy: RetrievalStrategy }
  | { type: "search_completed"; at: number; report: SearchReport }
  | { type: "retrieved"; at: number; results: ScoredChunk[]; topK: number; threshold: number; strategy: RetrievalStrategy; explanation: string }
  | { type: "context_built"; at: number; context: AssembledContext }
  | { type: "prompt_assembled"; at: number; prompt: AssembledPrompt; provider: ProviderId; model: string }
  | { type: "llm_request_sent"; at: number }
  | { type: "llm_response_started"; at: number; ttfbMs: number; model: string | null }
  | { type: "llm_text_delta"; at: number; text: string; index: number }
  | { type: "llm_usage"; at: number; usage: UsageInfo }
  | { type: "answer_completed"; at: number; text: string; citations: Citation[]; finishReason: string; latencyMs: number; generationMs: number; model: string; totalMs: number }
  | { type: "notice"; at: number; level: "info" | "warn"; message: string }
  | { type: "error"; at: number; message: string; status?: number; retryable: boolean };

/* ─────────────────────────── request bodies ─────────────────────────── */

export interface AddTextBody {
  name: string;
  text: string;
  kind?: "text" | "markdown" | "html";
}

export interface AddUrlBody {
  url: string;
}

export interface UpdateSettingsBody {
  settings: Partial<RagSettings>;
}

export interface QueryBody {
  question: string;
  /** Overrides applied for this run only, e.g. to compare strategies. */
  settings?: Partial<RagSettings>;
}

export interface ExplainBody {
  question: string;
  /** The run to explain, when the question is about a specific answer. */
  runId?: string;
}

export interface ExplainResult {
  answer: string;
  /** "ai" when a configured LLM wrote it from the facts below; otherwise a template did. */
  source: "ai" | "heuristic";
  model?: string;
  usage?: UsageInfo | null;
  /** The verifiable facts the answer was built from. */
  facts: string[];
  /** The path one piece of information took, when a run was given. */
  trail?: InformationTrail;
}

/** Where a fact in the answer came from, hop by hop. */
export interface InformationTrail {
  runId: string;
  question: string;
  hops: {
    stage: string;
    detail: string;
    source: DataSource;
  }[];
}

export interface RagServiceStatus {
  embeddingModels: EmbeddingModelOption[];
  llmProviders: { id: ProviderId; name: string; model: string; configured: boolean }[];
  /** Upload limits so the UI can warn before sending. */
  limits: { maxUploadBytes: number; maxDocuments: number; maxChunks: number };
}

/** A completed query run kept on the server so it can be explained afterwards. */
export interface RagRunRecord {
  runId: string;
  kbId: string;
  at: number;
  question: string;
  settings: RagSettings;
  results: ScoredChunk[];
  report: SearchReport | null;
  context: AssembledContext | null;
  prompt: AssembledPrompt | null;
  answer: string;
  citations: Citation[];
  usage: UsageInfo | null;
  latencyMs: number | null;
  model: string | null;
  ok: boolean;
  error?: string;
}
