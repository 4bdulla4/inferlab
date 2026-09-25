import type { DataSource } from "@shared/llm";
import type { AgentEvent, AgentToolDescriptor } from "@shared/agent";
import type { EventStatus } from "@/types/execution";
import { PACE } from "@/labs/llm/sequencer";
import type { AgentEventDataMap, AgentEventType, AgentLabEvent, AnyAgentEvent } from "./events";
import { AGENT_NODES, type AgentNodeKind } from "./stages";

/** Base dwell per event type at 1x, before the shared pace multiplier. */
const DURATION: Record<AgentEventType, number> = {
  RUN_STARTED: 700,
  AGENT_INITIALIZED: 900,
  INSTRUCTIONS_SET: 1000,
  CONTEXT_LOADED: 1000,
  ITERATION_STARTED: 450,
  MODEL_REQUESTED: 600,
  MODEL_RESPONDED: 1000,
  DECIDED: 900,
  TOOL_SELECTED: 800,
  APPROVAL_REQUESTED: 500,
  APPROVAL_RESOLVED: 700,
  TOOL_STARTED: 500,
  TOOL_ATTEMPT_FAILED: 900,
  TOOL_FALLBACK: 900,
  TOOL_COMPLETED: 1000,
  OBSERVED: 650,
  STATE_UPDATED: 350,
  MEMORY_UPDATED: 300,
  MODEL_TEXT_DELTA: 45,
  FINAL_RESPONSE: 800,
  RUN_COMPLETED: 900,
  NOTICE: 200,
  EXECUTION_ERROR: 500,
  EXECUTION_STOPPED: 300,
};

export const NODE_IDS = {
  goal: "goal",
  init: "init",
  instructions: "instructions",
  context: "context",
  plan: (n: number) => `plan-${n}`,
  decision: (n: number) => `decision-${n}`,
  tool: (callId: string) => `tool-${callId}`,
  approval: (callId: string) => `approval-${callId}`,
  fallback: (callId: string) => `fallback-${callId}`,
  observation: (n: number) => `observe-${n}`,
  response: "response",
  done: "done",
};

/**
 * Turns the server's live stream into the lab's ordered execution log, naming
 * the graph node each event lands on. Sources follow the honesty rules: a real
 * provider's decisions are live and the offline planner's are simulation; each
 * tool result carries the label its tool declared.
 */
export class AgentEventSequencer {
  private seq = 0;
  private iteration = 0;
  private lastNodeId = NODE_IDS.goal;
  private mock = false;
  private tools = new Map<string, AgentToolDescriptor>();
  private decisionParallel = new Map<number, boolean>();
  private callIteration = new Map<string, number>();
  private callToolSource = new Map<string, DataSource>();
  private activeFallback = new Map<string, string>();
  private leavesByIteration = new Map<number, string[]>();
  private lastToolNodeId: string | null = null;
  /** The node whose result was observed last, so its state snapshot lands on the right tool. */
  private lastObservedNodeId: string | null = null;
  private lastDecisionNodeId: string | null = null;
  private observationOpen = new Set<number>();

  constructor(private readonly runId: string) {}

