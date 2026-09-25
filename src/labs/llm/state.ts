import type {
  DataSource,
  GenerationSettings,
  PreparedRequestSummary,
  ProviderDescriptor,
  TokenizationResult,
  UsageInfo,
} from "@shared/llm";
import type { NodeState, PlaybackState, RunStatus } from "@/types/execution";
import type { AttentionSimulation, CandidateSet, EmbeddingSimulation } from "@/engine/simulation";
import type { AnyLLMEvent, CompletionData, GenerationStepData, MLPSimulation, PositionalSimulation } from "./events";
import { LLM_STAGE_IDS, type LLMStageId } from "./stages";

export interface TimelineEntry {
  id: string;
  stage: LLMStageId;
  label: string;
  status: "active" | "completed" | "error";
  source: DataSource;
  startedAt: number;
  endedAt?: number;
  /** Number of times this stage fired (generation loop stages fire per token). */
  count: number;
}

export interface RunMetrics {
  inputChars: number;
  outputChars: number;
  streamedSteps: number;
  inputTokenCount?: number;
  inputTokenSource?: DataSource;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number | null;
  latencyMs?: number;
  ttfbMs?: number | null;
  generationMs?: number;
  finishReason?: string;
  tokensPerSec?: number;
}

export interface RunError {
  message: string;
  status?: number;
  code?: string;
  retryable: boolean;
  stage: LLMStageId;
}

export interface VisualState {
  nodes: Record<LLMStageId, NodeState>;
  /** Source of the most recent event applied to each node. */
  nodeSources: Record<LLMStageId, DataSource>;
  /** Incrementing counters used by the animation layer to fire pulses. */
  pulses: Record<LLMStageId, number>;
  currentStage: LLMStageId | null;
  request?: PreparedRequestSummary;
  tokenization?: TokenizationResult;
  inputTokenCount?: { count: number; source: DataSource; note: string };
  embeddings?: EmbeddingSimulation;
  positional?: PositionalSimulation;
  attention?: AttentionSimulation;
  mlp?: MLPSimulation;
  conceptualLayers: number;
  logits?: CandidateSet;
  selection?: { step: number; token: string };
  generation: {
    started: boolean;
    startedAt?: number;
    ttfbMs?: number;
    model?: string | null;
    responseId?: string | null;
    steps: GenerationStepData[];
    text: string;
    reasoning: string;
    detailedSteps: number;
    completed: boolean;
    finishReason?: string;
  };
  detokenization?: { tokens: string[]; text: string; note: string };
  usage?: UsageInfo;
  completion?: CompletionData;
  notices: { level: "info" | "warn"; message: string; at: number }[];
  error?: RunError;
  stopped: boolean;
  timeline: TimelineEntry[];
  metrics: RunMetrics;
  /** Number of events applied so far (mirrors run.cursor, kept for derived views). */
  appliedEvents: number;
  lastEvent?: AnyLLMEvent;
}

export interface RunState {
  id: string;
  provider: ProviderDescriptor;
  input: string;
  settings: GenerationSettings;
  createdAt: number;
  /** Status of the real execution (network), independent of playback. */
  status: RunStatus;
  liveDone: boolean;
  log: AnyLLMEvent[];
  cursor: number;
  playback: PlaybackState;
  visual: VisualState;
}

function record<T>(value: T): Record<LLMStageId, T> {
  return Object.fromEntries(LLM_STAGE_IDS.map((id) => [id, value])) as Record<LLMStageId, T>;
}

export function createVisualState(inputChars: number): VisualState {
  return {
    nodes: record<NodeState>("idle"),
    nodeSources: record<DataSource>("simulation"),
    pulses: record<number>(0),
    currentStage: null,
    conceptualLayers: 12,
    generation: {
      started: false,
      steps: [],
      text: "",
      reasoning: "",
      detailedSteps: 0,
      completed: false,
    },
    notices: [],
    stopped: false,
    timeline: [],
    metrics: { inputChars, outputChars: 0, streamedSteps: 0 },
    appliedEvents: 0,
  };
}

export function createRun(params: {
  id: string;
  provider: ProviderDescriptor;
  input: string;
  settings: GenerationSettings;
}): RunState {
  return {
    id: params.id,
    provider: params.provider,
    input: params.input,
    settings: params.settings,
    createdAt: Date.now(),
    status: "running",
    liveDone: false,
    log: [],
    cursor: 0,
    playback: "playing",
    visual: createVisualState(params.input.length),
  };
}
