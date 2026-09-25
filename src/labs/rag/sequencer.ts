import type { DataSource } from "@shared/llm";
import type { RagIngestEvent, RagQueryEvent, SearchReport } from "@shared/rag";
import type { EventStatus } from "@/types/execution";
import { PACE } from "@/labs/llm/sequencer";
import type { AnyRagEvent, RagEvent, RagEventDataMap, RagEventType } from "./events";
import { RAG_STAGES, type RagStageId } from "./stages";

/** Base dwell per event type at 1x, before the shared pace multiplier. */
const DURATION: Record<RagEventType, number> = {
  INGEST_STARTED: 500,
  DOCUMENT_LOADED: 800,
  TEXT_EXTRACTED: 1400,
  CHUNKED: 1500,
  OVERLAP_SHOWN: 1300,
  EMBEDDING_STARTED: 500,
  EMBEDDING_PROGRESS: 220,
  EMBEDDED: 1400,
  STORED: 900,
  INDEXED: 1300,
  INGEST_COMPLETED: 400,
  QUERY_RECEIVED: 700,
  QUERY_EMBEDDED: 1200,
  SEARCH_STARTED: 500,
  SEARCH_COMPLETED: 1400,
  TOPK_SELECTED: 1300,
  RETRIEVED: 1500,
  CONTEXT_BUILT: 1500,
  PROMPT_ASSEMBLED: 1200,
  LLM_REQUEST_SENT: 400,
  LLM_RESPONSE_STARTED: 500,
  LLM_TEXT_DELTA: 60,
  LLM_USAGE: 300,
  ANSWER_COMPLETED: 700,
  CITATIONS_RESOLVED: 1200,
  NOTICE: 200,
  EXECUTION_ERROR: 400,
  EXECUTION_STOPPED: 300,
};

/**
 * Turns the server's live stream into the lab's ordered execution log. Almost
 * every stage here is real work on the user's real documents, so almost every
 * event is "live". The two exceptions are labelled: the vector-database stage
 * is a concept (the store is the server's memory), and any embedding produced
 * by the local n-gram method carries the simulation label its provider gave it.
 */
export class RagEventSequencer {
  private seq = 0;
  /** The search report is needed again when the retrieved list arrives, to say how many fell below the threshold. */
  private lastReport: SearchReport | null = null;
  private answerCitations: RagEventDataMap["CITATIONS_RESOLVED"]["citations"] = [];

  constructor(private readonly runId: string) {}

