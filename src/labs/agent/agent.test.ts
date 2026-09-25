import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentStateSnapshot, AgentToolDescriptor, ToolResult } from "@shared/agent";
import { DEFAULT_AGENT_CONFIG } from "@shared/agent";
import { AGENT_NODE_W, layoutAgentGraph } from "./layout";
import { applyAgentEvent } from "./reducer";
import { AgentEventSequencer, NODE_IDS } from "./sequencer";
import { createAgentVisualState, type AgentVisualState } from "./state";

const tool = (name: string, source: "live" | "simulation" = "live"): AgentToolDescriptor => ({ id: name, name, description: `${name} does things`, category: "custom", inputSchema: { type: "object", properties: {}, required: [] }, source, sourceNote: "", sideEffects: false, available: true });

const snapshot = (partial: Partial<AgentStateSnapshot> = {}): AgentStateSnapshot => ({
  status: "planning",
  goal: "g",
  iteration: 1,
  maxIterations: 6,
  messages: [],
  contextTokens: 120,
  availableTools: ["a", "b", "c"],
  selectedTools: [],
  memory: [],
  files: [],
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  modelMs: 0,
  toolMs: 0,
  toolCalls: 0,
  errors: 0,
  retries: 0,
  ...partial,
});

const result = (content: string, source: "live" | "simulation" = "live", ok = true): ToolResult => ({ ok, content, source, latencyMs: 12, note: "", truncated: false });

/** A run with two parallel calls, one of which retries then falls back, then a second iteration that answers. */
function script(mock = false): AgentEvent[] {
  const t = 1000;
  const tools = [tool("a"), tool("b"), tool("c", "simulation")];
  const src = mock ? "simulation" : "live";
  return [
    { type: "run_started", at: t, runId: "r1", goal: "Find the thing and report it", config: { ...DEFAULT_AGENT_CONFIG, tools: ["a", "b", "c"], fallbacks: { b: "c" } }, scenarioId: null },
    { type: "agent_initialized", at: t + 1, provider: mock ? "mock" : "claude", model: mock ? "mock-planner-1" : "claude-opus-5", vendor: "x", mock, tools },
    { type: "system_instructions", at: t + 2, text: "Be good.", tokenEstimate: 3 },
    { type: "context_loaded", at: t + 3, messages: [], memory: [], files: ["README.md"], knowledgeBase: null, tokenEstimate: 40 },
    { type: "state_updated", at: t + 4, iteration: 0, state: snapshot({ status: "initializing", iteration: 0 }), cause: "context loaded" },
    { type: "iteration_started", at: t + 10, iteration: 1 },
    { type: "model_request", at: t + 11, iteration: 1, messages: 1, tokenEstimate: 50, tools: 3, forceText: false },
    { type: "model_response", at: t + 500, iteration: 1, latencyMs: 489, ttfbMs: null, usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }, stopReason: "tool_use", text: "Checking.", toolCalls: [{ id: "c1", name: "a", args: { q: "x" } }, { id: "c2", name: "b", args: {} }], model: "m", source: src },
    { type: "decision", at: t + 501, iteration: 1, kind: "call_tools", reason: "two calls", toolCalls: 2, parallel: true, source: src },
    { type: "tool_selected", at: t + 502, iteration: 1, call: { id: "c1", name: "a", args: { q: "x" } }, tool: tools[0]!, rationale: { offeredDescription: "a does things", modelText: "Checking.", argsSummary: 'q="x"', alternatives: ["b", "c"] }, source: src },
    { type: "tool_selected", at: t + 503, iteration: 1, call: { id: "c2", name: "b", args: {} }, tool: tools[1]!, rationale: { offeredDescription: "b does things", modelText: "Checking.", argsSummary: "no arguments", alternatives: ["a", "c"] }, source: src },
    { type: "tool_started", at: t + 504, callId: "c1", tool: "a", attempt: 1, maxAttempts: 2 },
    { type: "tool_started", at: t + 505, callId: "c2", tool: "b", attempt: 1, maxAttempts: 2 },
    { type: "tool_completed", at: t + 600, callId: "c1", tool: "a", result: result("a says 42"), attempts: 1, iteration: 1 },
    { type: "observation", at: t + 601, callId: "c1", tool: "a", summary: "a says 42", chars: 9, tokenEstimate: 4, isError: false },
    { type: "state_updated", at: t + 602, iteration: 1, state: snapshot({ status: "evaluating_result", toolCalls: 1 }), cause: "tool a returned" },
    { type: "tool_attempt_failed", at: t + 650, callId: "c2", tool: "b", attempt: 1, error: "503", willRetry: true, retryInMs: 400, source: "live" },
    { type: "tool_started", at: t + 1050, callId: "c2", tool: "b", attempt: 2, maxAttempts: 2 },
    { type: "tool_attempt_failed", at: t + 1100, callId: "c2", tool: "b", attempt: 2, error: "503", willRetry: false, retryInMs: null, source: "live" },
    { type: "tool_fallback", at: t + 1101, callId: "c2", from: "b", to: "c", reason: "b failed twice" },
    { type: "tool_started", at: t + 1102, callId: "c2", tool: "c", attempt: 3, maxAttempts: 4 },
    { type: "tool_completed", at: t + 1200, callId: "c2", tool: "c", result: result("[simulated] ok", "simulation"), attempts: 3, iteration: 1 },
    { type: "observation", at: t + 1201, callId: "c2", tool: "b", summary: "[simulated] ok", chars: 14, tokenEstimate: 5, isError: false },
    { type: "state_updated", at: t + 1202, iteration: 1, state: snapshot({ status: "evaluating_result", toolCalls: 2, retries: 1 }), cause: "tool b returned" },
    { type: "state_updated", at: t + 1203, iteration: 1, state: snapshot({ status: "evaluating_result", toolCalls: 2, retries: 1, contextTokens: 300 }), cause: "iteration 1 complete" },
    { type: "iteration_started", at: t + 1300, iteration: 2 },
    { type: "model_request", at: t + 1301, iteration: 2, messages: 3, tokenEstimate: 300, tools: 3, forceText: false },
    { type: "final_text_delta", at: t + 1700, text: "The answer ", index: 0 },
    { type: "final_text_delta", at: t + 1710, text: "is 42.", index: 1 },
    { type: "model_response", at: t + 1720, iteration: 2, latencyMs: 419, ttfbMs: 380, usage: { inputTokens: 300, outputTokens: 8, totalTokens: 308 }, stopReason: "end_turn", text: "The answer is 42.", toolCalls: [], model: "m", source: src },
    { type: "decision", at: t + 1721, iteration: 2, kind: "respond", reason: "no tool calls", toolCalls: 0, parallel: false, source: src },
    { type: "final_response", at: t + 1722, text: "The answer is 42.", iteration: 2, source: src },
    { type: "state_updated", at: t + 1723, iteration: 2, state: snapshot({ status: "completed", iteration: 2, usage: { inputTokens: 350, outputTokens: 28, totalTokens: 378 } }), cause: "final answer" },
    { type: "run_completed", at: t + 1724, reason: "completed", iterations: 2, totalMs: 724, usage: { inputTokens: 350, outputTokens: 28, totalTokens: 378 }, toolCalls: 2, errors: 0, retries: 1, state: snapshot({ status: "completed", iteration: 2 }) },
  ];
}

