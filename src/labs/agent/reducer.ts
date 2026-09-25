import type { NodeState } from "@/types/execution";
import { formatMs } from "@/lib/format";
import type { AgentEventType, AgentLabEvent, AnyAgentEvent } from "./events";
import { AGENT_NODES, type AgentNodeKind } from "./stages";
import type { AgentGraphEdge, AgentGraphNode, AgentTimelineEntry, AgentVisualState, ToolCallInfo } from "./state";

/**
 * Pure reducer: applies one execution event to the visual state, growing the
 * graph as the agent acts. No timers, no side effects. The PlaybackController
 * decides when this runs, so replaying the same log always draws the same graph.
 */
export function applyAgentEvent(state: AgentVisualState, event: AnyAgentEvent): AgentVisualState {
  let next: AgentVisualState = {
    ...state,
    nodeState: { ...state.nodeState },
    nodeSource: { ...state.nodeSource },
    pulses: { ...state.pulses },
    iterations: { ...state.iterations },
    calls: { ...state.calls },
    snapshots: { ...state.snapshots },
    appliedEvents: state.appliedEvents + 1,
    lastEvent: event,
  };
  next = applyEventToGraph(next, event);
  next = applyGenericTransition(next, event);
  return next;
}

/* ───────────────────────────── graph growth ─────────────────────────── */

type GraphHandlers = { [K in AgentEventType]: (s: AgentVisualState, event: AgentLabEvent<K>) => AgentVisualState };

function applyEventToGraph(s: AgentVisualState, event: AnyAgentEvent): AgentVisualState {
  const handler = GRAPH_HANDLERS[event.type] as (s: AgentVisualState, event: AnyAgentEvent) => AgentVisualState;
  return handler(s, event);
}