  fromIngest(ev: RagIngestEvent): AnyRagEvent[] {
    switch (ev.type) {
      case "ingest_started":
        return [this.make("INGEST_STARTED", "ingest", "completed", "live", { docId: ev.document.id, name: ev.document.name, kind: ev.document.kind, bytes: ev.document.bytes }, `${ev.document.name} received`, ev.at)];
      case "document_loaded":
        return [this.make("DOCUMENT_LOADED", "load", "completed", "live", { docId: ev.docId, note: ev.note }, ev.note, ev.at)];
      case "text_extracted":
        return [
          this.make(
            "TEXT_EXTRACTED",
            "extract",
            "completed",
            "live",
            { docId: ev.docId, chars: ev.chars, pages: ev.pages, extraction: ev.extraction, warnings: ev.warnings, sample: ev.sample },
            `${ev.chars.toLocaleString()} characters${ev.pages ? ` · ${ev.pages} pages` : ""}`,
            ev.at,
          ),
        ];
      case "chunked": {
        const overlapIds = ev.chunks.slice(0, Math.min(ev.chunks.length, 6)).map((c) => c.id);
        const events: AnyRagEvent[] = [
          this.make("CHUNKED", "chunk", "completed", "live", { docId: ev.docId, chunks: ev.chunks, chunkSize: ev.settings.chunkSize, chunkOverlap: ev.settings.chunkOverlap }, `${ev.chunks.length} chunks of ~${ev.settings.chunkSize} tokens`, ev.at),
        ];
        // The shared spans are real token ranges, so this stage is live too.
        events.push(this.make("OVERLAP_SHOWN", "overlap", "completed", "live", { docId: ev.docId, chunkIds: overlapIds, overlapTokens: ev.settings.chunkOverlap }, `${ev.settings.chunkOverlap} tokens shared between neighbours`, ev.at));
        return events;
      }
      case "embedding_started":
        return [this.make("EMBEDDING_STARTED", "embedDocs", "started", ev.embedding.source, { count: ev.count, embedding: ev.embedding }, `Embedding ${ev.count} chunks with ${ev.embedding.model}`, ev.at)];
      case "embedding_progress":
        return [this.make("EMBEDDING_PROGRESS", "embedDocs", "progress", "live", { done: ev.done, total: ev.total }, `${ev.done}/${ev.total} embedded`, ev.at, undefined, true)];
      case "embedded":
        return [
          this.make("EMBEDDED", "embedDocs", "completed", ev.embedding.source, { count: ev.count, dims: ev.dims, ms: ev.ms, usage: ev.usage, embedding: ev.embedding, sampleVector: ev.sampleVector }, `${ev.count} vectors · ${ev.dims} dims · ${ev.ms} ms`, ev.at),
          // Where the vectors live is conceptual here: memory stands in for a database.
          this.make("STORED", "vectorStore", "completed", "simulation", { count: ev.count, dims: ev.dims }, `${ev.count} vectors stored in memory`, ev.at),
        ];
      case "indexed":
        return [
          this.make(
            "INDEXED",
            "index",
            "completed",
            "live",
            { index: ev.index, projection: ev.projection },
            ev.index.kind === "ivf" ? `IVF · ${ev.index.lists} lists · ${ev.index.probes} probed` : `Flat index · ${ev.index.vectors} vectors`,
            ev.at,
          ),
        ];
      case "ingest_completed":
        return [this.make("INGEST_COMPLETED", "index", "info", "live", { snapshot: ev.snapshot }, "Knowledge base updated", ev.at)];
      case "notice":
        return [this.make("NOTICE", "ingest", "info", "live", { level: ev.level, message: ev.message }, ev.message, ev.at)];
      case "error":
        return [this.make("EXECUTION_ERROR", this.lastStage, "error", "live", { message: ev.message, status: ev.status, retryable: ev.retryable }, "Error", ev.at)];
    }
  }