function play(events: AgentEvent[], seq = new AgentEventSequencer("run")): { state: AgentVisualState; count: number } {
  let state = createAgentVisualState();
  let count = 0;
  for (const ev of events) {
    for (const e of seq.fromServer(ev)) {
      state = applyAgentEvent(state, e);
      count += 1;
    }
  }
  return { state, count };
}

describe("agent sequencer", () => {
  it("names the node each event lands on and follows the fallback", () => {
    const seq = new AgentEventSequencer("run");
    const out = script().flatMap((e) => seq.fromServer(e));
    const byType = (t: string) => out.filter((e) => e.type === t);
    expect(byType("TOOL_SELECTED").map((e) => e.data.nodeId)).toEqual([NODE_IDS.tool("c1"), NODE_IDS.tool("c2")]);
    expect(byType("TOOL_STARTED").map((e) => e.data.nodeId)).toEqual([NODE_IDS.tool("c1"), NODE_IDS.tool("c2"), NODE_IDS.tool("c2"), NODE_IDS.fallback("c2")]);
    const completed = byType("TOOL_COMPLETED");
    expect(completed[1]!.data.nodeId).toBe(NODE_IDS.fallback("c2"));
    expect(completed[1]!.source).toBe("simulation");
    expect(completed[0]!.source).toBe("live");
    const observed = byType("OBSERVED");
    expect(observed.map((e) => e.data.nodeId)).toEqual([NODE_IDS.observation(1), NODE_IDS.observation(1)]);
    expect((observed[1]!.data as { leafNodeIds: string[] }).leafNodeIds).toEqual([NODE_IDS.tool("c1"), NODE_IDS.fallback("c2")]);
    const states = byType("STATE_UPDATED");
    expect(states.map((e) => [e.data.nodeId, e.status])).toEqual([
      [NODE_IDS.context, "info"],
      [NODE_IDS.tool("c1"), "info"],
      [NODE_IDS.fallback("c2"), "info"],
      [NODE_IDS.observation(1), "completed"],
      [NODE_IDS.response, "info"],
    ]);
    const deltas = byType("MODEL_TEXT_DELTA");
    expect(deltas.every((e) => e.compressible)).toBe(true);
    expect(deltas.map((e) => e.data.nodeId)).toEqual([NODE_IDS.plan(2), NODE_IDS.plan(2)]);
  });

  it("labels a real model's decisions live and the offline planner's as simulation, without touching tool results", () => {
    const live = new AgentEventSequencer("a").fromServer(script(false)[8]!)[0]!;
    const mock = new AgentEventSequencer("b").fromServer(script(true)[8]!)[0]!;
    expect(live.type).toBe("DECIDED");
    expect(live.source).toBe("live");
    expect(mock.source).toBe("simulation");
    const { state } = play(script(true));
    expect(state.nodeSource[NODE_IDS.plan(1)]).toBe("simulation");
    expect(state.nodeSource[NODE_IDS.tool("c1")]).toBe("live");
    expect(state.nodeSource[NODE_IDS.fallback("c2")]).toBe("simulation");
    expect(state.final?.source).toBe("simulation");
  });
});