  fromServer(ev: AgentEvent): AnyAgentEvent[] {
    switch (ev.type) {
      case "run_started":
        return [this.make("RUN_STARTED", "goal", NODE_IDS.goal, "completed", "live", { goal: ev.goal, config: ev.config, scenarioId: ev.scenarioId }, "Goal received", ev.at)];
      case "agent_initialized":
        this.mock = ev.mock;
        for (const t of ev.tools) this.tools.set(t.name, t);
        return [this.make("AGENT_INITIALIZED", "init", NODE_IDS.init, "completed", ev.mock ? "simulation" : "live", { provider: ev.provider, model: ev.model, vendor: ev.vendor, mock: ev.mock, tools: ev.tools }, `${ev.model} · ${ev.tools.length} tools`, ev.at)];
      case "system_instructions":
        return [this.make("INSTRUCTIONS_SET", "instructions", NODE_IDS.instructions, "completed", "live", { text: ev.text, tokenEstimate: ev.tokenEstimate }, `${ev.tokenEstimate} tokens of instructions`, ev.at)];
      case "context_loaded":
        return [this.make("CONTEXT_LOADED", "context", NODE_IDS.context, "completed", "live", { messages: ev.messages, memory: ev.memory, files: ev.files, knowledgeBase: ev.knowledgeBase, tokenEstimate: ev.tokenEstimate }, `${ev.memory.length} memories · ${ev.files.length} files loaded`, ev.at)];
      case "iteration_started":
        this.iteration = ev.iteration;
        this.leavesByIteration.set(ev.iteration, []);
        return [this.make("ITERATION_STARTED", "plan", NODE_IDS.plan(ev.iteration), "started", "live", { iteration: ev.iteration }, `Iteration ${ev.iteration}`, ev.at)];
      case "model_request":
        return [this.make("MODEL_REQUESTED", "plan", NODE_IDS.plan(ev.iteration), "progress", "live", { iteration: ev.iteration, messages: ev.messages, tokenEstimate: ev.tokenEstimate, tools: ev.tools, forceText: ev.forceText }, `Planning · ${ev.messages} messages sent to the model`, ev.at)];
      case "model_response":
        return [
          this.make("MODEL_RESPONDED", "plan", NODE_IDS.plan(ev.iteration), "completed", ev.source, { iteration: ev.iteration, latencyMs: ev.latencyMs, ttfbMs: ev.ttfbMs, usage: ev.usage, stopReason: ev.stopReason, text: ev.text, toolCalls: ev.toolCalls, model: ev.model }, `Model responded · ${ev.toolCalls.length ? `${ev.toolCalls.length} tool call${ev.toolCalls.length === 1 ? "" : "s"}` : "answer"} · ${ev.latencyMs} ms`, ev.at),
        ];
      case "decision": {
        this.decisionParallel.set(ev.iteration, ev.parallel);
        this.lastDecisionNodeId = NODE_IDS.decision(ev.iteration);
        const label = ev.kind === "call_tools" ? `Decision: call ${ev.toolCalls} tool${ev.toolCalls === 1 ? "" : "s"}${ev.parallel ? " in parallel" : ""}` : ev.kind === "respond" ? "Decision: answer" : "Decision: stop and answer";
        return [this.make("DECIDED", "decision", NODE_IDS.decision(ev.iteration), "completed", ev.source, { iteration: ev.iteration, kind: ev.kind, reason: ev.reason, toolCalls: ev.toolCalls, parallel: ev.parallel, fromNodeId: NODE_IDS.plan(ev.iteration) }, label, ev.at)];
      }
      case "tool_selected": {
        const nodeId = NODE_IDS.tool(ev.call.id);
        this.callIteration.set(ev.call.id, ev.iteration);
        this.callToolSource.set(ev.call.id, ev.tool.source);
        this.lastToolNodeId = nodeId;
        const parallel = this.decisionParallel.get(ev.iteration) ?? false;
        return [this.make("TOOL_SELECTED", "tool", nodeId, "started", ev.source, { iteration: ev.iteration, call: ev.call, tool: ev.tool, rationale: ev.rationale, fromNodeId: NODE_IDS.decision(ev.iteration), parallel }, `Selected ${ev.call.name}`, ev.at)];
      }
      case "approval_requested": {
        this.pendingKinds.set(ev.callId, ev.kind);
        const nodeId = ev.kind === "approve" ? NODE_IDS.approval(ev.callId) : NODE_IDS.tool(ev.callId);
        return [this.make("APPROVAL_REQUESTED", ev.kind === "approve" ? "approval" : "tool", nodeId, "started", "live", { callId: ev.callId, tool: ev.tool, args: ev.args, prompt: ev.prompt, kind: ev.kind, toolNodeId: NODE_IDS.tool(ev.callId) }, ev.kind === "approve" ? `Waiting for approval: ${ev.tool}` : "Waiting for your answer", ev.at)];
      }
      case "approval_resolved": {
        const nodeId = this.pendingKind(ev.callId) === "answer" ? NODE_IDS.tool(ev.callId) : NODE_IDS.approval(ev.callId);
        const label = ev.timedOut ? "No response in time" : ev.approved ? (this.pendingKind(ev.callId) === "answer" ? "Answer received" : "Approved") : "Rejected";
        return [this.make("APPROVAL_RESOLVED", this.pendingKind(ev.callId) === "answer" ? "tool" : "approval", nodeId, ev.approved ? "completed" : "error", "live", { callId: ev.callId, approved: ev.approved, input: ev.input, waitedMs: ev.waitedMs, timedOut: ev.timedOut }, `${label} · ${Math.round(ev.waitedMs / 1000)} s`, ev.at)];
      }
      case "tool_started": {
        const nodeId = this.activeNodeFor(ev.callId);
        const source = this.activeFallback.has(ev.callId) ? this.tools.get(ev.tool)?.source ?? "live" : this.callToolSource.get(ev.callId) ?? "live";
        return [this.make("TOOL_STARTED", this.activeFallback.has(ev.callId) ? "fallback" : "tool", nodeId, "progress", source, { callId: ev.callId, tool: ev.tool, attempt: ev.attempt, maxAttempts: ev.maxAttempts }, ev.attempt > 1 ? `${ev.tool} · attempt ${ev.attempt}` : `Running ${ev.tool}`, ev.at)];
      }
      case "tool_attempt_failed": {
        const nodeId = this.activeNodeFor(ev.callId);
        return [this.make("TOOL_ATTEMPT_FAILED", this.activeFallback.has(ev.callId) ? "fallback" : "tool", nodeId, ev.willRetry ? "progress" : "error", ev.source, { callId: ev.callId, tool: ev.tool, attempt: ev.attempt, error: ev.error, willRetry: ev.willRetry, retryInMs: ev.retryInMs }, ev.willRetry ? `${ev.tool} failed · retrying` : `${ev.tool} failed`, ev.at)];
      }
      case "tool_fallback": {
        const nodeId = NODE_IDS.fallback(ev.callId);
        this.activeFallback.set(ev.callId, nodeId);
        this.lastToolNodeId = nodeId;
        return [this.make("TOOL_FALLBACK", "fallback", nodeId, "started", this.tools.get(ev.to)?.source ?? "live", { callId: ev.callId, from: ev.from, to: ev.to, reason: ev.reason, fromNodeId: NODE_IDS.tool(ev.callId) }, `Falling back to ${ev.to}`, ev.at)];
      }
      case "tool_completed": {
        const nodeId = this.activeNodeFor(ev.callId);
        const iteration = this.callIteration.get(ev.callId) ?? this.iteration;
        this.leavesByIteration.set(iteration, [...(this.leavesByIteration.get(iteration) ?? []), nodeId]);
        return [this.make("TOOL_COMPLETED", this.activeFallback.has(ev.callId) ? "fallback" : "tool", nodeId, ev.result.ok ? "completed" : "error", ev.result.source, { callId: ev.callId, tool: ev.tool, result: ev.result, attempts: ev.attempts, iteration }, ev.result.ok ? `${ev.tool} returned · ${ev.result.latencyMs} ms` : `${ev.tool} failed`, ev.at)];
      }
      case "observation": {
        const iteration = this.callIteration.get(ev.callId) ?? this.iteration;
        this.observationOpen.add(iteration);
        this.lastObservedNodeId = this.activeNodeFor(ev.callId);
        return [this.make("OBSERVED", "observation", NODE_IDS.observation(iteration), "progress", "live", { callId: ev.callId, tool: ev.tool, summary: ev.summary, chars: ev.chars, tokenEstimate: ev.tokenEstimate, isError: ev.isError, iteration, leafNodeIds: this.leavesByIteration.get(iteration) ?? [] }, `Observed ${ev.tool} · ${ev.tokenEstimate} tokens`, ev.at)];
      }
      case "state_updated": {
        const cause = ev.cause;
        if (cause.startsWith("iteration")) {
          this.observationOpen.delete(ev.iteration);
          return [this.make("STATE_UPDATED", "observation", NODE_IDS.observation(ev.iteration), "completed", "live", { iteration: ev.iteration, state: ev.state, cause }, `State updated · ${ev.state.contextTokens} context tokens`, ev.at)];
        }
        const nodeId = cause === "context loaded" ? NODE_IDS.context : cause === "final answer" ? NODE_IDS.response : cause === "planning" || cause === "model responded" ? NODE_IDS.plan(ev.iteration) : cause.startsWith("waiting") ? (ev.state.pendingApproval ? (cause.includes("approval") ? NODE_IDS.approval(ev.state.pendingApproval.callId) : NODE_IDS.tool(ev.state.pendingApproval.callId)) : this.lastNodeId) : cause.startsWith("tool ") ? (this.lastObservedNodeId ?? this.lastToolNodeId ?? this.lastNodeId) : (this.lastToolNodeId ?? this.lastNodeId);
        return [this.make("STATE_UPDATED", this.kindOf(nodeId), nodeId, "info", "live", { iteration: ev.iteration, state: ev.state, cause }, `State · ${cause}`, ev.at)];
      }
      case "memory_updated":
        return [this.make("MEMORY_UPDATED", "tool", this.lastToolNodeId ?? this.lastNodeId, "info", "live", { op: ev.op, key: ev.key, entries: ev.entries }, `Memory ${ev.op}: ${ev.key}`, ev.at)];
      case "final_text_delta":
        // Streamed text is the model's turn in progress, not yet an answer: a turn can carry
        // text and tool calls together. It lands on the planning node; the decision decides.
        return [this.make("MODEL_TEXT_DELTA", "plan", NODE_IDS.plan(this.iteration), "progress", this.mock ? "simulation" : "live", { iteration: this.iteration, text: ev.text, index: ev.index }, `Writing · piece ${ev.index + 1}`, ev.at, undefined, true)];
      case "final_response":
        return [this.make("FINAL_RESPONSE", "response", NODE_IDS.response, "completed", ev.source, { text: ev.text, iteration: ev.iteration, fromNodeId: this.lastDecisionNodeId ?? NODE_IDS.plan(ev.iteration) }, `${ev.text.length} characters`, ev.at)];
      case "run_completed": {
        const failed = ev.reason === "error" || ev.reason === "stopped";
        const from = ev.reason === "completed" || ev.reason === "max_iterations" || ev.reason === "token_budget" || ev.reason === "timeout" ? NODE_IDS.response : this.lastNodeId;
        return [this.make("RUN_COMPLETED", "done", NODE_IDS.done, failed ? "error" : "completed", "live", { reason: ev.reason, iterations: ev.iterations, totalMs: ev.totalMs, usage: ev.usage, toolCalls: ev.toolCalls, errors: ev.errors, retries: ev.retries, state: ev.state, fromNodeId: from }, `Run ${ev.reason.replace(/_/g, " ")} · ${ev.iterations} iteration${ev.iterations === 1 ? "" : "s"}`, ev.at)];
      }
      case "notice":
        return [this.make("NOTICE", this.kindOf(this.lastNodeId), this.lastNodeId, "info", "live", { level: ev.level, message: ev.message }, ev.message, ev.at)];
      case "error":
        return [this.make("EXECUTION_ERROR", this.kindOf(this.lastNodeId), this.lastNodeId, "error", "live", { message: ev.message, status: ev.status, retryable: ev.retryable }, "Error", ev.at)];
    }
  }

