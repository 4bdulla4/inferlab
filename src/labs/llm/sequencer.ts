import type { DataSource, ProviderDescriptor, ServerEvent } from "@shared/llm";
import type { EventStatus } from "@/types/execution";
import {
  candidatesFromLogprobs,
  simulateAttention,
  simulateCandidates,
  simulateEmbeddings,
} from "@/engine/simulation";
import type { AnyLLMEvent, LLMEvent, LLMEventDataMap, LLMEventType } from "./events";
import { LLM_STAGES, type LLMStageId } from "./stages";
import { getPipelineSpec, type PipelineSpec } from "./pipelines/specs";

/** Number of generation steps that get the full slow-motion 6-event cycle. */
export const DETAILED_STEPS = 3;

/**
 * How long 1x dwells on each event, in ms, before this multiplier. Raise PACE to
 * slow every stage at once rather than editing thirty-five numbers.
 */
export const PACE = 1.45;

/** Base dwell durations in ms; PACE scales all of them. */
const DURATION: Record<LLMEventType, number> = {
  INPUT_RECEIVED: 500,
  REQUEST_PREPARED: 1200,
  TOKENIZATION_STARTED: 300,
  TOKENIZATION_COMPLETED: 1600,
  TOKEN_IDS_STARTED: 250,
  TOKEN_IDS_COMPLETED: 1100,
  TOKEN_COUNT_REPORTED: 800,
  EMBEDDING_STARTED: 300,
  EMBEDDING_COMPLETED: 1500,
  POSITIONAL_INFO_STARTED: 250,
  POSITIONAL_INFO_COMPLETED: 1200,
  REQUEST_SENT: 400,
  TRANSFORMER_STARTED: 500,
  ATTENTION_STARTED: 400,
  ATTENTION_COMPLETED: 2000,
  MLP_STARTED: 300,
  MLP_COMPLETED: 1300,
  TRANSFORMER_COMPLETED: 200,
  RESPONSE_STARTED: 500,
  REASONING_DELTA: 40,
  GENERATION_STARTED: 300,
  LOGITS_STARTED: 300,
  LOGITS_COMPLETED: 1300,
  TOKEN_SELECTION_STARTED: 400,
  TOKEN_SELECTED: 900,
  TOKEN_GENERATED: 400,
  GENERATION_LOOP: 400,
  GENERATION_COMPLETED: 500,
  DETOKENIZATION_STARTED: 300,
  DETOKENIZATION_COMPLETED: 1300,
  USAGE_REPORTED: 300,
  OUTPUT_COMPLETED: 400,
  NOTICE: 200,
  EXECUTION_ERROR: 400,
  EXECUTION_STOPPED: 300,
};

const COMPACT_TOKEN_DURATION = 70;

/**
 * Translates the backend's LIVE event stream into the lab's ordered execution
 * log, interleaving the educational SIMULATION stages at the points where the
 * corresponding computation conceptually happens. Deterministic for a given
 * input, so replays are identical.
 */
export class LLMEventSequencer {
  private readonly spec: PipelineSpec;
  private seq = 0;
  private lastStage: LLMStageId = "input";
  /** Last stage touched by a LIVE event — where a provider error really belongs. */
  private lastLiveStage: LLMStageId = "input";
  private inputTokens: string[] = [];
  private generatedTokens: string[] = [];
  private step = 0;
  private tokenizationSource: DataSource = "simulation";

  constructor(
    private readonly runId: string,
    private readonly input: string,
    private readonly provider: ProviderDescriptor,
  ) {
    this.spec = getPipelineSpec(provider.id);
  }

  /** True when the active provider's pipeline includes this stage. */
  private hasStage(id: LLMStageId): boolean {
    return this.spec.stages[id] !== undefined;
  }

  begin(): AnyLLMEvent[] {
    return [
      this.make(
        "INPUT_RECEIVED",
        "input",
        "completed",
        "live",
        { text: this.input, chars: this.input.length },
        `Input received · ${this.input.length} chars → ${this.provider.name}`,
      ),
    ];
  }

