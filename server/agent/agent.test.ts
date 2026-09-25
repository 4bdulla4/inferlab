import { describe, expect, it } from "vitest";
import type { AgentConfig, AgentEvent, ToolResult } from "../../shared/agent";
import { DEFAULT_AGENT_CONFIG } from "../../shared/agent";
import { sanitizeAgentConfig } from "../routes/agent";
import { AgentRunner, adaptArgsFor, summarizeArgs } from "./AgentRunner";
import { MockAgentModel } from "./models/mock";
import { AgentSession, normalizePath } from "./session";
import { evaluateExpression } from "./tools/calculator";
import { runJavaScript } from "./tools/code";
import { assertReadOnlySql, runReadOnlyQuery } from "./tools/database";
import { buildToolset, describeTools, sanitizeCustomTool } from "./tools";
import { fetchJsonApi } from "./tools/web";
import type { AgentModel, ModelTurn, ModelTurnRequest, ToolImpl } from "./types";
import { ToolExecutionError } from "./types";

/* ─────────────────────────────── tools ──────────────────────────────── */

describe("calculator", () => {
  it("respects precedence, parentheses and unary minus", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("-3 ^ 2")).toBe(-9);
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluateExpression("17 × 23")).toBe(391);
    expect(evaluateExpression("2026 - 1889")).toBe(137);
  });
  it("supports functions and constants", () => {
    expect(evaluateExpression("sqrt(16) + abs(-2)")).toBe(6);
    expect(evaluateExpression("round(pi, 2)")).toBe(3.14);
    expect(evaluateExpression("max(1, 7, 3) - min(4, 2)")).toBe(5);
    expect(evaluateExpression("1,000 + 1")).toBe(1001);
  });
  it("rejects bad input plainly", () => {
    expect(() => evaluateExpression("1 / 0")).toThrow(/Division by zero/);
    expect(() => evaluateExpression("foo(1)")).toThrow(/Unknown function/);
    expect(() => evaluateExpression("2 +")).toThrow(/ends unexpectedly/);
    expect(() => evaluateExpression("process.exit()")).toThrow();
  });
});

describe("database tool", () => {
  it("refuses anything that is not a read", () => {
    expect(() => assertReadOnlySql("DELETE FROM orders")).toThrow(/Only SELECT/);
    expect(() => assertReadOnlySql("SELECT 1; DROP TABLE orders")).toThrow(/One statement/);
    expect(() => assertReadOnlySql("WITH x AS (SELECT 1) INSERT INTO orders SELECT * FROM x")).toThrow(/write or schema keyword/);
    expect(() => assertReadOnlySql("PRAGMA writable_schema = 1")).toThrow();
  });
  it("runs real SQL over the seeded shop", () => {
    const out = runReadOnlyQuery("SELECT p.category, ROUND(SUM(oi.quantity * p.unit_price), 2) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id WHERE o.status = 'shipped' GROUP BY p.category ORDER BY revenue DESC");
    expect(out.columns).toEqual(["category", "revenue"]);
    expect(out.rows.length).toBe(4);
    const revenues = out.rows.map((r) => Number(r.revenue));
    expect(revenues).toEqual([...revenues].sort((a, b) => b - a));
  });
});

describe("code execution", () => {
  it("captures console output and the last value", () => {
    const out = runJavaScript("const xs = [1,2,3]; console.log('sum', xs.reduce((a,b)=>a+b,0)); xs.length");
    expect(out.stdout).toBe("sum 6");
    expect(out.result).toBe("3");
    expect(out.error).toBeNull();
  });
  it("has no access to the host", () => {
    expect(runJavaScript("typeof require").result).toBe('"undefined"');
    expect(runJavaScript("typeof process").result).toBe('"undefined"');
    expect(runJavaScript("throw new Error('boom')").error).toMatch(/boom/);
  });
});