/** One handler per event type; `d` is that event's own data. */
const GRAPH_HANDLERS: GraphHandlers = {
  RUN_STARTED: (s, event) => {
    const d = event.data;
    return { ...addNode(s, { id: d.nodeId, kind: "goal", label: AGENT_NODES.goal.label, sublabel: truncate(d.goal, 40) }), goal: d.goal, config: d.config, scenarioId: d.scenarioId };
  },
  AGENT_INITIALIZED: (s, event) => {
    const d = event.data;
    return {
      ...addNode(s, { id: d.nodeId, kind: "init", label: AGENT_NODES.init.label, sublabel: `${d.model} · ${d.tools.length} tool${d.tools.length === 1 ? "" : "s"}` }, lastNodeId(s)),
      agent: { provider: d.provider, model: d.model, vendor: d.vendor, mock: d.mock, tools: d.tools },
    };
  },
  INSTRUCTIONS_SET: (s, event) => {
    const d = event.data;
    return { ...addNode(s, { id: d.nodeId, kind: "instructions", label: AGENT_NODES.instructions.label, sublabel: `${d.tokenEstimate} tokens` }, lastNodeId(s)), instructions: { text: d.text, tokenEstimate: d.tokenEstimate } };
  },
  CONTEXT_LOADED: (s, event) => {
    const d = event.data;
    return {
      ...addNode(s, { id: d.nodeId, kind: "context", label: AGENT_NODES.context.label, sublabel: `${d.messages.length} msgs · ${d.memory.length} memories · ${d.files.length} files` }, lastNodeId(s)),
      context: { messages: d.messages, memory: d.memory, files: d.files, knowledgeBase: d.knowledgeBase, tokenEstimate: d.tokenEstimate },
      memory: d.memory,
    };
  },
  ITERATION_STARTED: (s, event) => {
    const d = event.data;
    const from = lastLeafOfPreviousIteration(s, d.iteration);
    const withNode = addNode(s, { id: d.nodeId, kind: "plan", label: `${AGENT_NODES.plan.label} · ${d.iteration}`, sublabel: "waiting for the model", iteration: d.iteration }, from);
    return { ...withNode, iterations: { ...withNode.iterations, [d.iteration]: { n: d.iteration, planNodeId: d.nodeId, callIds: [] } } };
  },
  MODEL_REQUESTED: (s, event) => {
    const d = event.data;
    const it = { ...s.iterations[d.iteration], requestedAt: event.timestamp, request: { messages: d.messages, tokenEstimate: d.tokenEstimate, tools: d.tools, forceText: d.forceText } };
    return updateNode({ ...s, iterations: { ...s.iterations, [d.iteration]: it as AgentVisualState["iterations"][number] } }, d.nodeId, { sublabel: `${d.messages} msgs · ~${d.tokenEstimate} tok → model${d.forceText ? " · answer only" : ""}` });
  },
  MODEL_RESPONDED: (s, event) => {
    const d = event.data;
    const it = { ...s.iterations[d.iteration], response: { latencyMs: d.latencyMs, ttfbMs: d.ttfbMs, usage: d.usage, stopReason: d.stopReason, text: d.text, toolCalls: d.toolCalls, model: d.model, source: event.source } };
    const calls = d.toolCalls.length;
    return updateNode({ ...s, iterations: { ...s.iterations, [d.iteration]: it as AgentVisualState["iterations"][number] } }, d.nodeId, {
      sublabel: `${formatMs(d.latencyMs)} · ${d.usage?.totalTokens ?? "?"} tok · ${calls ? `${calls} tool call${calls === 1 ? "" : "s"}` : "answer"}`,
    });
  },
  DECIDED: (s, event) => {
    const d = event.data;
    const it = { ...s.iterations[d.iteration], decision: { kind: d.kind, reason: d.reason, toolCalls: d.toolCalls, parallel: d.parallel } };
    const sub = d.kind === "call_tools" ? `call ${d.toolCalls} tool${d.toolCalls === 1 ? "" : "s"}${d.parallel ? " in parallel" : ""}` : d.kind === "respond" ? "answer the user" : "stop and answer";
    return { ...addNode(s, { id: d.nodeId, kind: "decision", label: AGENT_NODES.decision.label, sublabel: sub, iteration: d.iteration }, d.fromNodeId), iterations: { ...s.iterations, [d.iteration]: it as AgentVisualState["iterations"][number] } };
  },
  TOOL_SELECTED: (s, event) => {
    const d = event.data;
    const info: ToolCallInfo = { callId: d.call.id, nodeId: d.nodeId, iteration: d.iteration, name: d.call.name, args: d.call.args, tool: d.tool, rationale: d.rationale, parallel: d.parallel, attempts: [] };
    const it = s.iterations[d.iteration];
    const iterations = it ? { ...s.iterations, [d.iteration]: { ...it, callIds: [...it.callIds, d.call.id] } } : s.iterations;
    const withNode = addNode(s, { id: d.nodeId, kind: "tool", label: d.call.name, sublabel: summarizeArgs(d.call.args), iteration: d.iteration, callId: d.call.id, tool: d.call.name, category: d.tool.category, human: d.tool.category === "human" }, d.fromNodeId, d.parallel ? "parallel" : "flow");
    return { ...withNode, iterations, calls: { ...withNode.calls, [d.call.id]: info } };
  },
  APPROVAL_REQUESTED: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    // The gate sits between the decision and the tool, so the tool's incoming edge is re-routed through it.
    let out = s;
    if (call && d.kind === "approve") {
      const incoming = s.edges.find((e) => e.to === call.nodeId);
      const edges = incoming ? s.edges.filter((e) => e !== incoming) : s.edges;
      out = addNode({ ...s, edges }, { id: d.nodeId, kind: "approval", label: AGENT_NODES.approval.label, sublabel: `allow ${d.tool}?`, iteration: call.iteration, callId: d.callId, tool: d.tool, human: true }, incoming?.from, incoming?.kind ?? "flow");
      out = { ...out, edges: [...out.edges, { id: `${d.nodeId}→${call.nodeId}`, from: d.nodeId, to: call.nodeId, kind: "flow" }] };
      out = { ...out, calls: { ...out.calls, [d.callId]: { ...call, approval: { nodeId: d.nodeId, prompt: d.prompt, kind: d.kind, requestedAt: event.timestamp } } } };
    } else if (call) {
      out = updateNode(s, call.nodeId, { sublabel: "waiting for your answer", human: true });
      out = { ...out, calls: { ...out.calls, [d.callId]: { ...call, approval: { nodeId: d.nodeId, prompt: d.prompt, kind: d.kind, requestedAt: event.timestamp } } } };
    }
    return { ...out, pendingApproval: { callId: d.callId, nodeId: d.nodeId, tool: d.tool, prompt: d.prompt, kind: d.kind, args: d.args } };
  },
  APPROVAL_RESOLVED: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    let out: AgentVisualState = { ...s, pendingApproval: s.pendingApproval?.callId === d.callId ? undefined : s.pendingApproval };
    if (call?.approval) {
      out = { ...out, calls: { ...out.calls, [d.callId]: { ...call, approval: { ...call.approval, resolved: { approved: d.approved, input: d.input, waitedMs: d.waitedMs, timedOut: d.timedOut } } } } };
      const sub = d.timedOut ? "timed out" : d.approved ? (call.approval.kind === "answer" ? `answered · ${formatMs(d.waitedMs)}` : `approved · ${formatMs(d.waitedMs)}`) : `rejected · ${formatMs(d.waitedMs)}`;
      out = updateNode(out, d.nodeId, { sublabel: sub });
    }
    return out;
  },
  TOOL_STARTED: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    if (!call) return s;
    const attempts = [...call.attempts, { attempt: d.attempt, maxAttempts: d.maxAttempts, startedAt: event.timestamp, tool: d.tool }];
    const out = { ...s, calls: { ...s.calls, [d.callId]: { ...call, attempts } } };
    return updateNode(out, d.nodeId, { sublabel: d.attempt > 1 ? `attempt ${d.attempt} of ${d.maxAttempts}` : "running…" });
  },
  TOOL_ATTEMPT_FAILED: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    if (!call) return s;
    const attempts = call.attempts.map((a) => (a.attempt === d.attempt && a.tool === d.tool ? { ...a, error: d.error, willRetry: d.willRetry, retryInMs: d.retryInMs } : a));
    const out = { ...s, calls: { ...s.calls, [d.callId]: { ...call, attempts } } };
    return updateNode(out, d.nodeId, { sublabel: d.willRetry ? `failed · retry in ${formatMs(d.retryInMs ?? 0)}` : `failed after ${d.attempt} attempt${d.attempt === 1 ? "" : "s"}` });
  },
  TOOL_FALLBACK: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    if (!call) return s;
    const out = addNode(s, { id: d.nodeId, kind: "fallback", label: d.to, sublabel: `fallback for ${d.from}`, iteration: call.iteration, callId: d.callId, tool: d.to, category: s.agent?.tools.find((t) => t.name === d.to)?.category }, d.fromNodeId, "fallback");
    return { ...out, calls: { ...out.calls, [d.callId]: { ...call, fallback: { nodeId: d.nodeId, to: d.to, reason: d.reason, at: event.timestamp } } } };
  },
  TOOL_COMPLETED: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    if (!call) return s;
    const out = { ...s, calls: { ...s.calls, [d.callId]: { ...call, result: d.result, completedTool: d.tool } } };
    return updateNode(out, d.nodeId, { sublabel: d.result.ok ? `${formatMs(d.result.latencyMs)} · ${d.result.content.length} chars${d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}` : `failed · ${truncate(d.result.content, 36)}` });
  },
  OBSERVED: (s, event) => {
    const d = event.data;
    const call = s.calls[d.callId];
    const calls = call ? { ...s.calls, [d.callId]: { ...call, observation: { summary: d.summary, chars: d.chars, tokenEstimate: d.tokenEstimate, isError: d.isError } } } : s.calls;
    const exists = s.nodes.some((n) => n.id === d.nodeId);
    let out: AgentVisualState = { ...s, calls };
    if (!exists) {
      out = addNode(out, { id: d.nodeId, kind: "observation", label: AGENT_NODES.observation.label, sublabel: "reading results", iteration: d.iteration }, undefined);
      out = { ...out, edges: [...out.edges, ...d.leafNodeIds.map((leaf) => ({ id: `${leaf}→${d.nodeId}`, from: leaf, to: d.nodeId, kind: "flow" as const }))] };
      const it = out.iterations[d.iteration];
      if (it) out = { ...out, iterations: { ...out.iterations, [d.iteration]: { ...it, observationNodeId: d.nodeId } } };
    } else {
      // A leaf that finished after the node was created still needs its edge.
      const missing = d.leafNodeIds.filter((leaf) => !out.edges.some((e) => e.from === leaf && e.to === d.nodeId));
      if (missing.length) out = { ...out, edges: [...out.edges, ...missing.map((leaf) => ({ id: `${leaf}→${d.nodeId}`, from: leaf, to: d.nodeId, kind: "flow" as const }))] };
    }
    const it = out.iterations[d.iteration];
    const done = it ? it.callIds.filter((id) => out.calls[id]?.result).length : 0;
    const total = it?.callIds.length ?? 0;
    return updateNode(out, d.nodeId, { sublabel: `${done}/${total} result${total === 1 ? "" : "s"} in context` });
  },
  STATE_UPDATED: (s, event) => {
    const d = event.data;
    const out: AgentVisualState = { ...s, snapshot: d.state, snapshots: { ...s.snapshots, [d.nodeId]: d.state }, memory: d.state.memory };
    if (s.nodes.some((n) => n.id === d.nodeId && n.kind === "observation")) {
      return updateNode(out, d.nodeId, { sublabel: `${d.state.contextTokens} context tok · ${d.state.usage.totalTokens} used` });
    }
    return out;
  },
  MEMORY_UPDATED: (s, event) => {
    const d = event.data;
    return { ...s, memory: d.entries, memoryOps: [...s.memoryOps, { op: d.op, key: d.key, at: event.timestamp }] };
  },
  MODEL_TEXT_DELTA: (s, event) => {
    const d = event.data;
    const it = s.iterations[d.iteration];
    if (!it) return s;
    const streamText = (it.streamText ?? "") + d.text;
    const streamPieces = (it.streamPieces ?? 0) + 1;
    const out: AgentVisualState = { ...s, iterations: { ...s.iterations, [d.iteration]: { ...it, streamText, streamPieces } } };
    return updateNode(out, d.nodeId, { sublabel: `writing… ${streamPieces} piece${streamPieces === 1 ? "" : "s"}` });
  },
  FINAL_RESPONSE: (s, event) => {
    const d = event.data;
    const exists = s.nodes.some((n) => n.id === d.nodeId);
    let out = exists ? s : addNode(s, { id: d.nodeId, kind: "response", label: AGENT_NODES.response.label }, d.fromNodeId);
    // Streaming may have created the node before the decision existed, hanging it
    // off the planning node; the answer follows the decision, so re-route it.
    if (exists && !out.edges.some((e) => e.to === d.nodeId && e.from === d.fromNodeId)) {
      out = { ...out, edges: [...out.edges.filter((e) => e.to !== d.nodeId), { id: `${d.fromNodeId}→${d.nodeId}`, from: d.fromNodeId, to: d.nodeId, kind: "flow" }] };
    }
    out = updateNode(out, d.nodeId, { sublabel: `${d.text.length} chars · iteration ${d.iteration}` });
    const pieces = s.iterations[d.iteration]?.streamPieces ?? 0;
    return { ...out, finalText: d.text, finalPieces: pieces, final: { text: d.text, iteration: d.iteration, source: event.source } };
  },
  RUN_COMPLETED: (s, event) => {
    const d = event.data;
    const out = addNode(s, { id: d.nodeId, kind: "done", label: AGENT_NODES.done.label, sublabel: `${d.reason.replace(/_/g, " ")} · ${formatMs(d.totalMs)}` }, d.fromNodeId);
    return { ...out, completion: { reason: d.reason, iterations: d.iterations, totalMs: d.totalMs, usage: d.usage, toolCalls: d.toolCalls, errors: d.errors, retries: d.retries }, snapshot: d.state, snapshots: { ...out.snapshots, [d.nodeId]: d.state }, pendingApproval: undefined };
  },
  NOTICE: (s, event) => {
    const d = event.data;
    return { ...s, notices: [...s.notices, { level: d.level, message: d.message, at: event.timestamp }] };
  },
  EXECUTION_ERROR: (s, event) => {
    const d = event.data;
    return { ...s, error: { message: d.message, status: d.status }, pendingApproval: undefined };
  },
  EXECUTION_STOPPED: (s) => ({ ...s, stopped: true, pendingApproval: undefined }),
};