  fromServer(ev: ServerEvent): AnyLLMEvent[] {
    switch (ev.type) {
      case "request_prepared":
        return [this.make("REQUEST_PREPARED", "request", "completed", "live", ev.request, `Request prepared · ${ev.request.model}`, ev.at)];

      case "tokenization": {
        const src = ev.result.source;
        this.tokenizationSource = src;
        this.inputTokens = ev.result.tokens;
        const n = ev.result.tokens.length;
        const events: AnyLLMEvent[] = [
          this.make("TOKENIZATION_STARTED", "tokenization", "started", src, { chars: this.input.length }, "Tokenizing input", ev.at),
          this.make("TOKENIZATION_COMPLETED", "tokenization", "completed", src, ev.result, `${n} tokens${ev.result.exact ? "" : " (approx.)"}`, ev.at),
          this.make("TOKEN_IDS_STARTED", "tokenIds", "started", src, { count: n }, "Looking up token ids", ev.at),
          this.make("TOKEN_IDS_COMPLETED", "tokenIds", "completed", src, ev.result, `${n} ids · ${ev.result.encoding}`, ev.at),
          this.make("EMBEDDING_STARTED", "embeddings", "started", "simulation", { count: n }, "Embedding tokens", ev.at),
          this.make("EMBEDDING_COMPLETED", "embeddings", "completed", "simulation", simulateEmbeddings(ev.result.tokens), `${n} vectors (conceptual)`, ev.at),
          this.make("POSITIONAL_INFO_STARTED", "positional", "started", "simulation", { count: n }, "Adding positional information", ev.at),
          this.make(
            "POSITIONAL_INFO_COMPLETED",
            "positional",
            "completed",
            "simulation",
            {
              positions: ev.result.tokens.map((token, position) => ({ token, position })),
              note: "Positions 0…n-1 are injected so the model can distinguish token order. The exact scheme (learned, sinusoidal or rotary) depends on the architecture.",
            },
            "Positions 0…" + (n - 1),
            ev.at,
          ),
        ];
        return events;
      }

      case "input_token_count": {
        // Claude has a dedicated counting endpoint, so it gets its own verified stage.
        const stage: LLMStageId = this.hasStage("tokenCount") ? "tokenCount" : "tokenIds";
        const status = stage === "tokenCount" ? "completed" : "info";
        return [this.make("TOKEN_COUNT_REPORTED", stage, status, ev.source, { count: ev.count, source: ev.source, note: ev.note }, `Input tokens: ${ev.count} (${ev.source})`, ev.at)];
      }

      case "request_sent": {
        const n = this.inputTokens.length;
        return [
          this.make("REQUEST_SENT", "transformer", "info", "live", { at: ev.at }, "API request dispatched", ev.at),
          this.make("TRANSFORMER_STARTED", "transformer", "started", "simulation", { conceptualLayers: 12 }, "Transformer blocks (conceptual)", ev.at),
          this.make("ATTENTION_STARTED", "attention", "started", "simulation", { count: n }, "Self-attention", ev.at),
          this.make("ATTENTION_COMPLETED", "attention", "completed", "simulation", simulateAttention(this.inputTokens), "Attention pattern (simulated)", ev.at),
          this.make("MLP_STARTED", "mlp", "started", "simulation", { count: n }, "Feed-forward network", ev.at),
          this.make(
            "MLP_COMPLETED",
            "mlp",
            "completed",
            "simulation",
            { hiddenMultiplier: 4, activation: "GELU / SwiGLU", note: "Position-wise MLP: up-projection, non-linearity, down-projection. Conceptual only." },
            "MLP (conceptual)",
            ev.at,
          ),
        ];
      }

      case "response_started":
        return [
          this.make("RESPONSE_STARTED", "transformer", "info", "live", { ttfbMs: ev.ttfbMs, model: ev.model, responseId: ev.responseId }, `First byte after ${ev.ttfbMs} ms`, ev.at),
          this.make("GENERATION_STARTED", "loop", "started", "live", {}, "Autoregressive generation", ev.at),
        ];

      case "reasoning_delta": {
        const stage: LLMStageId = this.hasStage("thinking") ? "thinking" : this.hasStage("reasoning") ? "reasoning" : "transformer";
        return [this.make("REASONING_DELTA", stage, "progress", "live", { text: ev.text }, stage === "reasoning" ? "Reasoning summary" : "Thinking (summarized)", ev.at)];
      }

      case "text_delta": {
        const step = this.step++;
        const contextTokens = [...this.inputTokens, ...this.generatedTokens];
        const candidates = ev.alternatives
          ? candidatesFromLogprobs(step, ev.alternatives)
          : simulateCandidates(step, ev.text, contextTokens);
        this.generatedTokens.push(ev.text);
        const label = ev.granularity === "token" ? `Token ${step + 1}` : `Chunk ${step + 1}`;
        if (step < DETAILED_STEPS) {
          return [
            this.make("LOGITS_STARTED", "logits", "started", candidates.source, { step }, "Scoring candidates", ev.at),
            this.make("LOGITS_COMPLETED", "logits", "completed", candidates.source, candidates, `Candidates (${candidates.source})`, ev.at),
            this.make("TOKEN_SELECTION_STARTED", "tokenSelection", "started", candidates.source, { step }, "Selecting token", ev.at),
            this.make("TOKEN_SELECTED", "tokenSelection", "completed", "live", { step, token: ev.text }, `Selected ${JSON.stringify(ev.text)}`, ev.at),
            this.make("TOKEN_GENERATED", "nextToken", "completed", "live", { step, token: ev.text, granularity: ev.granularity, at: ev.at, candidates }, label, ev.at),
            this.make("GENERATION_LOOP", "loop", "progress", "live", { step, contextLength: contextTokens.length + 1 }, `Context → ${contextTokens.length + 1} tokens`, ev.at),
          ];
        }
        return [
          this.make(
            "TOKEN_GENERATED",
            "nextToken",
            "progress",
            "live",
            { step, token: ev.text, granularity: ev.granularity, at: ev.at, candidates },
            label,
            ev.at,
            COMPACT_TOKEN_DURATION,
          ),
        ];
      }

      case "usage": {
        const events: AnyLLMEvent[] = [];
        if (ev.usage.reasoningTokens && this.hasStage("reasoning")) {
          events.push(
            this.make(
              "REASONING_DELTA",
              "reasoning",
              "completed",
              "live",
              { text: "" },
              `${ev.usage.reasoningTokens} hidden reasoning tokens (billed as output)`,
              ev.at,
            ),
          );
        }
        events.push(this.make("USAGE_REPORTED", "response", "info", "live", ev.usage, `Usage: ${ev.usage.inputTokens ?? "?"} in / ${ev.usage.outputTokens ?? "?"} out`, ev.at));
        return events;
      }

      case "completed": {
        const outTokens = this.generatedTokens;
        return [
          this.make("GENERATION_COMPLETED", "loop", "completed", "live", { finishReason: ev.finishReason, steps: this.step }, `Generation complete · ${ev.finishReason}`, ev.at),
          this.make("TRANSFORMER_COMPLETED", "transformer", "completed", "simulation", {}, "Transformer idle", ev.at),
          this.make("DETOKENIZATION_STARTED", "detokenization", "started", "simulation", { count: outTokens.length }, "Detokenizing", ev.at),
          this.make(
            "DETOKENIZATION_COMPLETED",
            "detokenization",
            "completed",
            "simulation",
            { tokens: outTokens, text: ev.text, note: "The API already returns text; this stage visualizes the provider-side token→text step." },
            `${outTokens.length} pieces → ${ev.text.length} chars`,
            ev.at,
          ),
          this.make(
            "OUTPUT_COMPLETED",
            "response",
            "completed",
            "live",
            { finishReason: ev.finishReason, latencyMs: ev.latencyMs, ttfbMs: ev.ttfbMs, generationMs: ev.generationMs, model: ev.model, text: ev.text },
            `Response complete · ${ev.latencyMs} ms`,
            ev.at,
          ),
        ];
      }

      case "notice":
        return [this.make("NOTICE", this.lastStage, "info", "live", { level: ev.level, message: ev.message }, ev.message, ev.at)];

      case "error":
        return this.failed(ev.message, ev.status, ev.code, ev.retryable, ev.at);
    }
  }