describe("agent reducer", () => {
  it("grows the graph in execution order with the right edges", () => {
    const { state } = play(script());
    expect(state.nodes.map((n) => n.id)).toEqual([
      "goal", "init", "instructions", "context", "plan-1", "decision-1", "tool-c1", "tool-c2", "observe-1", "fallback-c2", "plan-2", "decision-2", "response", "done",
    ]);
    const edge = (from: string, to: string) => state.edges.find((e) => e.from === from && e.to === to);
    expect(edge("goal", "init")).toBeTruthy();
    expect(edge("context", "plan-1")).toBeTruthy();
    expect(edge("plan-1", "decision-1")).toBeTruthy();
    expect(edge("decision-1", "tool-c1")?.kind).toBe("parallel");
    expect(edge("decision-1", "tool-c2")?.kind).toBe("parallel");
    expect(edge("tool-c2", "fallback-c2")?.kind).toBe("fallback");
    expect(edge("tool-c1", "observe-1")).toBeTruthy();
    expect(edge("fallback-c2", "observe-1")).toBeTruthy();
    expect(edge("observe-1", "plan-2")).toBeTruthy();
    expect(edge("decision-2", "response")).toBeTruthy();
    expect(edge("response", "done")).toBeTruthy();
  });

  it("records calls, attempts, fallback and results for the inspector", () => {
    const { state } = play(script());
    const c2 = state.calls.c2!;
    expect(c2.attempts.map((a) => [a.tool, a.attempt, a.willRetry])).toEqual([["b", 1, true], ["b", 2, false], ["c", 3, undefined]]);
    expect(c2.fallback?.to).toBe("c");
    expect(c2.completedTool).toBe("c");
    expect(c2.result?.source).toBe("simulation");
    expect(state.calls.c1!.rationale.alternatives).toEqual(["b", "c"]);
    expect(state.iterations[1]!.callIds).toEqual(["c1", "c2"]);
    expect(state.iterations[1]!.decision?.parallel).toBe(true);
    expect(state.iterations[2]!.decision?.kind).toBe("respond");
  });

  it("keeps a state snapshot per step and the latest overall", () => {
    const { state } = play(script());
    expect(state.snapshots["tool-c1"]?.toolCalls).toBe(1);
    expect(state.snapshots["observe-1"]?.contextTokens).toBe(300);
    expect(state.snapshots.response?.status).toBe("completed");
    expect(state.snapshot?.iteration).toBe(2);
    expect(state.completion).toMatchObject({ reason: "completed", iterations: 2, toolCalls: 2, retries: 1 });
  });

  it("ends with every node settled and streamed text assembled", () => {
    const { state } = play(script());
    expect(state.finalText).toBe("The answer is 42.");
    expect(state.finalPieces).toBe(2);
    expect(state.iterations[2]!.streamText).toBe("The answer is 42.");
    // No response node exists until the decision says the turn is an answer.
    expect(state.nodes.findIndex((n) => n.id === "response")).toBeGreaterThan(state.nodes.findIndex((n) => n.id === "decision-2"));
    for (const n of state.nodes) expect(["completed", "error"]).toContain(state.nodeState[n.id]);
    expect(state.nodeState["tool-c2"]).toBe("error");
    expect(state.nodeState["fallback-c2"]).toBe("completed");
    expect(state.currentNodeId).toBe("done");
  });

  it("merges a node's progress events into one timeline row", () => {
    const { state } = play(script());
    const planRows = state.timeline.filter((t) => t.nodeId === "plan-1");
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.count).toBe(3);
    expect(planRows[0]!.status).toBe("completed");
    const toolRows = state.timeline.filter((t) => t.nodeId === "tool-c2");
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0]!.status).toBe("error");
  });

  it("routes a gated tool through an approval node", () => {
    const seq = new AgentEventSequencer("run");
    const base = script().slice(0, 10);
    const gated: AgentEvent[] = [
      ...base,
      { type: "approval_requested", at: 2000, callId: "c1", tool: "a", args: { q: "x" }, prompt: "Allow a?", kind: "approve" },
      { type: "state_updated", at: 2001, iteration: 1, state: snapshot({ status: "awaiting_human", pendingApproval: { callId: "c1", tool: "a" } }), cause: "waiting for approval" },
      { type: "approval_resolved", at: 5000, callId: "c1", approved: true, input: null, waitedMs: 3000, timedOut: false },
    ];
    const { state } = play(gated, seq);
    expect(state.edges.some((e) => e.from === "decision-1" && e.to === "approval-c1")).toBe(true);
    expect(state.edges.some((e) => e.from === "approval-c1" && e.to === "tool-c1")).toBe(true);
    expect(state.edges.some((e) => e.from === "decision-1" && e.to === "tool-c1")).toBe(false);
    expect(state.nodeState["approval-c1"]).toBe("completed");
    expect(state.calls.c1!.approval?.resolved?.approved).toBe(true);
    expect(state.snapshots["approval-c1"]?.status).toBe("awaiting_human");
    expect(state.pendingApproval).toBeUndefined();
  });
});