  stopped(): AnyAgentEvent[] {
    return [this.make("EXECUTION_STOPPED", this.kindOf(this.lastNodeId), this.lastNodeId, "info", "live", {}, "Stopped", Date.now())];
  }

  failed(message: string, status?: number): AnyAgentEvent[] {
    return [this.make("EXECUTION_ERROR", this.kindOf(this.lastNodeId), this.lastNodeId, "error", "live", { message, status, retryable: false }, "Error", Date.now())];
  }

  private pendingKinds = new Map<string, "approve" | "answer">();
  private pendingKind(callId: string): "approve" | "answer" {
    return this.pendingKinds.get(callId) ?? "approve";
  }

  private activeNodeFor(callId: string): string {
    return this.activeFallback.get(callId) ?? NODE_IDS.tool(callId);
  }

  private kindOf(nodeId: string): AgentNodeKind {
    if (nodeId.startsWith("plan-")) return "plan";
    if (nodeId.startsWith("decision-")) return "decision";
    if (nodeId.startsWith("tool-")) return "tool";
    if (nodeId.startsWith("approval-")) return "approval";
    if (nodeId.startsWith("fallback-")) return "fallback";
    if (nodeId.startsWith("observe-")) return "observation";
    return (Object.keys(AGENT_NODES) as AgentNodeKind[]).find((k) => k === nodeId) ?? "goal";
  }

  private make<T extends AgentEventType>(
    type: T,
    stage: AgentNodeKind,
    nodeId: string,
    status: EventStatus,
    source: DataSource,
    data: Omit<AgentEventDataMap[T], "nodeId">,
    label: string,
    timestamp = Date.now(),
    duration = DURATION[type],
    compressible = false,
  ): AgentLabEvent<T> {
    if (status !== "info") this.lastNodeId = nodeId;
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
      label: label || AGENT_NODES[stage].label,
      data: { ...(data as object), nodeId } as AgentEventDataMap[T],
    };
  }
}