  fromQuery(ev: RagQueryEvent): AnyRagEvent[] {
    switch (ev.type) {
      case "query_received":
        return [this.make("QUERY_RECEIVED", "query", "completed", "live", { question: ev.question, settings: ev.settings, tokenCount: ev.tokenCount }, `${ev.tokenCount} tokens`, ev.at)];
      case "query_embedded":
        return [
          this.make(
            "QUERY_EMBEDDED",
            "embedQuery",
            "completed",
            ev.embedding.source,
            { dims: ev.dims, ms: ev.ms, usage: ev.usage, embedding: ev.embedding, vector: ev.vector, projected: ev.projected },
            `${ev.dims}-d vector · ${ev.ms} ms`,
            ev.at,
          ),
        ];
      case "search_started":
        return [this.make("SEARCH_STARTED", "search", "started", "live", { index: ev.index, strategy: ev.strategy }, `Searching ${ev.index.vectors} vectors`, ev.at)];
      case "search_completed":
        this.lastReport = ev.report;
        return [this.make("SEARCH_COMPLETED", "search", "completed", "live", { report: ev.report }, `${ev.report.compared} of ${ev.report.total} compared · ${ev.report.ms} ms`, ev.at)];
      case "retrieved": {
        const below = this.lastReport?.belowThreshold ?? 0;
        return [
          this.make(
            "TOPK_SELECTED",
            "topK",
            "completed",
            "live",
            { kept: ev.results.length, threshold: ev.threshold, belowThreshold: below, topK: ev.topK, strategy: ev.strategy, explanation: ev.explanation },
            `${ev.results.length} kept · ${below} below threshold`,
            ev.at,
          ),
          this.make("RETRIEVED", "retrieved", "completed", "live", { results: ev.results }, `${ev.results.length} passage${ev.results.length === 1 ? "" : "s"}`, ev.at),
        ];
      }
      case "context_built":
        return [
          this.make(
            "CONTEXT_BUILT",
            "context",
            "completed",
            "live",
            { context: ev.context },
            `${ev.context.pieces.length} passages · ${ev.context.tokenCount}/${ev.context.budget} tokens${ev.context.dropped.length ? ` · ${ev.context.dropped.length} dropped` : ""}`,
            ev.at,
          ),
        ];
      case "prompt_assembled":
        return [this.make("PROMPT_ASSEMBLED", "prompt", "completed", "live", { prompt: ev.prompt, provider: ev.provider, model: ev.model }, `~${ev.prompt.tokenEstimate} tokens → ${ev.model}`, ev.at)];
      case "llm_request_sent":
        return [this.make("LLM_REQUEST_SENT", "llm", "started", "live", {}, "Request sent", ev.at)];
      case "llm_response_started":
        return [this.make("LLM_RESPONSE_STARTED", "llm", "progress", "live", { ttfbMs: ev.ttfbMs, model: ev.model }, `First token after ${ev.ttfbMs} ms`, ev.at)];
      case "llm_text_delta":
        return [this.make("LLM_TEXT_DELTA", "answer", "progress", "live", { text: ev.text, index: ev.index }, `Piece ${ev.index + 1}`, ev.at, undefined, true)];
      case "llm_usage":
        return [this.make("LLM_USAGE", "llm", "info", "live", { usage: ev.usage }, `Usage: ${ev.usage.inputTokens ?? "?"} in / ${ev.usage.outputTokens ?? "?"} out`, ev.at)];
      case "answer_completed":
        this.answerCitations = ev.citations;
        return [
          this.make("ANSWER_COMPLETED", "llm", "completed", "live", { text: ev.text, finishReason: ev.finishReason, latencyMs: ev.latencyMs, generationMs: ev.generationMs, model: ev.model, totalMs: ev.totalMs }, `${ev.finishReason} · ${ev.latencyMs} ms`, ev.at),
          this.make("ANSWER_COMPLETED", "answer", "completed", "live", { text: ev.text, finishReason: ev.finishReason, latencyMs: ev.latencyMs, generationMs: ev.generationMs, model: ev.model, totalMs: ev.totalMs }, `${ev.text.length} characters`, ev.at),
          this.make("CITATIONS_RESOLVED", "citations", "completed", "live", { citations: ev.citations }, `${ev.citations.length} citation${ev.citations.length === 1 ? "" : "s"} resolved`, ev.at),
        ];
      case "notice":
        return [this.make("NOTICE", this.lastStage, "info", "live", { level: ev.level, message: ev.message }, ev.message, ev.at)];
      case "error":
        return [this.make("EXECUTION_ERROR", this.lastStage, "error", "live", { message: ev.message, status: ev.status, retryable: ev.retryable }, "Error", ev.at)];
    }
  }

  stopped(): AnyRagEvent[] {
    return [this.make("EXECUTION_STOPPED", this.lastStage, "info", "live", {}, "Stopped", Date.now())];
  }

  failed(message: string, status?: number): AnyRagEvent[] {
    return [this.make("EXECUTION_ERROR", this.lastStage, "error", "live", { message, status, retryable: false }, "Error", Date.now())];
  }

  get citations() {
    return this.answerCitations;
  }

  private lastStage: RagStageId = "ingest";

  private make<T extends RagEventType>(
    type: T,
    stage: RagStageId,
    status: EventStatus,
    source: DataSource,
    data: RagEventDataMap[T],
    label: string,
    timestamp = Date.now(),
    duration = DURATION[type],
    compressible = false,
  ): RagEvent<T> {
    if (status !== "info") this.lastStage = stage;
    const seq = this.seq++;
    return {
      id: `${this.runId}:${seq}`,
      seq,
      type,
      timestamp,
      stage,
      status,
      source,
      duration: Math.round(duration * PACE),
      compressible,
      label: label || RAG_STAGES[stage].label,
      data,
    };
  }
}
