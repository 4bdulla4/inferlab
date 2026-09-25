import express, { Router, type Request, type Response } from "express";
import type { ProviderId, UsageInfo } from "@shared/llm";
import type { AddTextBody, AddUrlBody, ExplainBody, ExplainResult, QueryBody, RagIngestEvent, RagQueryEvent, RagServiceStatus, RagSettings, UpdateSettingsBody } from "@shared/rag";
import type { ServerConfig } from "../lib/config";
import type { HistoryStore } from "../lib/history";
import { readSessionKeys } from "../lib/sessionKeys";
import { SSEWriter } from "../lib/sse";
import type { ProviderRegistry } from "../providers/registry";
import { embeddingOptions, type EmbeddingKeys } from "../rag/embeddings";
import { detectKind } from "../rag/extract";
import { KnowledgeBaseStore, LIMITS, type KnowledgeBase } from "../rag/KnowledgeBase";
import { sanitize } from "./llm";

const MAX_PASTE_CHARS = 2_000_000;
const MAX_QUESTION_CHARS = 2000;

interface Deps {
  getConfig: () => ServerConfig;
  getRegistry: () => ProviderRegistry;
  history?: HistoryStore;
  /** Shared with the agent lab, whose retrieval tool searches the same knowledge bases. */
  store?: KnowledgeBaseStore;
}

/** Keys for this request: the browser's session keys win over the server's .env. */
function keysFor(req: Request, config: ServerConfig): EmbeddingKeys & { anthropic?: string; anthropicWorkspace?: string } {
  const session = readSessionKeys(req);
  return {
    openai: session.openai ?? config.openai.apiKey,
    google: session.google ?? config.google.apiKey,
    anthropic: session.anthropic,
    anthropicWorkspace: session.anthropicWorkspace,
  };
}

