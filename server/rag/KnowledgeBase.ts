import type { GenerationSettings, ProviderId, ServerEvent, UsageInfo } from "@shared/llm";
import type {
  AssembledContext,
  AssembledPrompt,
  Citation,
  DocumentKind,
  EmbeddingInfo,
  InformationTrail,
  KnowledgeBaseSnapshot,
  ProjectedPoint,
  RagChunk,
  RagDocument,
  RagIngestEvent,
  RagQueryEvent,
  RagRunRecord,
  RagSettings,
  ScoredChunk,
  SearchReport,
} from "@shared/rag";
// A value import: tsx resolves relative paths at runtime, while the @shared alias
// only ever carried type-only imports on the server.
import { DEFAULT_RAG_SETTINGS } from "../../shared/rag";
import type { ProviderRegistry } from "../providers/registry";
import { chunkText, countTokens, type PageSpan } from "./chunker";
import { assemblePrompt, buildContext, extractCitations } from "./context";
import { createEmbedder, type EmbeddingKeys } from "./embeddings";
import { extractFromBytes, extractFromUrl, type Extracted } from "./extract";
import { retrieve } from "./retrieval";
import { pca2d, projectOnto } from "./vectorMath";
import { VectorIndex } from "./vectorStore";

export const LIMITS = { maxUploadBytes: 25 * 1024 * 1024, maxDocuments: 40, maxChunks: 4000 };

export interface AddDocumentInput {
  name: string;
  origin: "upload" | "paste" | "url";
  kind?: DocumentKind;
  bytes?: Buffer;
  text?: string;
  url?: string;
}

export interface QueryDeps {
  keys: EmbeddingKeys & { anthropic?: string; anthropicWorkspace?: string };
  registry: ProviderRegistry;
  signal: AbortSignal;
}

const now = () => Date.now();

/**
 * One user's knowledge base: documents, their chunks, the vectors for those
 * chunks under the current embedding model, and the index over the vectors.
 * Everything is held in memory on this machine; nothing is written to disk.
 */
export class KnowledgeBase {
  readonly id: string;
  readonly createdAt = now();
  settings: RagSettings = { ...DEFAULT_RAG_SETTINGS };
  touchedAt = now();

  private documents = new Map<string, RagDocument>();
  private texts = new Map<string, { text: string; pageSpans?: PageSpan[] }>();
  private chunks: RagChunk[] = [];
  private vectorsById = new Map<string, number[]>();
  private embedding: EmbeddingInfo | null = null;
  private index: VectorIndex | null = null;
  private projection: ProjectedPoint[] | null = null;
  private stale = false;
  private runs = new Map<string, RagRunRecord>();
  private docCounter = 0;
  private runCounter = 0;

  constructor(id: string) {
    this.id = id;
  }

  /* ─────────────────────────── snapshot ─────────────────────────── */

  snapshot(): KnowledgeBaseSnapshot {
    return {
      id: this.id,
      createdAt: this.createdAt,
      settings: this.settings,
      documents: [...this.documents.values()],
      chunks: this.chunks,
      embedding: this.embedding,
      index: this.index?.stats ?? null,
      totalTokens: this.chunks.reduce((s, c) => s + c.tokenCount, 0),
      projection: this.projection,
      stale: this.stale,
    };
  }

  run(runId: string): RagRunRecord | undefined {
    return this.runs.get(runId);
  }

  lastRun(): RagRunRecord | undefined {
    return [...this.runs.values()].sort((a, b) => b.at - a.at)[0];
  }

  /** Changing how chunks or vectors are made means the index no longer matches; say so. */
  updateSettings(partial: Partial<RagSettings>): void {
    const before = this.settings;
    this.settings = sanitizeSettings({ ...before, ...partial });
    const rebuildKeys: (keyof RagSettings)[] = ["chunkSize", "chunkOverlap", "embeddingProvider", "embeddingModel", "vectorIndex"];
    if (this.chunks.length > 0 && rebuildKeys.some((k) => before[k] !== this.settings[k])) this.stale = true;
    this.touchedAt = now();
  }

  /* ─────────────────────────── ingestion ────────────────────────── */