  failed(message: string, status?: number, code?: string, retryable = false, at = Date.now()): AnyLLMEvent[] {
    return [this.make("EXECUTION_ERROR", this.lastLiveStage, "error", "live", { message, status, code, retryable }, `Error: ${message}`, at)];
  }

  stopped(): AnyLLMEvent[] {
    return [this.make("EXECUTION_STOPPED", this.lastLiveStage, "error", "live", {}, "Stopped by user")];
  }

  get tokenizationDataSource(): DataSource {
    return this.tokenizationSource;
  }

  private make<T extends LLMEventType>(
    type: T,
    stage: LLMStageId,
    status: EventStatus,
    source: DataSource,
    data: LLMEventDataMap[T],
    label: string,
    timestamp = Date.now(),
    duration = DURATION[type],
  ): LLMEvent<T> {
    duration = Math.round(duration * PACE);
    if (status !== "info") this.lastStage = stage;
    if (source === "live" && type !== "NOTICE" && status !== "error") this.lastLiveStage = stage;
    const seq = this.seq++;
    // One event per streamed token or reasoning delta: repetitive, and the only
    // thing playback may fast-forward through to catch a live stream.
    const compressible = type === "REASONING_DELTA" || (type === "TOKEN_GENERATED" && status === "progress");
    return {
      id: `${this.runId}:${seq}`,
      seq,
      type,
      timestamp,
      stage,
      status,
      source,
      duration,
      compressible,
      label: label || LLM_STAGES[stage].label,
      data,
    };
  }
}

/** Convenience for the provider-specific tokenization source label. */
export function tokenizationSourceFor(provider: ProviderDescriptor): DataSource {
  return provider.capabilities.exactTokenizer ? "live" : "simulation";
}