/* ────────────────────────── node/edge helpers ───────────────────────── */

function addNode(s: AgentVisualState, node: AgentGraphNode, fromId?: string, edgeKind: AgentGraphEdge["kind"] = "flow"): AgentVisualState {
  if (s.nodes.some((n) => n.id === node.id)) return fromId ? ensureEdge(s, fromId, node.id, edgeKind) : s;
  const nodes = [...s.nodes, node];
  const edges = fromId && s.nodes.some((n) => n.id === fromId) ? [...s.edges, { id: `${fromId}→${node.id}`, from: fromId, to: node.id, kind: edgeKind }] : s.edges;
  return { ...s, nodes, edges, nodeState: { ...s.nodeState, [node.id]: "idle" }, nodeSource: { ...s.nodeSource, [node.id]: AGENT_NODES[node.kind].defaultSource }, pulses: { ...s.pulses, [node.id]: 0 } };
}

function ensureEdge(s: AgentVisualState, from: string, to: string, kind: AgentGraphEdge["kind"]): AgentVisualState {
  if (s.edges.some((e) => e.from === from && e.to === to)) return s;
  return { ...s, edges: [...s.edges, { id: `${from}→${to}`, from, to, kind }] };
}

function updateNode(s: AgentVisualState, id: string, patch: Partial<AgentGraphNode>): AgentVisualState {
  const idx = s.nodes.findIndex((n) => n.id === id);
  if (idx === -1) return s;
  const nodes = s.nodes.slice();
  nodes[idx] = { ...nodes[idx]!, ...patch };
  return { ...s, nodes };
}