  async addDocument(input: AddDocumentInput, emit: (e: RagIngestEvent) => void, keys: EmbeddingKeys, signal: AbortSignal): Promise<RagDocument> {
    if (this.documents.size >= LIMITS.maxDocuments) throw new Error(`This knowledge base already holds ${LIMITS.maxDocuments} documents.`);
    const docId = `doc-${++this.docCounter}`;
    const size = input.bytes?.length ?? Buffer.byteLength(input.text ?? "", "utf8");
    emit({ type: "ingest_started", at: now(), document: { id: docId, name: input.name, kind: input.kind ?? (input.url ? "url" : "text"), bytes: size } });

    let extracted: Extracted;
    let bytes = size;
    let finalUrl = input.url;
    if (input.url) {
      emit({ type: "document_loaded", at: now(), docId, note: `Fetching ${input.url}…` });
      const fetched = await extractFromUrl(input.url);
      extracted = fetched;
      bytes = fetched.bytes;
      finalUrl = fetched.finalUrl;
    } else if (input.bytes) {
      emit({ type: "document_loaded", at: now(), docId, note: `${formatBytes(size)} received as ${input.kind ?? "text"}.` });
      extracted = await extractFromBytes(input.bytes, input.kind ?? "text", input.name);
    } else {
      emit({ type: "document_loaded", at: now(), docId, note: `${formatBytes(size)} of pasted text.` });
      extracted = await extractFromBytes(Buffer.from(input.text ?? "", "utf8"), input.kind ?? "text", input.name);
    }
    if (!extracted.text.trim()) throw new Error("No readable text was found in that document.");

    const document: RagDocument = {
      id: docId,
      name: input.name,
      kind: extracted.kind,
      origin: input.origin,
      url: finalUrl,
      bytes,
      chars: extracted.text.length,
      pages: extracted.pages,
      addedAt: now(),
      extraction: extracted.extraction,
      warnings: extracted.warnings,
    };
    emit({
      type: "text_extracted",
      at: now(),
      docId,
      chars: extracted.text.length,
      pages: extracted.pages,
      extraction: extracted.extraction,
      warnings: extracted.warnings,
      sample: extracted.text.slice(0, 400),
    });

    const chunks = chunkText(docId, extracted.text, this.settings, extracted.pageSpans);
    if (this.chunks.length + chunks.length > LIMITS.maxChunks) throw new Error(`Adding this document would exceed ${LIMITS.maxChunks} chunks. Raise the chunk size or remove a document.`);
    emit({ type: "chunked", at: now(), docId, chunks, settings: { chunkSize: this.settings.chunkSize, chunkOverlap: this.settings.chunkOverlap } });

    // Commit the document, then embed only its chunks and rebuild the index.
    this.documents.set(docId, document);
    this.texts.set(docId, { text: extracted.text, pageSpans: extracted.pageSpans });
    this.chunks = [...this.chunks, ...chunks];
    await this.embedChunks(chunks, emit, keys, signal);
    this.buildIndex(emit);
    this.stale = false;
    this.touchedAt = now();
    emit({ type: "ingest_completed", at: now(), snapshot: this.snapshot() });
    return document;
  }

  removeDocument(docId: string): boolean {
    if (!this.documents.delete(docId)) return false;
    this.texts.delete(docId);
    for (const c of this.chunks) if (c.docId === docId) this.vectorsById.delete(c.id);
    this.chunks = this.chunks.filter((c) => c.docId !== docId);
    this.buildIndex(null);
    this.touchedAt = now();
    return true;
  }

  /** Re-chunks every document under the current settings and re-embeds everything. */
  async rebuild(emit: (e: RagIngestEvent) => void, keys: EmbeddingKeys, signal: AbortSignal): Promise<void> {
    const all: RagChunk[] = [];
    for (const [docId, source] of this.texts) {
      const chunks = chunkText(docId, source.text, this.settings, source.pageSpans);
      emit({ type: "chunked", at: now(), docId, chunks, settings: { chunkSize: this.settings.chunkSize, chunkOverlap: this.settings.chunkOverlap } });
      all.push(...chunks);
    }
    if (all.length > LIMITS.maxChunks) throw new Error(`These settings would produce ${all.length} chunks; the limit is ${LIMITS.maxChunks}. Raise the chunk size.`);
    this.chunks = all;
    this.vectorsById.clear();
    this.embedding = null;
    await this.embedChunks(all, emit, keys, signal);
    this.buildIndex(emit);
    this.stale = false;
    this.touchedAt = now();
    emit({ type: "ingest_completed", at: now(), snapshot: this.snapshot() });
  }

