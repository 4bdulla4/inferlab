import type { AgentBlueprint, AgentEvent, AgentRunRecord, AgentServiceStatus, DescribeAgentBody, MemoryEntry, ResolveApprovalBody, StartAgentRunBody } from "@shared/agent";
import type { AgentBackendReport, AnalyzeCodeBody, AnalyzeRepoBody } from "@shared/agentReport";
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

export async function fetchAgentStatus(kbId?: string | null): Promise<AgentServiceStatus> {
  const q = kbId ? `?kb=${encodeURIComponent(kbId)}` : "";
  return json(await fetch(`/api/agent/status${q}`, { headers: sessionHeaders() }), "Could not load the agent service status");
}

export interface SessionWorkspace {
  memory: MemoryEntry[];
  files: { path: string; chars: number }[];
}

export async function fetchAgentSession(sessionId: string): Promise<SessionWorkspace> {
  return json(await fetch(`/api/agent/session/${encodeURIComponent(sessionId)}`), "Could not load the agent workspace");
}

export async function fetchAgentFile(sessionId: string, name: string): Promise<{ path: string; text: string }> {
  return json(await fetch(`/api/agent/session/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(name)}`), "Could not read the file");
}

export async function clearAgentSession(sessionId: string): Promise<void> {
  await json(await fetch(`/api/agent/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" }), "Could not clear the workspace");
}

/** Starts a run and streams its events until the server signals `end`. */
export async function streamAgentRun(body: StartAgentRunBody, onEvent: (event: AgentEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/agent/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...sessionHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = `The run could not start (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) message = b.error;
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
      onEvent(JSON.parse(data) as AgentEvent);
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

export async function resolveAgentApproval(runId: string, callId: string, body: ResolveApprovalBody): Promise<void> {
  await json(await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(callId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "Could not send your decision");
}

export async function stopAgentRun(runId: string): Promise<void> {
  await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }).catch(() => {});
}

export async function fetchAgentRun(runId: string): Promise<AgentRunRecord> {
  const r = await json<{ run: AgentRunRecord }>(await fetch(`/api/agent/runs/${encodeURIComponent(runId)}`), "Could not load the run");
  return r.run;
}

export interface BlueprintResponse {
  blueprint: AgentBlueprint;
  /** The rule analyzer's capability scores, for the advanced view. */
  hits: { capability: string; score: number }[];
}

/** Turns a plain-language description into a plan the person can check and run. */
export async function describeAgent(body: DescribeAgentBody, kbId?: string | null): Promise<BlueprintResponse> {
  const q = kbId ? `?kb=${encodeURIComponent(kbId)}` : "";
  return json(await fetch(`/api/agent/blueprint${q}`, { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body) }), "The description could not be analyzed");
}

/** Static analysis of uploaded backend files. Contents travel once and are not kept on the server. */
export async function analyzeAgentCode(body: AnalyzeCodeBody): Promise<AgentBackendReport> {
  const r = await json<{ report: AgentBackendReport }>(await fetch("/api/agent/code/analyze", { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body) }), "The code could not be analyzed");
  return r.report;
}

export async function analyzeAgentRepo(body: AnalyzeRepoBody): Promise<AgentBackendReport> {
  const res = await fetch("/api/agent/code/github", { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `The repository could not be analyzed (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string; hint?: string };
      if (b.error) message = b.hint ? `${b.error} ${b.hint}` : b.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return ((await res.json()) as { report: AgentBackendReport }).report;
}