describe("session workspace", () => {
  it("flattens paths so nothing escapes the workspace", () => {
    expect(normalizePath("../../etc/passwd")).toBe("passwd");
    expect(normalizePath("reports/report.md")).toBe("report.md");
    expect(normalizePath(".hidden")).toBe("hidden");
    expect(() => normalizePath("///")).toThrow();
  });
  it("reads back exactly what was written, appends and forgets", () => {
    const s = new AgentSession("t");
    s.writeFile("a.txt", "hello");
    s.writeFile("a.txt", " world", true);
    expect(s.readFile("a.txt")).toBe("hello world");
    expect(s.fileNames()).toEqual(["README.md", "a.txt"]);
    s.remember("k", "v");
    expect(s.memoryEntries().map((e) => e.key)).toEqual(["k"]);
    expect(s.forget("k")).toBe(true);
    expect(s.forget("k")).toBe(false);
  });
});

describe("tool catalogue", () => {
  it("marks the knowledge-base tool unavailable when nothing is attached", () => {
    const tools = describeTools({ ragKbId: null, customTools: [] }, null);
    const rag = tools.find((t) => t.id === "rag_retrieve")!;
    expect(rag.available).toBe(false);
    expect(rag.unavailableReason).toMatch(/No knowledge base/);
    expect(tools.filter((t) => t.source === "simulation").map((t) => t.id).sort()).toEqual(["external_service", "unreliable_service"]);
  });
  it("includes fallback tools in the toolset even when not listed as tools", () => {
    const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, tools: ["unreliable_service"], fallbacks: { unreliable_service: "external_service" } };
    const names = buildToolset(config, null).map((t) => t.descriptor.name);
    expect(names).toEqual(["unreliable_service", "external_service"]);
  });
  it("sanitizes and templates custom tools, labelled as simulation", async () => {
    const spec = sanitizeCustomTool({ slug: "Weather Lookup!", description: "d", parameters: [{ name: "City", type: "string", description: "", required: true }], response: "Sunny in {{city}}" })!;
    expect(spec.slug).toBe("weather_lookup");
    const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, tools: ["custom:weather_lookup"], customTools: [spec] };
    const [tool] = buildToolset(config, null);
    expect(tool!.descriptor.source).toBe("simulation");
    const result = await tool!.execute({ city: "Lahore" }, ctx());
    expect(result.content).toContain("Sunny in Lahore");
    expect(result.source).toBe("simulation");
  });
});

describe("web tools", () => {
  it("refuses local-network addresses before any request", async () => {
    await expect(fetchJsonApi("http://127.0.0.1:8790/api/health", new AbortController().signal)).rejects.toThrow(/local network/);
    await expect(fetchJsonApi("http://localhost/x", new AbortController().signal)).rejects.toThrow(/local network/);
    await expect(fetchJsonApi("ftp://example.com", new AbortController().signal)).rejects.toThrow(/http and https/);
  });
});

/* ─────────────────────────────── runner ─────────────────────────────── */

/** A model whose every turn is written down in advance. */
class ScriptedModel implements AgentModel {
  readonly id = "mock" as const;
  readonly model = "scripted";
  readonly vendor = "test";
  readonly mock = true;
  readonly requests: ModelTurnRequest[] = [];
  constructor(private readonly turns: Partial<ModelTurn>[]) {}
  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    this.requests.push(req);
    const t = this.turns[Math.min(this.requests.length - 1, this.turns.length - 1)] ?? {};
    return { text: "", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, latencyMs: 3, ttfbMs: null, stopReason: t.toolCalls?.length ? "tool_use" : "end_turn", model: "scripted", source: "simulation", ...t };
  }
}

function tool(name: string, execute: ToolImpl["execute"], source: "live" | "simulation" = "live"): ToolImpl {
  return {
    descriptor: { id: name, name, description: `${name} tool`, category: "custom", inputSchema: { type: "object", properties: {}, required: [] }, source, sourceNote: "", sideEffects: false, available: true },
    execute,
  };
}

const ok = (content: string): ToolResult => ({ ok: true, content, source: "live", latencyMs: 1, note: "test", truncated: false });

function ctx() {
  return {
    runId: "r",
    callId: "c",
    attempt: 1,
    config: DEFAULT_AGENT_CONFIG,
    session: new AgentSession("s"),
    signal: new AbortController().signal,
    keys: {},
    knowledgeBases: null,
    askHuman: async () => ({ approved: true, input: "yes", waitedMs: 0, timedOut: false }),
    emitMemory: () => {},
  };
}

