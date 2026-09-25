import type { UsageInfo } from "@shared/llm";
import type {
  AssembledContext,
  AssembledPrompt,
  Citation,
  DocumentKind,
  EmbeddingInfo,
  IndexStats,
  KnowledgeBaseSnapshot,
  ProjectedPoint,
  RagChunk,
  RagSettings,
  RetrievalStrategy,
  ScoredChunk,
  SearchReport,
} from "@shared/rag";
import type { ExecutionEvent } from "@/types/execution";
import type { RagStageId } from "./stages";

/**
 * The RAG lab's execution vocabulary. Every event carries `source`, inherited
 * from ExecutionEvent, saying whether its data was observed (live) or is a
 * conceptual illustration (simulation). The sequencer sets it honestly.
 */
export interface RagEventDataMap {
  // ingestion
  INGEST_STARTED: { docId: string; name: string; kind: DocumentKind; bytes: number };
  DOCUMENT_LOADED: { docId: string; note: string };
  TEXT_EXTRACTED: { docId: string; chars: number; pages?: number; extraction: string; warnings: string[]; sample: string };
  CHUNKED: { docId: string; chunks: RagChunk[]; chunkSize: number; chunkOverlap: number };
  OVERLAP_SHOWN: { docId: string; chunkIds: string[]; overlapTokens: number };
  EMBEDDING_STARTED: { count: number; embedding: EmbeddingInfo };
  EMBEDDING_PROGRESS: { done: number; total: number };
  EMBEDDED: { count: number; dims: number; ms: number; usage: UsageInfo | null; embedding: EmbeddingInfo; sampleVector: number[] };
  STORED: { count: number; dims: number };
  INDEXED: { index: IndexStats; projection: ProjectedPoint[] };
  INGEST_COMPLETED: { snapshot: KnowledgeBaseSnapshot };
  // query
  QUERY_RECEIVED: { question: string; settings: RagSettings; tokenCount: number };
  QUERY_EMBEDDED: { dims: number; ms: number; usage: UsageInfo | null; embedding: EmbeddingInfo; vector: number[]; projected: { x: number; y: number } | null };
  SEARCH_STARTED: { index: IndexStats; strategy: RetrievalStrategy };
  SEARCH_COMPLETED: { report: SearchReport };
  TOPK_SELECTED: { kept: number; threshold: number; belowThreshold: number; topK: number; strategy: RetrievalStrategy; explanation: string };
  RETRIEVED: { results: ScoredChunk[] };
  CONTEXT_BUILT: { context: AssembledContext };
  PROMPT_ASSEMBLED: { prompt: AssembledPrompt; provider: string; model: string };
  LLM_REQUEST_SENT: Record<string, never>;
  LLM_RESPONSE_STARTED: { ttfbMs: number; model: string | null };
  LLM_TEXT_DELTA: { text: string; index: number };
  LLM_USAGE: { usage: UsageInfo };
  ANSWER_COMPLETED: { text: string; finishReason: string; latencyMs: number; generationMs: number; model: string; totalMs: number };
  CITATIONS_RESOLVED: { citations: Citation[] };
  // shared
  NOTICE: { level: "info" | "warn"; message: string };
  EXECUTION_ERROR: { message: string; status?: number; retryable: boolean };
  EXECUTION_STOPPED: Record<string, never>;
}

export type RagEventType = keyof RagEventDataMap;

/** The shared envelope leaves `data` optional; every RAG event carries it, so it is required here. */
export type RagEvent<T extends RagEventType = RagEventType> = Omit<ExecutionEvent<T, RagStageId, RagEventDataMap[T]>, "data"> & { data: RagEventDataMap[T] };

export type AnyRagEvent = { [K in RagEventType]: RagEvent<K> }[RagEventType];
