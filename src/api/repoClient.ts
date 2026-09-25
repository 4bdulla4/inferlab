import type { AnalyzeEvent, AnalyzeRequestBody, AskRequestBody, RepoAnalysis, RepoServiceStatus, SummarizeRequestBody, SummarizeResult, TraceResult } from "@shared/repo";
import { sessionHeaders } from "@/store/uiStore";
import { ApiError, createSSEParser } from "./llmClient";

export async function fetchRepoStatus(): Promise<RepoServiceStatus> {
  const res = await fetch("/api/repo/status", { headers: sessionHeaders() });
  if (!res.ok) throw new ApiError(`Failed to load analyzer status (${res.status})`, res.status);
  return (await res.json()) as RepoServiceStatus;
}

/** Streams analysis progress; resolves with the final analysis. */
export async function analyzeRepo(body: AnalyzeRequestBody, onEvent: (event: AnalyzeEvent) => void, signal: AbortSignal): Promise<RepoAnalysis> {
  const res = await fetch("/api/repo/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...sessionHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  if (!res.body) throw new ApiError("Streaming is not supported by this browser.", 0);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let analysis: RepoAnalysis | null = null;
  let error: { message: string; status?: number } | null = null;
  let ended = false;
  const parse = createSSEParser((name, data) => {
    if (name === "end") {
      ended = true;
      return;
    }
    try {
      const ev = JSON.parse(data) as AnalyzeEvent;
      if (ev.type === "analysis") analysis = ev.analysis;
      if (ev.type === "error") error = { message: ev.message, status: ev.status };
      onEvent(ev);
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
  if (error) throw new ApiError((error as { message: string }).message, (error as { status?: number }).status ?? 500);
  if (!analysis) throw new ApiError("The analysis stream ended without a result.", 500);
  return analysis;
}

export async function askRepo(body: AskRequestBody, signal?: AbortSignal): Promise<TraceResult> {
  const res = await fetch("/api/repo/ask", { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as TraceResult;
}

export async function summarizeRepo(body: SummarizeRequestBody, signal?: AbortSignal): Promise<SummarizeResult> {
  const res = await fetch("/api/repo/summarize", { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as SummarizeResult;
}
