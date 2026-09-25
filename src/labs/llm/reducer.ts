import type { NodeState } from "@/types/execution";
import type { AnyLLMEvent, LLMEvent } from "./events";
import { LLM_STAGES, type LLMStageId } from "./stages";
import { NODE_ORDER } from "./layout";
import type { TimelineEntry, VisualState } from "./state";

const GENERATION_CYCLE_NODES: LLMStageId[] = [
  "transformer",
  "attention",
  "mlp",
  "logits",
  "probabilities",
  "tokenSelection",
  "nextToken",
  "loop",
];

/**
 * Pure reducer: applies one execution event to the visual state.
 * No timers, no side effects — the PlaybackController decides *when* this runs.
 */
export function applyLLMEvent(state: VisualState, event: AnyLLMEvent): VisualState {
  let next: VisualState = {
    ...state,
    nodes: { ...state.nodes },
    nodeSources: { ...state.nodeSources },
    pulses: { ...state.pulses },
    appliedEvents: state.appliedEvents + 1,
    lastEvent: event,
  };

  // Generic node/timeline bookkeeping.
  next = applyGenericTransition(next, event);

  switch (event.type) {
    case "INPUT_RECEIVED":
      return next;

    case "REQUEST_PREPARED":
      return { ...next, request: event.data };

    case "TOKENIZATION_COMPLETED":
      return { ...next, tokenization: event.data };

    case "TOKEN_IDS_COMPLETED":
      return { ...next, tokenization: event.data };

    case "TOKEN_COUNT_REPORTED":
      return {
        ...next,
        inputTokenCount: event.data,
        metrics: { ...next.metrics, inputTokenCount: event.data.count, inputTokenSource: event.data.source },
      };

    case "EMBEDDING_COMPLETED":
      return { ...next, embeddings: event.data };

    case "POSITIONAL_INFO_COMPLETED":
      return { ...next, positional: event.data };

    case "TRANSFORMER_STARTED":
      return { ...next, conceptualLayers: event.data.conceptualLayers };

    case "ATTENTION_COMPLETED":
      return { ...next, attention: event.data };

    case "MLP_COMPLETED":
      return { ...next, mlp: event.data };

    case "REQUEST_SENT":
      return next;

    case "RESPONSE_STARTED":
      return {
        ...next,
        generation: {
          ...next.generation,
          ttfbMs: event.data.ttfbMs,
          model: event.data.model,
          responseId: event.data.responseId,
        },
        metrics: { ...next.metrics, ttfbMs: event.data.ttfbMs },
      };

    case "REASONING_DELTA":
      next.nodes.transformer = "processing";
      return { ...next, generation: { ...next.generation, reasoning: next.generation.reasoning + event.data.text } };

    case "GENERATION_STARTED": {
      for (const id of GENERATION_CYCLE_NODES) next.nodes[id] = "processing";
      next.nodes.response = "processing";
      next.nodeSources.loop = "live";
      return { ...next, generation: { ...next.generation, started: true, startedAt: event.timestamp } };
    }

    case "LOGITS_STARTED":
      next.nodes.probabilities = "queued";
      return next;

    case "LOGITS_COMPLETED":
      next.nodes.probabilities = "active";
      next.nodeSources.probabilities = event.source;
      next.pulses.probabilities += 1;
      return { ...next, logits: event.data };

    case "TOKEN_SELECTION_STARTED":
      next.nodes.probabilities = "completed";
      return next;

    case "TOKEN_SELECTED":
      return { ...next, selection: event.data };

    case "TOKEN_GENERATED":
      return applyTokenGenerated(next, event);

    case "GENERATION_LOOP": {
      for (const id of GENERATION_CYCLE_NODES) next.nodes[id] = "processing";
      next.pulses.loop += 1;
      next.pulses.transformer += 1;
      return next;
    }

    case "GENERATION_COMPLETED": {
      for (const id of GENERATION_CYCLE_NODES) next.nodes[id] = "completed";
      const steps = next.generation.steps.length;
      const elapsed = next.generation.startedAt ? event.timestamp - next.generation.startedAt : 0;
      return {
        ...next,
        generation: { ...next.generation, completed: true, finishReason: event.data.finishReason },
        metrics: {
          ...next.metrics,
          finishReason: event.data.finishReason,
          tokensPerSec: elapsed > 0 ? (steps / elapsed) * 1000 : undefined,
        },
      };
    }

    case "TRANSFORMER_COMPLETED":
      return next;

    case "DETOKENIZATION_COMPLETED":
      return { ...next, detokenization: event.data };

    case "USAGE_REPORTED": {
      const u = event.data;
      const gen = next.metrics.generationMs ?? (next.generation.startedAt ? event.timestamp - next.generation.startedAt : undefined);
      return {
        ...next,
        usage: u,
        metrics: {
          ...next.metrics,
          inputTokens: u.inputTokens ?? undefined,
          outputTokens: u.outputTokens ?? undefined,
          totalTokens: u.totalTokens ?? undefined,
          reasoningTokens: u.reasoningTokens ?? null,
          tokensPerSec: u.outputTokens && gen ? (u.outputTokens / gen) * 1000 : next.metrics.tokensPerSec,
        },
      };
    }

    case "OUTPUT_COMPLETED": {
      const d = event.data;
      next.nodes.response = "completed";
      const tps = next.usage?.outputTokens && d.generationMs > 0 ? (next.usage.outputTokens / d.generationMs) * 1000 : next.metrics.tokensPerSec;
      return {
        ...next,
        completion: d,
        generation: { ...next.generation, text: d.text || next.generation.text },
        metrics: {
          ...next.metrics,
          latencyMs: d.latencyMs,
          ttfbMs: d.ttfbMs,
          generationMs: d.generationMs,
          finishReason: d.finishReason,
          outputChars: (d.text || next.generation.text).length,
          tokensPerSec: tps,
        },
      };
    }

    case "NOTICE":
      return { ...next, notices: [...next.notices, { ...event.data, at: event.timestamp }] };

    case "EXECUTION_ERROR": {
      next.nodes[event.stage] = "error";
      for (const id of NODE_ORDER) {
        if (next.nodes[id] === "processing" || next.nodes[id] === "active") next.nodes[id] = "error";
      }
      return { ...next, error: { ...event.data, stage: event.stage } };
    }

    case "EXECUTION_STOPPED": {
      for (const id of NODE_ORDER) {
        if (next.nodes[id] === "processing" || next.nodes[id] === "active" || next.nodes[id] === "queued") next.nodes[id] = "idle";
      }
      return { ...next, stopped: true };
    }

    default:
      return next;
  }
}