export function createRagRouter({ getConfig, getRegistry, history, store = new KnowledgeBaseStore() }: Deps): Router {
  const router = Router();

  const load = (req: Request, res: Response): KnowledgeBase | null => {
    const kb = store.get(String(req.params.id));
    if (!kb) {
      res.status(404).json({ error: "That knowledge base has expired or does not exist. Create a new one." });
      return null;
    }
    return kb;
  };

  router.get("/status", (req, res) => {
    const config = getConfig();
    const keys = keysFor(req, config);
    const providers = getRegistry().describeAll();
    const status: RagServiceStatus = {
      embeddingModels: embeddingOptions(keys),
      llmProviders: providers.map((p) => ({ id: p.id, name: p.name, model: p.model, configured: p.configured || Boolean(sessionKeyFor(p.id, keys)) })),
      limits: LIMITS,
    };
    res.json(status);
  });

  router.post("/kb", (_req, res) => {
    const kb = store.create();
    res.json({ snapshot: kb.snapshot() });
  });

  router.get("/kb/:id", (req, res) => {
    const kb = load(req, res);
    if (kb) res.json({ snapshot: kb.snapshot() });
  });

  router.patch("/kb/:id/settings", express.json({ limit: "32kb" }), (req, res) => {
    const kb = load(req, res);
    if (!kb) return;
    const body = req.body as UpdateSettingsBody | undefined;
    if (!body || typeof body.settings !== "object") {
      res.status(400).json({ error: "Body must be { settings }." });
      return;
    }
    kb.updateSettings(body.settings);
    res.json({ snapshot: kb.snapshot() });
  });

  /**
   * Adds a document. JSON bodies carry pasted text or a URL; anything else is
   * treated as the raw bytes of an uploaded file, with the name and type in the
   * query string. Progress streams back as SSE.
   */
  router.post(
    "/kb/:id/documents",
    express.json({ limit: "6mb", type: "application/json" }),
    express.raw({ type: (req) => !(req.headers["content-type"] ?? "").includes("application/json"), limit: LIMITS.maxUploadBytes }),
    async (req, res) => {
      const kb = load(req, res);
      if (!kb) return;
      const isJson = (req.headers["content-type"] ?? "").includes("application/json");
      let input: Parameters<KnowledgeBase["addDocument"]>[0];
      if (isJson) {
        const body = req.body as Partial<AddTextBody & AddUrlBody>;
        if (typeof body.url === "string" && body.url.trim()) {
          input = { name: body.url.trim().replace(/^https?:\/\//, "").slice(0, 120), origin: "url", url: body.url.trim() };
        } else if (typeof body.text === "string" && body.text.trim()) {
          if (body.text.length > MAX_PASTE_CHARS) {
            res.status(400).json({ error: `Pasted text is limited to ${MAX_PASTE_CHARS.toLocaleString()} characters.` });
            return;
          }
          const kind = body.kind === "markdown" || body.kind === "html" ? body.kind : "text";
          input = { name: (typeof body.name === "string" && body.name.trim()) || "Pasted text", origin: "paste", kind, text: body.text };
        } else {
          res.status(400).json({ error: "Send { text, name } or { url }." });
          return;
        }
      } else {
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (bytes.length === 0) {
          res.status(400).json({ error: "The upload was empty." });
          return;
        }
        const name = String(req.query.name ?? "upload").slice(0, 160);
        input = { name, origin: "upload", kind: detectKind(String(req.query.type ?? req.headers["content-type"] ?? ""), name), bytes };
      }

      const sse = new SSEWriter<RagIngestEvent>(res);
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      const startedAt = Date.now();
      const config = getConfig();
      // Held in an object: assignments inside the emit closure are invisible to
      // TypeScript's narrowing, which would otherwise type these as never.
      const seen: { embedded: { count: number; dims: number; ms: number; usage: UsageInfo | null; model: string; provider: string } | null; chunks: number } = { embedded: null, chunks: 0 };
      const emit = (e: RagIngestEvent) => {
        if (e.type === "embedded") seen.embedded = { count: e.count, dims: e.dims, ms: e.ms, usage: e.usage, model: e.embedding.model, provider: e.embedding.provider };
        if (e.type === "chunked") seen.chunks = e.chunks.length;
        sse.send(e);
      };
      console.log(`[api] rag ingest ${kb.id} ${input.origin} (${input.bytes?.length ?? input.text?.length ?? 0} bytes)`);
      let failure: string | undefined;
      let doc: Awaited<ReturnType<KnowledgeBase["addDocument"]>> | undefined;
      try {
        doc = await kb.addDocument(input, emit, keysFor(req, config), abort.signal);
      } catch (err) {
        if (!abort.signal.aborted) {
          failure = err instanceof Error ? err.message : String(err);
          emit({ type: "error", at: Date.now(), message: sanitize(failure), retryable: false });
        }
      } finally {
        sse.end();
        history?.record({
          kind: "rag_ingest",
          at: startedAt,
          ok: !failure,
          error: failure,
          durationMs: Date.now() - startedAt,
          kbId: kb.id,
          docName: input.name,
          docKind: doc?.kind ?? input.kind ?? "text",
          origin: input.origin,
          bytes: doc?.bytes ?? input.bytes?.length ?? 0,
          chars: doc?.chars ?? 0,
          chunks: seen.chunks,
          embeddingProvider: seen.embedded?.provider ?? kb.settings.embeddingProvider,
          embeddingModel: seen.embedded?.model ?? kb.settings.embeddingModel,
          dims: seen.embedded?.dims,
          embedMs: seen.embedded?.ms,
          embedTokens: seen.embedded?.usage?.inputTokens ?? undefined,
        });
      }
    },
  );

  router.delete("/kb/:id/documents/:docId", (req, res) => {
    const kb = load(req, res);
    if (!kb) return;
    if (!kb.removeDocument(String(req.params.docId))) {
      res.status(404).json({ error: "No such document." });
      return;
    }
    res.json({ snapshot: kb.snapshot() });
  });

  router.post("/kb/:id/rebuild", async (req, res) => {
    const kb = load(req, res);
    if (!kb) return;
    const sse = new SSEWriter<RagIngestEvent>(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      await kb.rebuild((e) => sse.send(e), keysFor(req, getConfig()), abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) sse.send({ type: "error", at: Date.now(), message: sanitize(err instanceof Error ? err.message : String(err)), retryable: false });
    } finally {
      sse.end();
    }
  });

  router.post("/kb/:id/query", express.json({ limit: "32kb" }), async (req, res) => {
    const kb = load(req, res);
    if (!kb) return;
    const body = req.body as Partial<QueryBody> | undefined;
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) {
      res.status(400).json({ error: "A question is required." });
      return;
    }
    if (question.length > MAX_QUESTION_CHARS) {
      res.status(400).json({ error: `Questions are limited to ${MAX_QUESTION_CHARS} characters.` });
      return;
    }
    const overrides = body?.settings && typeof body.settings === "object" ? (body.settings as Partial<RagSettings>) : undefined;
    const sse = new SSEWriter<RagQueryEvent>(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const startedAt = Date.now();
    console.log(`[api] rag query ${kb.id} (${question.length} chars, ${overrides ? "with overrides" : "kb settings"})`);
    let record: Awaited<ReturnType<KnowledgeBase["query"]>> | undefined;
    try {
      record = await kb.query(question, overrides, (e) => sse.send(e), { keys: keysFor(req, getConfig()), registry: getRegistry(), signal: abort.signal });
    } catch (err) {
      if (!abort.signal.aborted) sse.send({ type: "error", at: Date.now(), message: sanitize(err instanceof Error ? err.message : String(err)), retryable: false });
    } finally {
      sse.end();
      const settings = record?.settings ?? kb.settings;
      history?.record({
        kind: "rag_query",
        at: startedAt,
        ok: Boolean(record?.ok),
        error: record?.error ? record.error.split("\n")[0]!.slice(0, 200) : record ? undefined : "query did not start",
        durationMs: Date.now() - startedAt,
        kbId: kb.id,
        questionChars: question.length,
        strategy: settings.retrievalStrategy,
        index: settings.vectorIndex,
        topK: settings.topK,
        retrieved: record?.results.length ?? 0,
        contextTokens: record?.context?.tokenCount ?? 0,
        embeddingProvider: settings.embeddingProvider,
        embeddingModel: settings.embeddingModel,
        llmProvider: settings.llmProvider,
        model: record?.model ?? undefined,
        vendor: getRegistry().get(settings.llmProvider)?.describe().vendor ?? settings.llmProvider,
        latencyMs: record?.latencyMs ?? undefined,
        inputTokens: record?.usage?.inputTokens ?? undefined,
        outputTokens: record?.usage?.outputTokens ?? undefined,
        totalTokens: record?.usage?.totalTokens ?? undefined,
        citations: record?.citations.length ?? 0,
      });
    }
  });

  router.get("/kb/:id/runs/:runId", (req, res) => {
    const kb = load(req, res);
    if (!kb) return;
    const run = kb.run(String(req.params.runId));
    if (!run) {
      res.status(404).json({ error: "No such run." });
      return;
    }
    res.json({ run });
  });

  /**
   * Answers questions about the RAG system itself. The facts come from the real
   * knowledge base and run; a configured LLM turns them into prose when one is
   * available, and the result says which happened.
   */
  router.post("/kb/:id/explain", express.json({ limit: "32kb" }), async (req, res) => {
    const kb = load(req, res);
    if (!kb) return;
    const body = req.body as Partial<ExplainBody> | undefined;
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
    if (!question) {
      res.status(400).json({ error: "A question is required." });
      return;
    }
    const run = (body?.runId ? kb.run(body.runId) : undefined) ?? kb.lastRun();
    const facts = kb.facts(run);
    const trail = run ? kb.trail(run) : undefined;
    const config = getConfig();
    const keys = keysFor(req, config);
    const registry = getRegistry();
    const providerId = kb.settings.llmProvider;
    const provider = registry.get(providerId);
    const configured = provider ? provider.describe().configured || Boolean(sessionKeyFor(providerId, keys)) : false;

    if (!provider || !configured || provider.describe().mock) {
      res.json(heuristicExplain(question, facts, trail));
      return;
    }

    const system =
      "You explain how a retrieval-augmented generation system works to an engineer. " +
      "Use only the facts provided; do not invent numbers, models or steps. Where the facts say a value is a local stand-in or a simulation, say so. " +
      "Answer in short paragraphs, plainly, and refer to the specific documents, chunk ids and settings named in the facts.";
    const user = `Facts about this RAG system:\n${facts.map((f) => `- ${f}`).join("\n")}${trail ? `\n\nInformation trail for the last run:\n${trail.hops.map((h) => `- ${h.stage}: ${h.detail}`).join("\n")}` : ""}\n\nQuestion: ${question}`;
    let answer = "";
    let usage: UsageInfo | null = null;
    let failure: string | null = null;
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      await provider.run({
        message: user,
        settings: { temperature: 0.2, maxOutputTokens: 700, streaming: true, systemPrompt: system, effort: "none" },
        emit: (ev) => {
          if (ev.type === "text_delta") answer += ev.text;
          else if (ev.type === "completed") answer = ev.text || answer;
          else if (ev.type === "usage") usage = ev.usage;
          else if (ev.type === "error") failure = ev.message;
        },
        signal: abort.signal,
        apiKeyOverride: sessionKeyFor(providerId, keys),
        workspaceIdOverride: providerId === "claude" ? keys.anthropicWorkspace : undefined,
      });
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    if (failure || !answer.trim()) {
      const fallback = heuristicExplain(question, facts, trail);
      res.json({ ...fallback, answer: `${fallback.answer}\n\n(The model could not be reached: ${sanitize(failure ?? "empty answer")}.)` });
      return;
    }
    const result: ExplainResult = { answer, source: "ai", model: provider.describe().model, usage, facts, trail };
    res.json(result);
  });

  return router;
}

function sessionKeyFor(id: ProviderId, keys: { openai?: string; google?: string; anthropic?: string }): string | undefined {
  return id === "claude" ? keys.anthropic : id === "openai" ? keys.openai : id === "gemini" ? keys.google : undefined;
}

/** A plain-language answer assembled from the facts alone, for when no model is available. */
function heuristicExplain(question: string, facts: string[], trail: ExplainResult["trail"]): ExplainResult {
  const q = question.toLowerCase();
  const pick = (...words: string[]) => facts.filter((f) => words.some((w) => f.toLowerCase().includes(w)));
  let chosen: string[] = [];
  if (/chunk|split|overlap/.test(q)) chosen = pick("chunk");
  else if (/embed|vector|dimension/.test(q)) chosen = pick("embedded", "vector");
  else if (/index|ivf|flat|database|store/.test(q)) chosen = pick("index");
  else if (/retriev|search|rank|top|similar|threshold|mmr|hybrid/.test(q)) chosen = pick("retrieval", "compared");
  else if (/context|prompt|budget/.test(q)) chosen = pick("context", "passages", "prompt");
  else if (/answer|cite|citation|llm|model|generat/.test(q)) chosen = pick("answer", "cited", "model");
  if (chosen.length === 0) chosen = facts;
  const answer = [
    chosen.join(" "),
    trail ? `Following one passage through the last run: ${trail.hops.map((h) => `${h.stage} — ${h.detail}`).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { answer, source: "heuristic", facts, trail };
}