async function runWith(model: AgentModel, tools: ToolImpl[], config: Partial<AgentConfig> = {}, hook?: (runner: AgentRunner, events: AgentEvent[]) => void) {
  const events: AgentEvent[] = [];
  const abort = new AbortController();
  const runner = new AgentRunner({
    runId: "test-run",
    goal: "Do the thing.",
    config: { ...DEFAULT_AGENT_CONFIG, retry: { maxAttempts: 2, backoffMs: 0 }, ...config, tools: tools.map((t) => t.descriptor.id) },
    scenarioId: null,
    model,
    tools,
    session: new AgentSession("s"),
    keys: {},
    knowledgeBases: null,
    emit: (e) => {
      events.push(e);
      hook?.(runner, events);
    },
    signal: abort.signal,
  });
  const outcome = await runner.run();
  return { events, outcome, types: events.map((e) => e.type) };
}

describe("AgentRunner", () => {
  it("emits the full observable sequence for one tool round and an answer", async () => {
    const model = new ScriptedModel([{ text: "Let me check.", toolCalls: [{ id: "c1", name: "lookup", args: { q: "x" } }] }, { text: "The answer is 42." }]);
    const { events, outcome, types } = await runWith(model, [tool("lookup", async () => ok("42"))]);
    expect(outcome.reason).toBe("completed");
    expect(types.slice(0, 5)).toEqual(["run_started", "agent_initialized", "system_instructions", "context_loaded", "state_updated"]);
    for (const t of ["iteration_started", "model_request", "model_response", "decision", "tool_selected", "tool_started", "tool_completed", "observation", "final_response", "run_completed"]) expect(types).toContain(t);
    const decision = events.find((e) => e.type === "decision") as Extract<AgentEvent, { type: "decision" }>;
    expect(decision.kind).toBe("call_tools");
    const selected = events.find((e) => e.type === "tool_selected") as Extract<AgentEvent, { type: "tool_selected" }>;
    expect(selected.rationale.modelText).toBe("Let me check.");
    expect(selected.rationale.offeredDescription).toBe("lookup tool");
    // The model saw the tool result on its second turn.
    const second = model.requests[1]!;
    expect(second.messages.at(-1)).toEqual({ role: "tool", results: [{ callId: "c1", name: "lookup", content: "42", isError: false }] });
    const done = events.at(-1) as Extract<AgentEvent, { type: "run_completed" }>;
    expect(done.usage.totalTokens).toBe(30);
    expect(done.iterations).toBe(2);
    expect(done.toolCalls).toBe(1);
  });

  it("retries a failing tool, then falls back, and labels the injected failure", async () => {
    let attempts = 0;
    const flaky = tool("flaky", async () => {
      attempts += 1;
      throw new ToolExecutionError("503 injected", "simulation", true);
    }, "simulation");
    const backup = tool("backup", async () => ok("backup says hi"));
    const model = new ScriptedModel([{ toolCalls: [{ id: "c1", name: "flaky", args: {} }] }, { text: "done" }]);
    const { events, outcome } = await runWith(model, [flaky, backup], { fallbacks: { flaky: "backup" }, retry: { maxAttempts: 2, backoffMs: 0 } });
    expect(attempts).toBe(2);
    const failures = events.filter((e) => e.type === "tool_attempt_failed") as Extract<AgentEvent, { type: "tool_attempt_failed" }>[];
    expect(failures.map((f) => f.willRetry)).toEqual([true, false]);
    expect(failures[0]!.source).toBe("simulation");
    const fallback = events.find((e) => e.type === "tool_fallback") as Extract<AgentEvent, { type: "tool_fallback" }>;
    expect(fallback.to).toBe("backup");
    const completed = events.find((e) => e.type === "tool_completed") as Extract<AgentEvent, { type: "tool_completed" }>;
    expect(completed.result.ok).toBe(true);
    expect(completed.result.note).toMatch(/^Fallback from flaky/);
    expect(completed.tool).toBe("backup");
    expect(outcome.retries).toBe(1);
    expect(outcome.errors).toBe(0);
  });

  it("does not retry an error the tool marks as not retryable", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ id: "c1", name: "strict", args: {} }] }, { text: "done" }]);
    const { events, outcome } = await runWith(model, [tool("strict", async () => { throw new ToolExecutionError("bad args", "live", false); })], { retry: { maxAttempts: 3, backoffMs: 0 } });
    expect(events.filter((e) => e.type === "tool_attempt_failed").length).toBe(1);
    const completed = events.find((e) => e.type === "tool_completed") as Extract<AgentEvent, { type: "tool_completed" }>;
    expect(completed.result.ok).toBe(false);
    expect(completed.result.content).toMatch(/bad args/);
    expect(outcome.errors).toBe(1);
  });

  it("runs calls in parallel or one after another as configured", async () => {
    const log: string[] = [];
    const slow = (name: string) =>
      tool(name, async () => {
        log.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 30));
        log.push(`${name}:end`);
        return ok(name);
      });
    const calls = [{ id: "a", name: "a", args: {} }, { id: "b", name: "b", args: {} }];
    await runWith(new ScriptedModel([{ toolCalls: calls }, { text: "done" }]), [slow("a"), slow("b")], { parallelToolCalls: true });
    expect(log.slice(0, 2)).toEqual(["a:start", "b:start"]);
    log.length = 0;
    await runWith(new ScriptedModel([{ toolCalls: calls }, { text: "done" }]), [slow("a"), slow("b")], { parallelToolCalls: false });
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("pauses gated tools for a human and respects a rejection", async () => {
    const executed = { count: 0 };
    const send = tool("send", async () => {
      executed.count += 1;
      return ok("sent");
    });
    const model = new ScriptedModel([{ toolCalls: [{ id: "c1", name: "send", args: { message: "hi" } }] }, { text: "done" }]);
    const { events } = await runWith(model, [send], { approvalRequired: ["send"] }, (runner, evs) => {
      const last = evs.at(-1);
      if (last?.type === "approval_requested") setTimeout(() => runner.resolveHuman(last.callId, false, "not now"), 5);
    });
    const requested = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
    expect(requested.kind).toBe("approve");
    expect(requested.prompt).toMatch(/Allow send/);
    const resolved = events.find((e) => e.type === "approval_resolved") as Extract<AgentEvent, { type: "approval_resolved" }>;
    expect(resolved.approved).toBe(false);
    expect(executed.count).toBe(0);
    const completed = events.find((e) => e.type === "tool_completed") as Extract<AgentEvent, { type: "tool_completed" }>;
    expect(completed.result.content).toMatch(/rejected this action: not now/);
    const waiting = events.find((e) => e.type === "state_updated" && e.state.status === "awaiting_human") as Extract<AgentEvent, { type: "state_updated" }>;
    expect(waiting.state.pendingApproval).toEqual({ callId: "c1", tool: "send" });
  });

  it("stops at the iteration cap by asking for a plain answer", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ id: "c", name: "t", args: {} }] }]);
    const { events, outcome } = await runWith(model, [tool("t", async () => ok("x"))], { maxIterations: 2 });
    expect(outcome.reason).toBe("max_iterations");
    expect(model.requests.map((r) => r.forceText)).toEqual([false, false, true]);
    expect(events.some((e) => e.type === "notice" && /iteration cap/.test(e.message))).toBe(true);
    expect(events.at(-1)?.type).toBe("run_completed");
  });

  it("stops when the token budget is spent", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ id: "c", name: "t", args: {} }], usage: { inputTokens: 400, outputTokens: 200, totalTokens: 600 } }]);
    const { outcome } = await runWith(model, [tool("t", async () => ok("x"))], { tokenBudget: 500, maxIterations: 10 });
    expect(outcome.reason).toBe("token_budget");
    expect(model.requests.length).toBe(2);
  });

  it("tells the model about a tool it was never given", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ id: "c", name: "ghost", args: {} }] }, { text: "ok" }]);
    const { events } = await runWith(model, [tool("real", async () => ok("x"))]);
    const completed = events.find((e) => e.type === "tool_completed") as Extract<AgentEvent, { type: "tool_completed" }>;
    expect(completed.result.ok).toBe(false);
    expect(completed.result.content).toMatch(/Unknown tool "ghost".*real/);
    expect(model.requests[1]!.messages.at(-1)).toMatchObject({ role: "tool" });
  });

  it("snapshots carry real counts after each step", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ id: "c1", name: "t", args: {} }] }, { text: "final" }]);
    const { events } = await runWith(model, [tool("t", async () => ok("result text"))]);
    const states = events.filter((e) => e.type === "state_updated") as Extract<AgentEvent, { type: "state_updated" }>[];
    expect(states[0]!.state.status).toBe("initializing");
    expect(states[0]!.state.messages.map((m) => m.role)).toEqual(["system", "user"]);
    const afterTool = states.find((s) => s.cause.startsWith("tool t returned"))!;
    expect(afterTool.state.lastTool).toEqual({ name: "t", ok: true, preview: "result text" });
    expect(afterTool.state.toolCalls).toBe(1);
    const final = states.at(-1)!;
    expect(final.state.status).toBe("completed");
    expect(final.state.usage.totalTokens).toBe(30);
    expect(final.state.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
  });
});

