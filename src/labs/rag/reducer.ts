import type { NodeState } from "@/types/execution";
import type { AnyRagEvent } from "./events";
import { RAG_NODE_ORDER } from "./layout";
import type { RagStageId } from "./stages";
import type { RagTimelineEntry, RagVisualState } from "./state";

/**
 * Pure reducer: applies one execution event to the visual state.
 * No timers, no side effects. The PlaybackController decides when this runs,
 * so replaying the same log always draws the same thing.
 */
export function applyRagEvent(state: RagVisualState, event: AnyRagEvent): RagVisualState {
  let next: RagVisualState = {
    ...state,
    nodes: { ...state.nodes },
    nodeSources: { ...state.nodeSources },
    pulses: { ...state.pulses },
    appliedEvents: state.appliedEvents + 1,
    lastEvent: event,
  };
  next = applyGenericTransition(next, event);

  switch (event.type) {
    case "INGEST_STARTED":
      return { ...next, document: { id: event.data.docId, name: event.data.name, kind: event.data.kind, bytes: event.data.bytes } };
    case "DOCUMENT_LOADED":
      return { ...next, loadNote: event.data.note };
    case "TEXT_EXTRACTED":
      return { ...next, extraction: { chars: event.data.chars, pages: event.data.pages, extraction: event.data.extraction, warnings: event.data.warnings, sample: event.data.sample } };
    case "CHUNKED":
      return { ...next, chunks: event.data.chunks, chunkSettings: { chunkSize: event.data.chunkSize, chunkOverlap: event.data.chunkOverlap } };
    case "OVERLAP_SHOWN":
      return { ...next, overlapChunkIds: event.data.chunkIds };
    case "EMBEDDING_STARTED":
      return { ...next, embedding: event.data.embedding, embedProgress: { done: 0, total: event.data.count } };
    case "EMBEDDING_PROGRESS":
      return { ...next, embedProgress: { done: event.data.done, total: event.data.total } };
    case "EMBEDDED":
      return {
        ...next,
        embedding: event.data.embedding,
        embedProgress: { done: event.data.count, total: event.data.count },
        embedded: { count: event.data.count, dims: event.data.dims, ms: event.data.ms, usage: event.data.usage, sampleVector: event.data.sampleVector },
      };
    case "STORED":
      return { ...next, stored: { count: event.data.count, dims: event.data.dims } };
    case "INDEXED":
      return { ...next, index: event.data.index, projection: event.data.projection };
    case "INGEST_COMPLETED":
      return { ...next, chunks: event.data.snapshot.chunks.length ? next.chunks : [], index: event.data.snapshot.index ?? next.index, projection: event.data.snapshot.projection ?? next.projection };

    case "QUERY_RECEIVED":
      return { ...next, question: event.data.question, querySettings: event.data.settings, queryTokens: event.data.tokenCount };
    case "QUERY_EMBEDDED":
      return { ...next, queryEmbedding: { ...event.data }, embedding: event.data.embedding };
    case "SEARCH_STARTED":
      return { ...next, index: event.data.index, searchStrategy: event.data.strategy };
    case "SEARCH_COMPLETED":
      return { ...next, searchReport: event.data.report };
    case "TOPK_SELECTED":
      return { ...next, topK: { ...event.data } };
    case "RETRIEVED":
      return { ...next, results: event.data.results };
    case "CONTEXT_BUILT":
      return { ...next, context: event.data.context };
    case "PROMPT_ASSEMBLED":
      return { ...next, prompt: { prompt: event.data.prompt, provider: event.data.provider, model: event.data.model } };
    case "LLM_REQUEST_SENT":
      return { ...next, llm: { ...next.llm, requestSentAt: event.timestamp } };
    case "LLM_RESPONSE_STARTED":
      return { ...next, llm: { ...next.llm, ttfbMs: event.data.ttfbMs, model: event.data.model } };
    case "LLM_TEXT_DELTA":
      return { ...next, llm: { ...next.llm, text: next.llm.text + event.data.text, pieces: next.llm.pieces + 1 } };
    case "LLM_USAGE":
      return { ...next, llm: { ...next.llm, usage: event.data.usage } };
    case "ANSWER_COMPLETED":
      return {
        ...next,
        llm: {
          ...next.llm,
          text: event.data.text || next.llm.text,
          completed: true,
          finishReason: event.data.finishReason,
          latencyMs: event.data.latencyMs,
          generationMs: event.data.generationMs,
          model: event.data.model,
          totalMs: event.data.totalMs,
        },
      };
    case "CITATIONS_RESOLVED":
      return { ...next, citations: event.data.citations };

    case "NOTICE":
      return { ...next, notices: [...next.notices, { level: event.data.level, message: event.data.message, at: event.timestamp }] };
    case "EXECUTION_ERROR":
      return { ...next, error: { message: event.data.message, status: event.data.status } };
    case "EXECUTION_STOPPED":
      return { ...next, stopped: true };
  }
}

