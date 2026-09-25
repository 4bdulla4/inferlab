import type { ProviderId } from "./llm";
import type { AiUsage } from "./repo";

/** Everything the platform has done, recorded server-side so it survives reloads and restarts. */
export type HistoryKind = "llm_run" | "repo_analysis" | "repo_summarize" | "repo_ask" | "rag_ingest" | "rag_query" | "agent_run" | "ml_run";

export interface HistoryBase {
  id: string;
  kind: HistoryKind;
  /** ms since epoch. */
  at: number;
  ok: boolean;
  durationMs?: number;
  error?: string;
}

export interface LlmRunEntry extends HistoryBase {
  kind: "llm_run";
  provider: ProviderId;
  vendor: string;
  model: string;
  inputChars: number;
  outputChars?: number;
  streaming: boolean;
  /** Key came from the browser session rather than the server .env. */
  sessionKey: boolean;
  latencyMs?: number;
  ttfbMs?: number;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  streamedPieces?: number;
}

export interface RepoAnalysisEntry extends HistoryBase {
  kind: "repo_analysis";
  analysisId: string;
  repo: string;
  url: string;
  sha: string;
  isPrivate: boolean;
  headline: string;
  stack: string[];
  filesScanned: number;
  filesTotal: number;
  bytesRead: number;
  loc: number;
  nodes: number;
  edges: number;
  routes: number;
  models: number;
  envVars: number;
  deps: number;
  jobs: number;
  infra: number;
}

export interface RepoAiEntry extends HistoryBase {
  kind: "repo_summarize" | "repo_ask";
  analysisId: string;
  repo: string;
  model?: string;
  question?: string;
  source?: "ai" | "heuristic";
  steps?: number;
  confidence?: "high" | "medium" | "low";
  usage?: AiUsage;
}

export interface RagIngestEntry extends HistoryBase {
  kind: "rag_ingest";
  kbId: string;
  docName: string;
  docKind: string;
  origin: "upload" | "paste" | "url";
  bytes: number;
  chars: number;
  chunks: number;
  embeddingProvider: string;
  embeddingModel: string;
  dims?: number;
  embedMs?: number;
  /** Tokens the embedding API billed, when it reports them. */
  embedTokens?: number;
}

export interface RagQueryEntry extends HistoryBase {
  kind: "rag_query";
  kbId: string;
  questionChars: number;
  strategy: string;
  index: string;
  topK: number;
  retrieved: number;
  contextTokens: number;
  embeddingProvider: string;
  embeddingModel: string;
  llmProvider: ProviderId;
  vendor: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  citations: number;
}

export interface AgentRunEntry extends HistoryBase {
  kind: "agent_run";
  provider: ProviderId;
  vendor: string;
  model: string;
  /** The offline planner made the decisions; nothing it reports is model telemetry. */
  mock: boolean;
  goalChars: number;
  scenarioId: string | null;
  tools: string[];
  iterations: number;
  toolCalls: number;
  errors: number;
  retries: number;
  reason: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface MLRunEntry extends HistoryBase {
  kind: "ml_run";
  datasetName: string;
  rows: number;
  algorithm: string;
  task: "classification" | "regression";
  iterations: number;
  epochs: number;
  headlineMetric?: { name: string; value: number };
  modelId?: string;
}

export type HistoryEntry = LlmRunEntry | RepoAnalysisEntry | RepoAiEntry | RagIngestEntry | RagQueryEntry | AgentRunEntry | MLRunEntry;

/** Omit that distributes over the union, so each variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What callers pass to record(): a full entry minus the generated id. */
export type HistoryInput = DistributiveOmit<HistoryEntry, "id"> & { id?: string };

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  total: number;
}

export interface DailyBucket {
  /** YYYY-MM-DD in the server's local time. */
  date: string;
  llmRuns: number;
  analyses: number;
  questions: number;
  ragQueries: number;
  agentRuns?: number;
  tokens: number;
}

export interface RepoSummaryRow {
  repo: string;
  url: string;
  analyses: number;
  questions: number;
  lastAt: number;
  lastSha: string;
  isPrivate: boolean;
  filesScanned: number;
  nodes: number;
}

export interface ModelRow {
  model: string;
  vendor: string;
  calls: number;
  tokens: TokenTotals;
}

export interface HistoryStats {
  totals: {
    entries: number;
    llmRuns: number;
    analyses: number;
    questions: number;
    summaries: number;
    ragQueries: number;
    ragDocuments: number;
    agentRuns?: number;
    mlRuns?: number;
    errors: number;
  };
  tokens: TokenTotals;
  /** Token totals per vendor ("Anthropic", "OpenAI", …). */
  byVendor: Record<string, TokenTotals>;
  models: ModelRow[];
  repos: RepoSummaryRow[];
  daily: DailyBucket[];
  llm: {
    avgLatencyMs: number | null;
    avgTtfbMs: number | null;
    totalOutputTokens: number;
  };
  analysis: {
    avgDurationMs: number | null;
    totalFilesScanned: number;
    totalNodes: number;
  };
  firstAt: number | null;
  lastAt: number | null;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  stats: HistoryStats;
  /** Entries dropped because the log is capped. */
  truncated: boolean;
}