describe("helpers", () => {
  it("summarizes arguments without dumping long strings", () => {
    expect(summarizeArgs({})).toBe("no arguments");
    expect(summarizeArgs({ q: "a".repeat(100), n: 3 })).toBe(`q="${"a".repeat(80)}…", n=3`);
  });
  it("adapts arguments for a messaging fallback", () => {
    const fallback = describeTools({ ragKbId: null, customTools: [] }, null).find((t) => t.id === "external_service")!;
    const args = adaptArgsFor(fallback, { request: "status" }, "503");
    expect(args.action).toBe("notify");
    expect(String(args.message)).toMatch(/Primary tool failed: 503/);
  });
  it("clamps and cleans a config from the browser", () => {
    const c = sanitizeAgentConfig({ tools: ["calculator", "nope", "calculator"], maxIterations: 99, retry: { maxAttempts: 40, backoffMs: -5 }, fallbacks: { calculator: "calculator", clock: "nope" }, llmProvider: "x" as never, tokenBudget: 1 }, null);
    expect(c.tools).toEqual(["calculator"]);
    expect(c.maxIterations).toBe(12);
    expect(c.retry).toEqual({ maxAttempts: 5, backoffMs: 0 });
    expect(c.fallbacks).toEqual({});
    expect(c.llmProvider).toBe("claude");
    expect(c.tokenBudget).toBe(500);
  });
});