/** Node state and timeline bookkeeping shared by every event type. */
function applyGenericTransition(state: RagVisualState, event: AnyRagEvent): RagVisualState {
  const stage = event.stage;
  const nodes = state.nodes;
  const timeline = [...state.timeline];

  if (event.status !== "info") {
    // Everything before this stage that never ran is queued, so the diagram reads as a path.
    if (event.status === "started" || event.status === "progress") {
      const idx = RAG_NODE_ORDER.indexOf(stage);
      for (let i = 0; i < idx; i++) {
        const id = RAG_NODE_ORDER[i]!;
        if (nodes[id] === "idle" && sameJourney(id, stage)) nodes[id] = "queued";
      }
    }
    nodes[stage] = nodeStateFor(event.status, nodes[stage]);
    state.nodeSources[stage] = event.source;
    if (event.status === "completed") state.pulses[stage] += 1;
  }
  if (event.status === "error") {
    nodes[stage] = "error";
  }

  // Timeline: one entry per stretch of work on a stage. A stage that is still
  // open (started or in progress) absorbs later events for it even when another
  // stage's event landed in between, as when the model finishes while the
  // answer is still being streamed.
  if (event.status !== "info") {
    let openIdx = -1;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const t = timeline[i]!;
      if (t.stage === stage) {
        if (t.status !== "completed" && t.status !== "error") openIdx = i;
        break;
      }
    }
    const open = openIdx >= 0 ? timeline[openIdx] : undefined;
    if (open) {
      timeline[openIdx] = {
        ...open,
        status: event.status,
        source: event.source,
        count: open.count + 1,
        endedAt: event.status === "completed" || event.status === "error" ? event.timestamp : open.endedAt,
        label: event.status === "completed" ? event.label : open.label,
      };
    } else {
      const entry: RagTimelineEntry = {
        id: event.id,
        stage,
        label: event.label,
        status: event.status,
        source: event.source,
        startedAt: event.timestamp,
        endedAt: event.status === "completed" || event.status === "error" ? event.timestamp : undefined,
        count: 1,
      };
      timeline.push(entry);
    }
  }

  return { ...state, nodes, timeline, currentStage: event.status === "info" ? state.currentStage : stage };
}

function nodeStateFor(status: AnyRagEvent["status"], current: NodeState): NodeState {
  switch (status) {
    case "started":
      return "active";
    case "progress":
      return "processing";
    case "completed":
      return "completed";
    case "error":
      return "error";
    default:
      return current;
  }
}

/** Ingestion and query are separate journeys; queueing must not bleed across them. */
function sameJourney(a: RagStageId, b: RagStageId): boolean {
  const ingest = new Set<RagStageId>(["ingest", "load", "extract", "chunk", "overlap", "embedDocs", "vectorStore", "index"]);
  return ingest.has(a) === ingest.has(b);
}
