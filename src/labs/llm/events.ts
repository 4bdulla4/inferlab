import type {
  DataSource,
  PreparedRequestSummary,
  TokenizationResult,
  UsageInfo,
} from "@shared/llm";
import type { ExecutionEvent } from "@/types/execution";
import type { AttentionSimulation, CandidateSet, EmbeddingSimulation } from "@/engine/simulation";
import type { LLMStageId } from "./stages";

export const LLM_EVENT_TYPES = [
  "INPUT_RECEIVED",
  "REQUEST_PREPARED",
  "TOKENIZATION_STARTED",
  "TOKENIZATION_COMPLETED",
  "TOKEN_IDS_STARTED",
  "TOKEN_IDS_COMPLETED",
  "TOKEN_COUNT_REPORTED",
  "EMBEDDING_STARTED",
  "EMBEDDING_COMPLETED",
  "POSITIONAL_INFO_STARTED",
  "POSITIONAL_INFO_COMPLETED",
  "REQUEST_SENT",
  "TRANSFORMER_STARTED",
  "ATTENTION_STARTED",
  "ATTENTION_COMPLETED",
  "MLP_STARTED",
  "MLP_COMPLETED",
  "TRANSFORMER_COMPLETED",
  "RESPONSE_STARTED",
  "REASONING_DELTA",
  "GENERATION_STARTED",
  "LOGITS_STARTED",
  "LOGITS_COMPLETED",
  "TOKEN_SELECTION_STARTED",
  "TOKEN_SELECTED",
  "TOKEN_GENERATED",
  "GENERATION_LOOP",
  "GENERATION_COMPLETED",
  "DETOKENIZATION_STARTED",
  "DETOKENIZATION_COMPLETED",
  "USAGE_REPORTED",
  "OUTPUT_COMPLETED",
  "NOTICE",
  "EXECUTION_ERROR",
  "EXECUTION_STOPPED",
] as const;

export type LLMEventType = (typeof LLM_EVENT_TYPES)[number];

export interface PositionalSimulation {
  positions: { token: string; position: number }[];
  note: string;
}

export interface MLPSimulation {
  hiddenMultiplier: number;
  activation: string;
  note: string;
}

export interface GenerationStepData {
  step: number;
  token: string;
  granularity: "token" | "chunk";
  at: number;
  candidates?: CandidateSet;
}

export interface CompletionData {
  finishReason: string;
  latencyMs: number;
  ttfbMs: number | null;
  generationMs: number;
  model: string;
  text: string;
}

export interface LLMEventDataMap {
  INPUT_RECEIVED: { text: string; chars: number };
  REQUEST_PREPARED: PreparedRequestSummary;
  TOKENIZATION_STARTED: { chars: number };
  TOKENIZATION_COMPLETED: TokenizationResult;
  TOKEN_IDS_STARTED: { count: number };
  TOKEN_IDS_COMPLETED: TokenizationResult;
  TOKEN_COUNT_REPORTED: { count: number; source: DataSource; note: string };
  EMBEDDING_STARTED: { count: number };
  EMBEDDING_COMPLETED: EmbeddingSimulation;
  POSITIONAL_INFO_STARTED: { count: number };
  POSITIONAL_INFO_COMPLETED: PositionalSimulation;
  REQUEST_SENT: { at: number };
  TRANSFORMER_STARTED: { conceptualLayers: number };
  ATTENTION_STARTED: { count: number };
  ATTENTION_COMPLETED: AttentionSimulation;
  MLP_STARTED: { count: number };
  MLP_COMPLETED: MLPSimulation;
  TRANSFORMER_COMPLETED: Record<string, never>;
  RESPONSE_STARTED: { ttfbMs: number; model: string | null; responseId: string | null };
  REASONING_DELTA: { text: string };
  GENERATION_STARTED: Record<string, never>;
  LOGITS_STARTED: { step: number };
  LOGITS_COMPLETED: CandidateSet;
  TOKEN_SELECTION_STARTED: { step: number };
  TOKEN_SELECTED: { step: number; token: string };
  TOKEN_GENERATED: GenerationStepData;
  GENERATION_LOOP: { step: number; contextLength: number };
  GENERATION_COMPLETED: { finishReason: string; steps: number };
  DETOKENIZATION_STARTED: { count: number };
  DETOKENIZATION_COMPLETED: { tokens: string[]; text: string; note: string };
  USAGE_REPORTED: UsageInfo;
  OUTPUT_COMPLETED: CompletionData;
  NOTICE: { level: "info" | "warn"; message: string };
  EXECUTION_ERROR: { message: string; status?: number; code?: string; retryable: boolean };
  EXECUTION_STOPPED: Record<string, never>;
}

/** LLM events always carry a payload, so `data` is required here. */
export type LLMEvent<T extends LLMEventType = LLMEventType> = Omit<ExecutionEvent<T, LLMStageId, LLMEventDataMap[T]>, "data"> & {
  data: LLMEventDataMap[T];
};

export type AnyLLMEvent = { [K in LLMEventType]: LLMEvent<K> }[LLMEventType];
