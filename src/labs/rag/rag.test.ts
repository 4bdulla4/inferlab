import { describe, expect, it } from "vitest";
import type { RagIngestEvent, RagQueryEvent, ScoredChunk, SearchReport } from "@shared/rag";
import type { KnowledgeBaseSnapshot } from "@shared/rag";
import { DEFAULT_RAG_SETTINGS } from "@shared/rag";
import { RAG_CONNECTIONS, RAG_NODES, RAG_NODE_ORDER } from "./layout";
import { applyRagEvent } from "./reducer";
import { RagEventSequencer } from "./sequencer";
import { INGEST_STAGES, QUERY_STAGES, RAG_STAGE_IDS, RAG_STAGES } from "./stages";
import { createRagVisualState } from "./state";

const at = 1_700_000_000_000;

const report: SearchReport = { strategy: "similarity", index: "flat", compared: 12, total: 12, candidates: [{ chunkId: "d-1:c0", vectorScore: 0.8 }, { chunkId: "d-1:c1", vectorScore: 0.05 }], belowThreshold: 1, ms: 3 };
const results: ScoredChunk[] = [{ chunkId: "d-1:c0", docId: "d-1", rank: 1, score: 0.8, vectorScore: 0.8, reason: "top", matchedTerms: ["sky"] }];

function queryStream(): RagQueryEvent[] {
  const embedding = { provider: "local" as const, model: "hashed-ngram-256", dims: 256, source: "simulation" as const, note: "" };
  return [
    { type: "query_received", at, runId: "r", question: "why is the sky blue", settings: DEFAULT_RAG_SETTINGS, tokenCount: 5 },
    { type: "query_embedded", at, dims: 256, ms: 1, usage: null, embedding, vector: [0.1, 0.2], projected: { x: 0.1, y: -0.2 } },
    { type: "search_started", at, index: { kind: "flat", vectors: 12, dims: 256, builtAt: at, buildMs: 1 }, strategy: "similarity" },
    { type: "search_completed", at, report },
    { type: "retrieved", at, results, topK: 4, threshold: 0.1, strategy: "similarity", explanation: "ranked" },
    { type: "context_built", at, context: { pieces: [{ citation: 1, chunkId: "d-1:c0", docId: "d-1", docName: "sky.txt", tokenCount: 40, text: "Blue scatters." }], text: "[1] sky.txt\nBlue scatters.", tokenCount: 46, budget: 1600, dropped: [] } },
    { type: "prompt_assembled", at, prompt: { system: "s", user: "u", tokenEstimate: 60 }, provider: "mock", model: "mock-demo-1" },
    { type: "llm_request_sent", at },
    { type: "llm_response_started", at, ttfbMs: 120, model: "mock-demo-1" },
    { type: "llm_text_delta", at, text: "Blue ", index: 0 },
    { type: "llm_text_delta", at, text: "scatters [1].", index: 1 },
    { type: "llm_usage", at, usage: { inputTokens: 60, outputTokens: 5, totalTokens: 65 } },
    { type: "answer_completed", at, text: "Blue scatters [1].", citations: [{ marker: 1, chunkId: "d-1:c0", docId: "d-1", docName: "sky.txt" }], finishReason: "end_turn", latencyMs: 400, generationMs: 280, model: "mock-demo-1", totalMs: 450 },
  ];
}