  private async embedChunks(chunks: RagChunk[], emit: (e: RagIngestEvent) => void, keys: EmbeddingKeys, signal: AbortSignal): Promise<void> {
    if (chunks.length === 0) return;
    const embedder = createEmbedder(this.settings.embeddingProvider, this.settings.embeddingModel, keys);
    // Mixing models in one index would make every cosine meaningless, so a model change re-embeds everything.
    if (this.embedding && (this.embedding.provider !== embedder.info.provider || this.embedding.model !== embedder.info.model)) {
      const others = this.chunks.filter((c) => !chunks.includes(c));
      chunks = [...others, ...chunks];
      this.vectorsById.clear();
      emit({ type: "notice", at: now(), level: "info", message: `Embedding model changed to ${embedder.info.model}; re-embedding all ${chunks.length} chunks so every vector is comparable.` });
    }
    emit({ type: "embedding_started", at: now(), count: chunks.length, embedding: embedder.info });
    let lastReported = 0;
    const result = await embedder.embed(
      chunks.map((c) => c.text),
      signal,
      (done, total) => {
        if (done - lastReported >= Math.max(8, Math.floor(total / 12)) || done === total) {
          lastReported = done;
          emit({ type: "embedding_progress", at: now(), done, total });
        }
      },
    );
    chunks.forEach((c, i) => this.vectorsById.set(c.id, result.vectors[i]!));
    this.embedding = result.info;
    emit({
      type: "embedded",
      at: now(),
      count: chunks.length,
      dims: result.dims,
      ms: result.ms,
      usage: result.usage,
      embedding: result.info,
      sampleVector: (result.vectors[0] ?? []).slice(0, 48),
    });
  }

  private buildIndex(emit: ((e: RagIngestEvent) => void) | null): void {
    const ids = this.chunks.map((c) => c.id).filter((id) => this.vectorsById.has(id));
    const vectors = ids.map((id) => this.vectorsById.get(id)!);
    if (vectors.length === 0) {
      this.index = null;
      this.projection = null;
      return;
    }
    this.index = new VectorIndex(this.settings.vectorIndex, ids, vectors);
    const points = pca2d(vectors);
    this.projection = ids.map((chunkId, i) => ({ chunkId, x: points[i]!.x, y: points[i]!.y }));
    emit?.({ type: "indexed", at: now(), index: this.index.stats, projection: this.projection });
  }

  /* ───────────────────────────── query ──────────────────────────── */

  async query(question: string, overrides: Partial<RagSettings> | undefined, emit: (e: RagQueryEvent) => void, deps: QueryDeps): Promise<RagRunRecord> {
    const settings = sanitizeSettings({ ...this.settings, ...(overrides ?? {}) });
    const runId = `rag-${++this.runCounter}-${now().toString(36)}`;
    const startedAt = now();
    const record: RagRunRecord = {
      runId,
      kbId: this.id,
      at: startedAt,
      question,
      settings,
      results: [],
      report: null,
      context: null,
      prompt: null,
      answer: "",
      citations: [],
      usage: null,
      latencyMs: null,
      model: null,
      ok: false,
    };
    this.runs.set(runId, record);
    if (this.runs.size > 30) this.runs.delete([...this.runs.keys()][0]!);

    try {
      emit({ type: "query_received", at: now(), runId, question, settings, tokenCount: countTokens(question) });
      if (!this.index || this.chunks.length === 0) throw new Error("Add at least one document before asking a question.");
      if (this.stale) throw new Error("Chunking or embedding settings changed since the index was built. Rebuild the index first.");

      // The query must be embedded with the same model as the chunks, whatever the overrides say.
      const embedder = createEmbedder(this.embedding!.provider, this.embedding!.model, deps.keys);
      const qe = await embedder.embed([question], deps.signal);
      const queryVector = qe.vectors[0]!;
      const projected = this.projection
        ? projectOnto(this.chunks.map((c) => this.vectorsById.get(c.id)!).filter(Boolean), this.projection.map((p) => ({ x: p.x, y: p.y })), queryVector)
        : null;
      emit({ type: "query_embedded", at: now(), dims: qe.dims, ms: qe.ms, usage: qe.usage, embedding: qe.info, vector: queryVector.slice(0, 48), projected });

      emit({ type: "search_started", at: now(), index: this.index.stats, strategy: settings.retrievalStrategy });
      const out = retrieve({
        question,
        queryVector,
        index: this.index,
        chunks: this.chunks,
        vectorsById: this.vectorsById,
        topK: settings.topK,
        threshold: settings.similarityThreshold,
        strategy: settings.retrievalStrategy,
      });
      record.results = out.results;
      record.report = out.report;
      emit({ type: "search_completed", at: now(), report: out.report });
      emit({ type: "retrieved", at: now(), results: out.results, topK: settings.topK, threshold: settings.similarityThreshold, strategy: settings.retrievalStrategy, explanation: out.explanation });

      const context = buildContext(out.results, new Map(this.chunks.map((c) => [c.id, c])), this.documents, settings.contextBudget);
      record.context = context;
      emit({ type: "context_built", at: now(), context });

      const prompt = assemblePrompt(question, context);
      record.prompt = prompt;
      const provider = deps.registry.get(settings.llmProvider);
      if (!provider) throw new Error(`Unknown LLM provider "${settings.llmProvider}".`);
      const descriptor = provider.describe();
      emit({ type: "prompt_assembled", at: now(), prompt, provider: settings.llmProvider, model: descriptor.model });

      const { answer, usage, completion } = await this.generate(provider.id, prompt, settings, context, emit, deps);
      record.answer = answer;
      record.usage = usage;
      record.latencyMs = completion?.latencyMs ?? null;
      record.model = completion?.model ?? descriptor.model;
      record.citations = extractCitations(answer, context);
      record.ok = true;
      emit({
        type: "answer_completed",
        at: now(),
        text: answer,
        citations: record.citations,
        finishReason: completion?.finishReason ?? "end_turn",
        latencyMs: completion?.latencyMs ?? now() - startedAt,
        generationMs: completion?.generationMs ?? 0,
        model: record.model,
        totalMs: now() - startedAt,
      });
    } catch (err) {
      if (deps.signal.aborted) throw err;
      record.error = err instanceof Error ? err.message : String(err);
      emit({ type: "error", at: now(), message: record.error, retryable: false });
    }
    this.touchedAt = now();
    return record;
  }