function lastNodeId(s: AgentVisualState): string | undefined {
  return s.nodes.at(-1)?.id;
}

/** The node the next iteration's planning follows from: the previous observation, or the context on the first pass. */
function lastLeafOfPreviousIteration(s: AgentVisualState, iteration: number): string | undefined {
  const prev = s.iterations[iteration - 1];
  if (prev?.observationNodeId) return prev.observationNodeId;
  if (prev) return s.nodes.filter((n) => n.iteration === iteration - 1).at(-1)?.id;
  return s.nodes.find((n) => n.kind === "context")?.id ?? lastNodeId(s);
}

/* ─────────────────────── state and timeline bookkeeping ──────────────── */

function applyGenericTransition(state: AgentVisualState, event: AnyAgentEvent): AgentVisualState {
  const nodeId = event.data.nodeId;
  const known = state.nodes.some((n) => n.id === nodeId);
  if (!known || event.status === "info") {
    return { ...state, notices: state.notices };
  }
  const nodeState = { ...state.nodeState, [nodeId]: nodeStateFor(event.status, state.nodeState[nodeId] ?? "idle") };
  const nodeSource = { ...state.nodeSource, [nodeId]: event.source };
  const pulses = { ...state.pulses };
  if (event.status === "completed") pulses[nodeId] = (pulses[nodeId] ?? 0) + 1;

  const timeline = [...state.timeline];
  let openIdx = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const t = timeline[i]!;
    if (t.nodeId === nodeId) {
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
      label: event.status === "completed" || event.status === "error" ? event.label : open.label,
    };
  } else {
    const entry: AgentTimelineEntry = {
      id: event.id,
      nodeId,
      kind: event.stage,
      label: event.label,
      status: event.status,
      source: event.source,
      startedAt: event.timestamp,
      endedAt: event.status === "completed" || event.status === "error" ? event.timestamp : undefined,
      count: 1,
    };
    timeline.push(entry);
  }
  return { ...state, nodeState, nodeSource, pulses, timeline, currentNodeId: nodeId };
}

function nodeStateFor(status: AnyAgentEvent["status"], current: NodeState): NodeState {
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

export function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "no arguments";
  const [k, v] = entries[0]!;
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return `${k}: ${truncate(text ?? "", 34)}${entries.length > 1 ? ` +${entries.length - 1}` : ""}`;
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export type { AgentNodeKind };