describe("RAG sequencer", () => {
  it("walks the query stages in order with unique, increasing seq", () => {
    const seq = new RagEventSequencer("run-1");
    const events = queryStream().flatMap((e) => seq.fromQuery(e));
    events.forEach((e, i) => expect(e.seq).toBe(i));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const stages = events.filter((e) => e.status !== "info").map((e) => e.stage);
    const order = ["query", "embedQuery", "search", "topK", "retrieved", "context", "prompt", "llm", "answer", "citations"];
    let last = -1;
    for (const s of order) {
      const idx = stages.indexOf(s as never);
      expect(idx, s).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("derives the top-K cut from the search report and labels every real stage live", () => {
    const seq = new RagEventSequencer("run-1");
    const events = queryStream().flatMap((e) => seq.fromQuery(e));
    const topk = events.find((e) => e.type === "TOPK_SELECTED");
    expect(topk?.data).toMatchObject({ kept: 1, belowThreshold: 1, topK: 4 });
    for (const e of events) if (e.stage !== "embedQuery") expect(e.source, e.type).toBe("live");
    // The local embedding carries its provider's honesty label through.
    expect(events.find((e) => e.type === "QUERY_EMBEDDED")?.source).toBe("simulation");
  });

  it("marks only streamed text and embedding progress as compressible", () => {
    const seq = new RagEventSequencer("run-1");
    const events = queryStream().flatMap((e) => seq.fromQuery(e));
    for (const e of events) expect(e.compressible, e.type).toBe(e.type === "LLM_TEXT_DELTA");
    const ing = new RagEventSequencer("run-2");
    const prog = ing.fromIngest({ type: "embedding_progress", at, done: 3, total: 10 })[0]!;
    expect(prog.compressible).toBe(true);
    expect(prog.status).toBe("progress");
  });

  it("labels the vector database stage as conceptual and everything else in ingestion as live", () => {
    const seq = new RagEventSequencer("run-3");
    const embedding = { provider: "openai" as const, model: "text-embedding-3-small", dims: 1536, source: "live" as const, note: "" };
    const stream: RagIngestEvent[] = [
      { type: "ingest_started", at, document: { id: "d-1", name: "a.pdf", kind: "pdf", bytes: 10 } },
      { type: "document_loaded", at, docId: "d-1", note: "pdf" },
      { type: "text_extracted", at, docId: "d-1", chars: 100, pages: 1, extraction: "x", warnings: [], sample: "s" },
      { type: "chunked", at, docId: "d-1", chunks: [], settings: { chunkSize: 256, chunkOverlap: 40 } },
      { type: "embedding_started", at, count: 1, embedding },
      { type: "embedded", at, count: 1, dims: 1536, ms: 5, usage: null, embedding, sampleVector: [] },
      { type: "indexed", at, index: { kind: "flat", vectors: 1, dims: 1536, builtAt: at, buildMs: 0 }, projection: [] },
    ];
    const events = stream.flatMap((e) => seq.fromIngest(e));
    const stored = events.find((e) => e.type === "STORED");
    expect(stored?.stage).toBe("vectorStore");
    expect(stored?.source).toBe("simulation");
    for (const e of events) if (e.type !== "STORED") expect(e.source, e.type).toBe("live");
    expect(events.some((e) => e.type === "OVERLAP_SHOWN")).toBe(true);
  });
});

describe("RAG reducer", () => {
  it("replays a full query into a completed visual state with the answer and citations", () => {
    const seq = new RagEventSequencer("run-1");
    const events = queryStream().flatMap((e) => seq.fromQuery(e));
    const state = events.reduce(applyRagEvent, createRagVisualState());
    expect(state.question).toBe("why is the sky blue");
    expect(state.results.length).toBe(1);
    expect(state.llm.text).toBe("Blue scatters [1].");
    expect(state.llm.completed).toBe(true);
    expect(state.citations[0]?.chunkId).toBe("d-1:c0");
    for (const s of ["query", "embedQuery", "search", "topK", "retrieved", "context", "prompt", "llm", "answer", "citations"] as const) expect(state.nodes[s], s).toBe("completed");
    // Ingestion stages were not part of this run and must stay untouched.
    expect(state.nodes.chunk).toBe("idle");
    expect(state.appliedEvents).toBe(events.length);
  });

  it("merges streamed pieces into one timeline entry instead of one row per token", () => {
    const seq = new RagEventSequencer("run-1");
    const events = queryStream().flatMap((e) => seq.fromQuery(e));
    const state = events.reduce(applyRagEvent, createRagVisualState());
    const answerRows = state.timeline.filter((t) => t.stage === "answer");
    expect(answerRows.length).toBe(1);
    expect(answerRows[0]!.count).toBeGreaterThanOrEqual(2);
    expect(answerRows[0]!.status).toBe("completed");
  });

  it("queues earlier stages of the same journey and marks errors", () => {
    const seq = new RagEventSequencer("run-1");
    const state = seq.fromQuery({ type: "search_started", at, index: { kind: "flat", vectors: 1, dims: 2, builtAt: at, buildMs: 0 }, strategy: "mmr" }).reduce(applyRagEvent, createRagVisualState());
    expect(state.nodes.search).toBe("active");
    expect(state.nodes.query).toBe("queued");
    expect(state.nodes.ingest).toBe("idle");
    const failed = seq.failed("boom", 500).reduce(applyRagEvent, state);
    expect(failed.nodes.search).toBe("error");
    expect(failed.error?.message).toBe("boom");
  });
});

describe("RAG layout", () => {
  it("draws every stage exactly once and every connection between known nodes", () => {
    expect(RAG_NODES.map((n) => n.id).sort()).toEqual([...RAG_STAGE_IDS].sort());
    expect(RAG_NODE_ORDER.length).toBe(RAG_STAGE_IDS.length);
    const ids = new Set(RAG_NODES.map((n) => n.id));
    for (const c of RAG_CONNECTIONS) {
      expect(ids.has(c.from), c.id).toBe(true);
      expect(ids.has(c.to), c.id).toBe(true);
      expect(c.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(RAG_CONNECTIONS.some((c) => c.kind === "feed" && c.from === "index" && c.to === "search")).toBe(true);
  });

  it("gives every stage a definition with both explanation levels and a source note", () => {
    for (const id of RAG_STAGE_IDS) {
      const d = RAG_STAGES[id];
      expect(d.beginner.length).toBeGreaterThan(10);
      expect(d.advanced.length).toBeGreaterThan(10);
      expect(d.sourceNote.length).toBeGreaterThan(10);
    }
  });
});

describe("query canvas seeding", () => {
  const snapshot = (over: Partial<KnowledgeBaseSnapshot> = {}): KnowledgeBaseSnapshot => ({
    id: "kb-1",
    createdAt: at,
    settings: { ...DEFAULT_RAG_SETTINGS, chunkSize: 128, chunkOverlap: 20 },
    documents: [{ id: "d-1", name: "sky.txt", kind: "text", origin: "paste", bytes: 100, chars: 90, addedAt: at, extraction: "utf-8", warnings: [] }],
    chunks: [{ id: "d-1:c0", docId: "d-1", index: 0, text: "Blue scatters.", charStart: 0, charEnd: 14, tokenCount: 4, overlapTokens: 0 }],
    embedding: { provider: "openai", model: "text-embedding-3-small", dims: 1536, source: "live", note: "" },
    index: { kind: "flat", vectors: 1, dims: 1536, builtAt: at, buildMs: 1 },
    totalTokens: 4,
    projection: [{ chunkId: "d-1:c0", x: 0, y: 0 }],
    stale: false,
    ...over,
  });

  it("starts a query with the ingestion half already complete, from real snapshot values", () => {
    const v = createRagVisualState(snapshot());
    for (const id of INGEST_STAGES) expect(v.nodes[id], id).toBe("completed");
    for (const id of QUERY_STAGES) expect(v.nodes[id], id).toBe("idle");
    expect(v.ingestSeeded).toBe(true);
    expect(v.seededDocuments).toEqual([{ id: "d-1", name: "sky.txt" }]);
    expect(v.chunks.length).toBe(1);
    expect(v.chunkSettings).toEqual({ chunkSize: 128, chunkOverlap: 20 });
    expect(v.index?.kind).toBe("flat");
    expect(v.projection?.length).toBe(1);
    // Nothing in this run produced these stages, so the event log stays empty.
    expect(v.timeline).toEqual([]);
    expect(v.appliedEvents).toBe(0);
    // No timing is invented for work this run did not do.
    expect(v.embedded).toBeUndefined();
  });

  it("inherits the embedding's honesty label onto both embedding stages", () => {
    const live = createRagVisualState(snapshot());
    expect(live.nodeSources.embedDocs).toBe("live");
    expect(live.nodeSources.embedQuery).toBe("live");
    const local = createRagVisualState(snapshot({ embedding: { provider: "local", model: "hashed-ngram-256", dims: 256, source: "simulation", note: "" } }));
    expect(local.nodeSources.embedDocs).toBe("simulation");
    expect(local.nodeSources.embedQuery).toBe("simulation");
    // The vector database stage stays conceptual whatever the embedder was.
    expect(local.nodeSources.vectorStore).toBe("simulation");
  });

  it("seeds nothing when there is no index to run against", () => {
    for (const kb of [undefined, null, snapshot({ chunks: [] }), snapshot({ index: null })]) {
      const v = createRagVisualState(kb);
      expect(v.ingestSeeded).toBe(false);
      for (const id of INGEST_STAGES) expect(v.nodes[id], id).toBe("idle");
    }
  });

  it("lights the whole pipeline once a query replays over a seeded canvas", () => {
    const seq = new RagEventSequencer("run-1");
    const events = queryStream().flatMap((e) => seq.fromQuery(e));
    const state = events.reduce(applyRagEvent, createRagVisualState(snapshot()));
    for (const id of RAG_STAGE_IDS) expect(state.nodes[id], id).toBe("completed");
    expect(state.llm.text).toBe("Blue scatters [1].");
    expect(state.citations[0]?.chunkId).toBe("d-1:c0");
  });
});