  /** Runs the configured LLM on the assembled prompt, forwarding its live events. */
  private async generate(
    providerId: ProviderId,
    prompt: AssembledPrompt,
    settings: RagSettings,
    _context: AssembledContext,
    emit: (e: RagQueryEvent) => void,
    deps: QueryDeps,
  ): Promise<{ answer: string; usage: UsageInfo | null; completion: { finishReason: string; latencyMs: number; generationMs: number; model: string } | null }> {
    const provider = deps.registry.get(providerId)!;
    let answer = "";
    let usage: UsageInfo | null = null;
    let completion: { finishReason: string; latencyMs: number; generationMs: number; model: string } | null = null;
    let index = 0;
    let failure: string | null = null;
    const generation: GenerationSettings = {
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      streaming: true,
      systemPrompt: prompt.system,
      effort: "none",
    };
    const forward = (ev: ServerEvent) => {
      switch (ev.type) {
        case "request_sent":
          emit({ type: "llm_request_sent", at: ev.at });
          break;
        case "response_started":
          emit({ type: "llm_response_started", at: ev.at, ttfbMs: ev.ttfbMs, model: ev.model });
          break;
        case "text_delta":
          answer += ev.text;
          emit({ type: "llm_text_delta", at: ev.at, text: ev.text, index: index++ });
          break;
        case "usage":
          usage = ev.usage;
          emit({ type: "llm_usage", at: ev.at, usage: ev.usage });
          break;
        case "completed":
          answer = ev.text || answer;
          completion = { finishReason: ev.finishReason, latencyMs: ev.latencyMs, generationMs: ev.generationMs, model: ev.model };
          break;
        case "notice":
          emit({ type: "notice", at: ev.at, level: ev.level, message: ev.message });
          break;
        case "error":
          failure = ev.message;
          break;
        default:
          break;
      }
    };
    await provider.run({
      message: prompt.user,
      settings: generation,
      emit: forward,
      signal: deps.signal,
      apiKeyOverride: providerId === "claude" ? deps.keys.anthropic : providerId === "openai" ? deps.keys.openai : providerId === "gemini" ? deps.keys.google : undefined,
      workspaceIdOverride: providerId === "claude" ? deps.keys.anthropicWorkspace : undefined,
    });
    if (failure) throw new Error(failure);
    return { answer, usage, completion };
  }

  /* ─────────────────────────── retrieval ────────────────────────── */

