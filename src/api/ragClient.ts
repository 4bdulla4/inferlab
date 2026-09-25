import type {
  AddTextBody,
  ExplainBody,
  ExplainResult,
  KnowledgeBaseSnapshot,
  QueryBody,
  RagIngestEvent,
  RagQueryEvent,
  RagRunRecord,
  RagServiceStatus,
  RagSettings,
} from "@shared/rag";
import { sessionHeaders } from "@/store/uiStore";
import { ApiError, createSSEParser } from "./llmClient";

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let message = `${fallback} (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

/** Streams an SSE endpoint, invoking `onEvent` per frame, resolving on `end`. */
async function streamSSE<E>(url: string, init: RequestInit, onEvent: (event: E) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(url, { ...init, headers: { Accept: "text/event-stream", ...sessionHeaders(), ...(init.headers ?? {}) }, signal });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  if (!res.body) throw new ApiError("Streaming is not supported by this browser.", 0);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let ended = false;
  const parse = createSSEParser((name, data) => {
    if (name === "end") {
      ended = true;
      return;
    }
    try {
      onEvent(JSON.parse(data) as E);
    } catch {
      /* malformed frame */
    }
  });
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parse(decoder.decode(value, { stream: true }));
    if (ended) break;
  }
  parse(decoder.decode(), true);
}

export async function fetchRagStatus(): Promise<RagServiceStatus> {
  return json(await fetch("/api/rag/status", { headers: sessionHeaders() }), "Could not load RAG status");
}

export async function createKnowledgeBase(): Promise<KnowledgeBaseSnapshot> {
  const r = await json<{ snapshot: KnowledgeBaseSnapshot }>(await fetch("/api/rag/kb", { method: "POST" }), "Could not create a knowledge base");
  return r.snapshot;
}

export async function fetchKnowledgeBase(id: string): Promise<KnowledgeBaseSnapshot> {
  const r = await json<{ snapshot: KnowledgeBaseSnapshot }>(await fetch(`/api/rag/kb/${encodeURIComponent(id)}`), "Could not load the knowledge base");
  return r.snapshot;
}

export async function updateRagSettings(id: string, settings: Partial<RagSettings>): Promise<KnowledgeBaseSnapshot> {
  const r = await json<{ snapshot: KnowledgeBaseSnapshot }>(
    await fetch(`/api/rag/kb/${encodeURIComponent(id)}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) }),
    "Could not save settings",
  );
  return r.snapshot;
}

export function addTextDocument(id: string, body: AddTextBody, onEvent: (e: RagIngestEvent) => void, signal: AbortSignal): Promise<void> {
  return streamSSE(`/api/rag/kb/${encodeURIComponent(id)}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, onEvent, signal);
}

export function addUrlDocument(id: string, url: string, onEvent: (e: RagIngestEvent) => void, signal: AbortSignal): Promise<void> {
  return streamSSE(`/api/rag/kb/${encodeURIComponent(id)}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }, onEvent, signal);
}

/** Sends the file's raw bytes; name and type travel in the query string. */
export function uploadDocument(id: string, file: File, onEvent: (e: RagIngestEvent) => void, signal: AbortSignal): Promise<void> {
  const params = new URLSearchParams({ name: file.name, type: file.type || "" });
  return streamSSE(
    `/api/rag/kb/${encodeURIComponent(id)}/documents?${params}`,
    { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file },
    onEvent,
    signal,
  );
}

export async function removeDocument(id: string, docId: string): Promise<KnowledgeBaseSnapshot> {
  const r = await json<{ snapshot: KnowledgeBaseSnapshot }>(await fetch(`/api/rag/kb/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" }), "Could not remove the document");
  return r.snapshot;
}

export function rebuildIndex(id: string, onEvent: (e: RagIngestEvent) => void, signal: AbortSignal): Promise<void> {
  return streamSSE(`/api/rag/kb/${encodeURIComponent(id)}/rebuild`, { method: "POST" }, onEvent, signal);
}

export function streamQuery(id: string, body: QueryBody, onEvent: (e: RagQueryEvent) => void, signal: AbortSignal): Promise<void> {
  return streamSSE(`/api/rag/kb/${encodeURIComponent(id)}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, onEvent, signal);
}

export async function explainRag(id: string, body: ExplainBody): Promise<ExplainResult> {
  return json(
    await fetch(`/api/rag/kb/${encodeURIComponent(id)}/explain`, { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body) }),
    "Could not explain the pipeline",
  );
}

export async function fetchRagRun(id: string, runId: string): Promise<RagRunRecord> {
  const r = await json<{ run: RagRunRecord }>(await fetch(`/api/rag/kb/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`), "Could not load the run");
  return r.run;
}