function applyGenericTransition(state: VisualState, event: AnyLLMEvent): VisualState {
  const stage = event.stage;
  const nodes = state.nodes;
  const sources = state.nodeSources;
  let currentStage = state.currentStage;

  switch (event.status) {
    case "started":
      nodes[stage] = nodes[stage] === "processing" ? "processing" : "active";
      sources[stage] = event.source;
      currentStage = stage;
      queueNext(nodes, stage);
      break;
    case "progress":
      if (nodes[stage] !== "error") nodes[stage] = "processing";
      sources[stage] = event.source;
      currentStage = stage;
      state.pulses[stage] += 1;
      break;
    case "completed":
      if (event.type === "TOKEN_GENERATED" || event.type === "TOKEN_SELECTED") {
        // handled by the token-generation branch: these nodes stay in the loop.
        sources[stage] = event.source;
        currentStage = stage;
        state.pulses[stage] += 1;
        nodes[stage] = "active";
      } else {
        nodes[stage] = "completed";
        sources[stage] = event.source;
        currentStage = stage;
      }
      break;
    case "error":
      currentStage = stage;
      break;
    case "info":
      // Informational events don't change node state, but they record the source of live telemetry.
      if (event.source === "live" && nodes[stage] === "idle") nodes[stage] = "queued";
      break;
  }

  return { ...state, nodes, nodeSources: sources, currentStage, timeline: updateTimeline(state.timeline, event) };
}

function queueNext(nodes: Record<LLMStageId, NodeState>, stage: LLMStageId): void {
  const idx = NODE_ORDER.indexOf(stage);
  const nextId = NODE_ORDER[idx + 1];
  if (nextId && nodes[nextId] === "idle") nodes[nextId] = "queued";
}

