import type { DataSource, UsageInfo } from "@shared/llm";
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
import type { EventStatus, NodeState, PlaybackState, RunStatus } from "@/types/execution";
import type { AnyRagEvent } from "./events";
import { INGEST_STAGES, RAG_STAGE_IDS, RAG_STAGES, type RagStageId } from "./stages";

export type RagRunKind = "ingest" | "query";

export interface RagTimelineEntry {
  id: string;
  stage: RagStageId;
  label: string;
  status: EventStatus;
  source: DataSource;
  startedAt: number;
  endedAt?: number;
  /** How many events landed on this stage while it was the current one. */
  count: number;
}

/** Everything the visualizer draws for one run, rebuilt purely from applied events. */
export interface RagVisualState {
  nodes: Record<RagStageId, NodeState>;
  nodeSources: Record<RagStageId, DataSource>;
  pulses: Record<RagStageId, number>;
  currentStage: RagStageId | null;

  // ingestion
  /**
   * True when the ingestion half was filled in from the knowledge base that
   * already existed rather than from events in this run. The facts are real;
   * they simply were not produced by the run being watched.
   */
  ingestSeeded: boolean;
  /** Documents behind a seeded index. */
  seededDocuments: { id: string; name: string }[];
  document?: { id: string; name: string; kind: DocumentKind; bytes: number };
  loadNote?: string;
  extraction?: { chars: number; pages?: number; extraction: string; warnings: string[]; sample: string };
  chunks: RagChunk[];
  chunkSettings?: { chunkSize: number; chunkOverlap: number };
  overlapChunkIds: string[];
  embedding?: EmbeddingInfo;
  embedProgress?: { done: number; total: number };
  embedded?: { count: number; dims: number; ms: number; usage: UsageInfo | null; sampleVector: number[] };
  stored?: { count: number; dims: number };
  index?: IndexStats;
  projection?: ProjectedPoint[];

  // query
  question?: string;
  querySettings?: RagSettings;
  queryTokens?: number;
  queryEmbedding?: { dims: number; ms: number; usage: UsageInfo | null; embedding: EmbeddingInfo; vector: number[]; projected: { x: number; y: number } | null };
  searchStrategy?: RetrievalStrategy;
  searchReport?: SearchReport;
  topK?: { kept: number; threshold: number; belowThreshold: number; topK: number; strategy: RetrievalStrategy; explanation: string };
  results: ScoredChunk[];
  context?: AssembledContext;
  prompt?: { prompt: AssembledPrompt; provider: string; model: string };
  llm: {
    requestSentAt?: number;
    ttfbMs?: number;
    model?: string | null;
    text: string;
    pieces: number;
    usage?: UsageInfo;
    completed: boolean;
    finishReason?: string;
    latencyMs?: number;
    generationMs?: number;
    totalMs?: number;
  };
  citations: Citation[];

  notices: { level: "info" | "warn"; message: string; at: number }[];
  error?: { message: string; status?: number };
  stopped: boolean;
  timeline: RagTimelineEntry[];
  appliedEvents: number;
  lastEvent?: AnyRagEvent;
}

export interface RagRunState {
  id: string;
  kind: RagRunKind;
  /** The knowledge base as it stood when the run began, so a replay redraws the same canvas. */
  kbSnapshot?: KnowledgeBaseSnapshot | null;
  /** The document name for an ingest, the question for a query. */
  label: string;
  kbId: string;
  settings: RagSettings;
  createdAt: number;
  status: RunStatus;
  liveDone: boolean;
  log: AnyRagEvent[];
  cursor: number;
  visual: RagVisualState;
  playback: PlaybackState;
  /** Set when a query run is one half of a comparison. */
  comparisonLabel?: string;
}

function record<T>(value: T): Record<RagStageId, T> {
  return Object.fromEntries(RAG_STAGE_IDS.map((id) => [id, value])) as Record<RagStageId, T>;
}

/**
 * A run's starting canvas. Given the knowledge base a question will run
 * against, the ingestion stages start already complete: those documents really
 * were loaded, chunked, embedded and indexed, so a query run shows the whole
 * path from document to answer instead of beginning half dark. Nothing is
 * invented — every seeded value comes from the server's snapshot, and the
 * stages carry no timeline entries because no event in this run produced them.
 */
export function createRagVisualState(kb?: KnowledgeBaseSnapshot | null): RagVisualState {
  const sources = record<DataSource>("live");
  for (const id of RAG_STAGE_IDS) sources[id] = RAG_STAGES[id].defaultSource;
  const base: RagVisualState = {
    nodes: record<NodeState>("idle"),
    nodeSources: sources,
    pulses: record<number>(0),
    currentStage: null,
    ingestSeeded: false,
    seededDocuments: [],
    chunks: [],
    overlapChunkIds: [],
    results: [],
    llm: { text: "", pieces: 0, completed: false },
    citations: [],
    notices: [],
    stopped: false,
    timeline: [],
    appliedEvents: 0,
  };
  if (!kb || kb.chunks.length === 0 || !kb.index) return base;

  for (const id of INGEST_STAGES) base.nodes[id] = "completed";
  // The embedding stages inherit whatever honesty label the embedder carried.
  if (kb.embedding) {
    base.nodeSources.embedDocs = kb.embedding.source;
    base.nodeSources.embedQuery = kb.embedding.source;
  }
  return {
    ...base,
    ingestSeeded: true,
    seededDocuments: kb.documents.map((d) => ({ id: d.id, name: d.name })),
    chunks: kb.chunks,
    chunkSettings: { chunkSize: kb.settings.chunkSize, chunkOverlap: kb.settings.chunkOverlap },
    embedding: kb.embedding ?? undefined,
    stored: kb.embedding ? { count: kb.chunks.length, dims: kb.embedding.dims } : undefined,
    index: kb.index,
    projection: kb.projection ?? undefined,
  };
}

export function createRagRun(params: { id: string; kind: RagRunKind; label: string; kbId: string; settings: RagSettings; comparisonLabel?: string; kbSnapshot?: KnowledgeBaseSnapshot | null }): RagRunState {
  return {
    id: params.id,
    kind: params.kind,
    kbSnapshot: params.kbSnapshot ?? null,
    label: params.label,
    kbId: params.kbId,
    settings: params.settings,
    createdAt: Date.now(),
    status: "running",
    liveDone: false,
    log: [],
    cursor: 0,
    visual: createRagVisualState(params.kbSnapshot),
    playback: "paused",
    comparisonLabel: params.comparisonLabel,
  };
}