  /**
   * Retrieval without generation, for callers that bring their own model: the
   * agent lab's `rag_retrieve` tool. Same embedder, same index, same strategy
   * as a query run; nothing is recorded as a run.
   */
  async retrieve(question: string, keys: EmbeddingKeys, signal: AbortSignal, topK?: number): Promise<{ results: ScoredChunk[]; report: SearchReport; context: AssembledContext; embedding: EmbeddingInfo; embedMs: number }> {
    if (!this.index || this.chunks.length === 0) throw new Error("The knowledge base has no indexed documents.");
    if (this.stale) throw new Error("The knowledge base index is stale; rebuild it in the RAG lab first.");
    const embedder = createEmbedder(this.embedding!.provider, this.embedding!.model, keys);
    const qe = await embedder.embed([question], signal);
    const settings = this.settings;
    const out = retrieve({
      question,
      queryVector: qe.vectors[0]!,
      index: this.index,
      chunks: this.chunks,
      vectorsById: this.vectorsById,
      topK: Math.max(1, Math.min(10, topK ?? settings.topK)),
      threshold: settings.similarityThreshold,
      strategy: settings.retrievalStrategy,
    });
    const context = buildContext(out.results, new Map(this.chunks.map((c) => [c.id, c])), this.documents, settings.contextBudget);
    this.touchedAt = now();
    return { results: out.results, report: out.report, context, embedding: qe.info, embedMs: qe.ms };
  }

  /* ──────────────────────────── explain ─────────────────────────── */

  /** Verifiable statements about this knowledge base and, if asked, one run through it. */
  facts(run?: RagRunRecord): string[] {
    const s = this.settings;
    const facts: string[] = [
      `${this.documents.size} document${this.documents.size === 1 ? "" : "s"} loaded, split into ${this.chunks.length} chunks of about ${s.chunkSize} tokens with ${s.chunkOverlap} tokens of overlap.`,
    ];
    if (this.embedding) facts.push(`Chunks are embedded with ${this.embedding.model} (${this.embedding.provider}) into ${this.embedding.dims}-dimensional vectors${this.embedding.source === "simulation" ? ", a local lexical stand-in rather than a neural model" : ""}.`);
    if (this.index) {
      const st = this.index.stats;
      facts.push(st.kind === "ivf" ? `The index is IVF: ${st.vectors} vectors clustered into ${st.lists} lists; a query probes ${st.probes} of them.` : `The index is flat: every query is compared against all ${st.vectors} vectors exactly.`);
    }
    facts.push(`Retrieval uses ${s.retrievalStrategy}, keeps the top ${s.topK} above a cosine threshold of ${s.similarityThreshold}, and packs them into a ${s.contextBudget}-token context.`);
    facts.push(`The answer is generated by ${s.llmProvider} with a system prompt that restricts it to the provided passages and asks for [n] citations.`);
    if (run) {
      facts.push(`For the question "${run.question}", ${run.report?.compared ?? 0} of ${run.report?.total ?? 0} vectors were compared and ${run.results.length} chunk${run.results.length === 1 ? "" : "s"} retrieved.`);
      if (run.context) facts.push(`${run.context.pieces.length} passages (${run.context.tokenCount} tokens) went into the prompt; ${run.context.dropped.length} retrieved chunk${run.context.dropped.length === 1 ? "" : "s"} did not fit the budget.`);
      if (run.usage) facts.push(`The model read ${run.usage.inputTokens ?? "?"} tokens and wrote ${run.usage.outputTokens ?? "?"}${run.latencyMs ? ` in ${(run.latencyMs / 1000).toFixed(1)} s` : ""}.`);
      if (run.citations.length) facts.push(`The answer cited ${run.citations.length} passage${run.citations.length === 1 ? "" : "s"}: ${run.citations.map((c) => `[${c.marker}] → ${c.chunkId} (${c.docName}${c.page ? ` p.${c.page}` : ""})`).join(", ")}.`);
      else if (run.ok) facts.push("The answer contained no [n] citation markers.");
    }
    return facts;
  }