function applyTokenGenerated(state: VisualState, event: LLMEvent<"TOKEN_GENERATED">): VisualState {
  const d = event.data;
  const steps = [...state.generation.steps, d];
  const text = state.generation.text + d.token;
  const isDetailed = event.status === "completed";
  const nodes = state.nodes;
  nodes.nextToken = isDetailed ? "active" : "processing";
  nodes.response = "processing";
  if (!isDetailed) {
    for (const id of ["logits", "probabilities", "tokenSelection", "loop"] as LLMStageId[]) {
      if (nodes[id] !== "error") nodes[id] = "processing";
      state.pulses[id] += 1;
    }
  }
  state.pulses.response += 1;
  const elapsed = state.generation.startedAt ? event.timestamp - state.generation.startedAt : 0;
  return {
    ...state,
    logits: d.candidates ?? state.logits,
    selection: { step: d.step, token: d.token },
    generation: {
      ...state.generation,
      steps,
      text,
      detailedSteps: isDetailed ? state.generation.detailedSteps + 1 : state.generation.detailedSteps,
    },
    metrics: {
      ...state.metrics,
      streamedSteps: steps.length,
      outputChars: text.length,
      tokensPerSec: elapsed > 0 ? (steps.length / elapsed) * 1000 : state.metrics.tokensPerSec,
    },
  };
}

/** Events that fire once per generation step inside the autoregressive loop. */
const TOKEN_LOOP_TYPES = new Set(["TOKEN_GENERATED", "GENERATION_LOOP", "LOGITS_STARTED", "LOGITS_COMPLETED", "TOKEN_SELECTION_STARTED", "TOKEN_SELECTED", "REASONING_DELTA"]);
/** Subset that increments the stage's "×N" counter (one per step, not one per sub-event). */
const COUNTED_TYPES = new Set(["TOKEN_GENERATED", "LOGITS_STARTED", "TOKEN_SELECTION_STARTED", "REASONING_DELTA"]);

function updateTimeline(timeline: TimelineEntry[], event: AnyLLMEvent): TimelineEntry[] {
  if (event.type === "NOTICE") return timeline;
  const idx = timeline.findIndex((t) => t.stage === event.stage);
  const label = LLM_STAGES[event.stage].label;

  if (event.status === "error") {
    const interrupted = timeline.map((t) => (t.status === "active" && event.type === "EXECUTION_ERROR" ? { ...t, status: "error" as const, endedAt: event.timestamp } : t));
    if (idx === -1) {
      return [...interrupted, { id: event.id, stage: event.stage, label, status: "error", source: event.source, startedAt: event.timestamp, endedAt: event.timestamp, count: 1 }];
    }
    interrupted[idx] = { ...interrupted[idx]!, status: "error", endedAt: event.timestamp };
    return interrupted;
  }

  // Informational events annotate an existing entry; they never open one.
  if (event.status === "info" && idx === -1) return timeline;

  if (idx === -1) {
    const status: TimelineEntry["status"] = event.status === "completed" ? "completed" : "active";
    return [
      ...timeline,
      {
        id: event.id,
        stage: event.stage,
        label,
        status,
        source: event.source,
        startedAt: event.timestamp,
        endedAt: status === "completed" ? event.timestamp : undefined,
        count: 1,
      },
    ];
  }

  const entry = timeline[idx]!;
  const copy = [...timeline];
  if (event.type === "GENERATION_COMPLETED") {
    // Close every stage that fired inside the autoregressive loop.
    for (let i = 0; i < copy.length; i++) {
      const t = copy[i]!;
      if (GENERATION_CYCLE_NODES.includes(t.stage) && t.status === "active") copy[i] = { ...t, status: "completed", endedAt: event.timestamp };
    }
    copy[idx] = { ...copy[idx]!, status: "completed", endedAt: event.timestamp, source: event.source };
    return copy;
  }
  if (TOKEN_LOOP_TYPES.has(event.type)) {
    const done = event.status === "completed";
    copy[idx] = {
      ...entry,
      count: entry.count + (COUNTED_TYPES.has(event.type) ? 1 : 0),
      status: done ? "completed" : "active",
      endedAt: done ? event.timestamp : undefined,
      source: event.source === "live" ? "live" : entry.source,
    };
  } else if (event.status === "completed") {
    copy[idx] = { ...entry, status: "completed", endedAt: event.timestamp, source: event.source };
  } else if (event.status === "started" || event.status === "progress") {
    copy[idx] = { ...entry, status: "active", endedAt: undefined, count: entry.count + (event.status === "started" ? 1 : 0) };
  } else {
    copy[idx] = { ...entry, source: event.source === "live" ? "live" : entry.source };
  }
  return copy;
}