describe("offline planner", () => {
  it("calls the calculator for an explicit expression, then answers with the real result", async () => {
    const planner = new MockAgentModel();
    const tools = buildToolset({ ...DEFAULT_AGENT_CONFIG, tools: ["calculator"] }, null);
    const events: AgentEvent[] = [];
    const runner = new AgentRunner({ runId: "m", goal: "Work out 17 × 23 and tell me.", config: { ...DEFAULT_AGENT_CONFIG, tools: ["calculator"], maxIterations: 4 }, scenarioId: null, model: planner, tools, session: new AgentSession("s"), keys: {}, knowledgeBases: null, emit: (e) => events.push(e), signal: new AbortController().signal });
    const outcome = await runner.run();
    expect(outcome.reason).toBe("completed");
    const selected = events.find((e) => e.type === "tool_selected") as Extract<AgentEvent, { type: "tool_selected" }>;
    expect(selected.call.args.expression).toBe("17 * 23");
    expect(selected.source).toBe("simulation");
    const completed = events.find((e) => e.type === "tool_completed") as Extract<AgentEvent, { type: "tool_completed" }>;
    expect(completed.result.source).toBe("live");
    expect(completed.result.content).toBe("17 * 23 = 391");
    const final = events.find((e) => e.type === "final_response") as Extract<AgentEvent, { type: "final_response" }>;
    expect(final.text).toContain("391");
    expect(final.source).toBe("simulation");
  }, 15_000);
});