  /** How information travelled from a document to the answer in one run, hop by hop. */
  trail(run: RagRunRecord): InformationTrail {
    const chunkById = new Map(this.chunks.map((c) => [c.id, c]));
    const first = run.results[0];
    const firstChunk = first ? chunkById.get(first.chunkId) : undefined;
    const firstDoc = firstChunk ? this.documents.get(firstChunk.docId) : undefined;
    const hops: InformationTrail["hops"] = [];
    if (firstDoc) hops.push({ stage: "document", detail: `${firstDoc.name} (${firstDoc.kind}, ${firstDoc.chars.toLocaleString()} chars${firstDoc.pages ? `, ${firstDoc.pages} pages` : ""}) was loaded and its text extracted: ${firstDoc.extraction}`, source: "live" });
    if (firstChunk) hops.push({ stage: "chunk", detail: `Characters ${firstChunk.charStart}–${firstChunk.charEnd} became chunk ${firstChunk.id} (${firstChunk.tokenCount} tokens${firstChunk.page ? `, page ${firstChunk.page}` : ""}).`, source: "live" });
    if (this.embedding) hops.push({ stage: "embedding", detail: `The chunk was turned into a ${this.embedding.dims}-d vector by ${this.embedding.model} and stored in the ${this.index?.stats.kind ?? "flat"} index.`, source: this.embedding.source });
    hops.push({ stage: "query", detail: `"${run.question}" was embedded with the same model and compared against ${run.report?.compared ?? 0} stored vectors.`, source: this.embedding?.source ?? "live" });
    if (first) hops.push({ stage: "retrieval", detail: `It ranked #${first.rank} under ${run.settings.retrievalStrategy}: ${first.reason}`, source: "live" });
    const piece = run.context?.pieces.find((p) => p.chunkId === first?.chunkId);
    if (piece) hops.push({ stage: "context", detail: `It entered the prompt as passage [${piece.citation}], ${piece.tokenCount} of the ${run.context?.tokenCount ?? 0} context tokens.`, source: "live" });
    const cited = run.citations.find((c) => c.chunkId === first?.chunkId);
    hops.push({
      stage: "answer",
      detail: cited ? `The model cited it as [${cited.marker}] in its answer.` : run.ok ? "The model did not cite this passage explicitly in its answer." : "The model call did not complete.",
      source: "live",
    });
    return { runId: run.runId, question: run.question, hops };
  }
}

/* ────────────────────────────── helpers ─────────────────────────── */

export function sanitizeSettings(s: RagSettings): RagSettings {
  const clamp = (n: unknown, min: number, max: number, fallback: number) => {
    const v = typeof n === "number" ? n : Number(n);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  const chunkSize = Math.round(clamp(s.chunkSize, 32, 2048, DEFAULT_RAG_SETTINGS.chunkSize));
  return {
    chunkSize,
    chunkOverlap: Math.round(clamp(s.chunkOverlap, 0, Math.max(0, chunkSize - 8), DEFAULT_RAG_SETTINGS.chunkOverlap)),
    embeddingProvider: s.embeddingProvider === "openai" || s.embeddingProvider === "gemini" ? s.embeddingProvider : "local",
    embeddingModel: typeof s.embeddingModel === "string" ? s.embeddingModel.slice(0, 80) : DEFAULT_RAG_SETTINGS.embeddingModel,
    vectorIndex: s.vectorIndex === "ivf" ? "ivf" : "flat",
    topK: Math.round(clamp(s.topK, 1, 20, DEFAULT_RAG_SETTINGS.topK)),
    similarityThreshold: clamp(s.similarityThreshold, -1, 1, DEFAULT_RAG_SETTINGS.similarityThreshold),
    retrievalStrategy: s.retrievalStrategy === "mmr" || s.retrievalStrategy === "hybrid" ? s.retrievalStrategy : "similarity",
    contextBudget: Math.round(clamp(s.contextBudget, 200, 12000, DEFAULT_RAG_SETTINGS.contextBudget)),
    llmProvider: (["claude", "openai", "gemini", "mock"] as ProviderId[]).includes(s.llmProvider) ? s.llmProvider : "claude",
    maxOutputTokens: Math.round(clamp(s.maxOutputTokens, 16, 4096, DEFAULT_RAG_SETTINGS.maxOutputTokens)),
    temperature: clamp(s.temperature, 0, 2, DEFAULT_RAG_SETTINGS.temperature),
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Knowledge bases live for two hours after their last use, like repository analyses. */
export class KnowledgeBaseStore {
  private readonly bases = new Map<string, KnowledgeBase>();
  private counter = 0;
  private readonly ttlMs = 2 * 60 * 60 * 1000;

  create(): KnowledgeBase {
    this.sweep();
    const kb = new KnowledgeBase(`kb-${++this.counter}-${Date.now().toString(36)}`);
    this.bases.set(kb.id, kb);
    return kb;
  }

  get(id: string): KnowledgeBase | undefined {
    this.sweep();
    const kb = this.bases.get(id);
    if (kb) kb.touchedAt = Date.now();
    return kb;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, kb] of this.bases) if (kb.touchedAt < cutoff) this.bases.delete(id);
  }
}

export type { ScoredChunk, SearchReport, Citation };