describe("agent layout", () => {
  it("stacks parallel calls, puts the fallback beside its tool and never overlaps", () => {
    const { state } = play(script());
    const layout = layoutAgentGraph(state.nodes, state.edges);
    const n = layout.nodes;
    expect(n["tool-c1"]!.col).toBe(n["tool-c2"]!.col);
    expect(n["tool-c1"]!.row).toBe(0);
    expect(n["tool-c2"]!.row).toBe(1);
    expect(n["fallback-c2"]!.col).toBe(n["tool-c2"]!.col + 1);
    expect(n["fallback-c2"]!.row).toBe(1);
    expect(n["observe-1"]!.col).toBe(n["fallback-c2"]!.col + 1);
    expect(n["plan-2"]!.col).toBe(n["observe-1"]!.col + 1);
    expect(n.done!.col).toBe(layout.columns - 1);
    const seen = new Set<string>();
    for (const p of Object.values(n)) {
      const key = `${p.col}:${p.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(layout.width).toBeGreaterThan(layout.columns * AGENT_NODE_W);
    expect(layout.bands.map((b) => b.iteration)).toEqual([1, 2]);
  });

  it("keeps the same grid when drawn top-to-bottom, only swapping the axes", () => {
    const { state } = play(script());
    const h = layoutAgentGraph(state.nodes, state.edges, "horizontal");
    const v = layoutAgentGraph(state.nodes, state.edges, "vertical");
    for (const id of h.order) {
      expect(v.nodes[id]!.col).toBe(h.nodes[id]!.col);
      expect(v.nodes[id]!.row).toBe(h.nodes[id]!.row);
    }
    // Along the flow: later columns sit lower; across it: parallel calls sit side by side.
    expect(v.nodes["plan-2"]!.y).toBeGreaterThan(v.nodes["observe-1"]!.y);
    expect(v.nodes["tool-c1"]!.y).toBe(v.nodes["tool-c2"]!.y);
    expect(v.nodes["tool-c2"]!.x).toBeGreaterThan(v.nodes["tool-c1"]!.x);
    expect(v.height).toBeGreaterThan(v.width);
    expect(h.width).toBeGreaterThan(h.height);
    const band = v.bands.find((b) => b.iteration === 1)!;
    expect(band.h).toBeGreaterThan(band.w > 0 ? 0 : -1);
    expect(band.y).toBeLessThan(v.nodes["plan-1"]!.y);
  });
});
