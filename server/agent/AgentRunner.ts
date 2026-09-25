import type {
  AgentConfig,
  AgentEvent,
  AgentStateSnapshot,
  AgentStatus,
  AgentToolDescriptor,
  MessageSummary,
  TerminationReason,
  ToolCallRequest,
  ToolResult,
} from "@shared/agent";
import { AGENT_LIMITS } from "../../shared/agent";
import { countTokens } from "../rag/chunker";
import type { KnowledgeBaseStore } from "../rag/KnowledgeBase";
import type { AgentSession } from "./session";
import { resetUnreliable } from "./tools";
import { ToolExecutionError, type AgentMessage, type AgentModel, type ToolContext, type ToolImpl } from "./types";

export interface RunnerOptions {
  runId: string;
  goal: string;
  config: AgentConfig;
  scenarioId: string | null;
  model: AgentModel;
  tools: ToolImpl[];
  session: AgentSession;
  keys: ToolContext["keys"];
  knowledgeBases: KnowledgeBaseStore | null;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

interface PendingHuman {
  callId: string;
  kind: "approve" | "answer";
  requestedAt: number;
  resolve: (decision: { approved: boolean; input: string | null; timedOut: boolean }) => void;
  timer: NodeJS.Timeout;
}

const now = () => Date.now();

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RunOutcome {
  reason: TerminationReason;
  iterations: number;
  usage: RunUsage;
  toolCalls: number;
  errors: number;
  retries: number;
}

const BASE_SYSTEM_PROMPT = `You are an agent that completes the user's goal by calling tools, one round at a time.

Rules:
- Use tools whenever the goal needs facts, computation, data, files or actions. Never invent a tool result; if a tool fails, say so or try another tool.
- Read tool results carefully and build on them in the next round.
- When you have everything you need, reply with the final answer and make no further tool calls. Be concise, and say which tools or sources the answer rests on.
- You have a limited number of tool-calling rounds; plan so the goal is finished within them.`;

/**
 * The agent loop. Each iteration asks the model what to do next, runs the tools
 * it asked for under the configured policy (parallelism, retries, fallbacks,
 * human approval), feeds the results back and repeats until the model answers
 * or a termination condition is hit. Every step is emitted as it happens.
 *
 * Nothing here interprets the model's reasoning. The "planning" phase is the
 * interval between sending a request and receiving the response; "selecting a
 * tool" is the tool_use blocks the response actually contained.
 */
export class AgentRunner {
  private readonly messages: AgentMessage[] = [];
  private readonly toolsByName: Map<string, ToolImpl>;
  private readonly toolsById: Map<string, ToolImpl>;
  private readonly pending = new Map<string, PendingHuman>();
  private readonly startedAt = now();
  private status: AgentStatus = "initializing";
  private iteration = 0;
  private usage: RunUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private modelMs = 0;
  private toolMs = 0;
  private toolCalls = 0;
  private errors = 0;
  private retries = 0;
  private selectedTools: string[] = [];
  private lastTool: AgentStateSnapshot["lastTool"];
  private pendingApproval: AgentStateSnapshot["pendingApproval"];
  private system = "";
  private finished = false;
  /** Time spent waiting on a person; it is not the agent's to spend, so the time limit ignores it. */
  private humanWaitMs = 0;

  constructor(private readonly o: RunnerOptions) {
    this.toolsByName = new Map(o.tools.map((t) => [t.descriptor.name, t]));
    this.toolsById = new Map(o.tools.map((t) => [t.descriptor.id, t]));
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Called by the route when a human clicks approve/reject or answers a question. */
  resolveHuman(callId: string, approved: boolean, input: string | null): boolean {
    const p = this.pending.get(callId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(callId);
    p.resolve({ approved, input, timedOut: false });
    return true;
  }

  pendingHuman(): { callId: string; kind: "approve" | "answer"; requestedAt: number }[] {
    return [...this.pending.values()].map((p) => ({ callId: p.callId, kind: p.kind, requestedAt: p.requestedAt }));
  }

  async run(): Promise<RunOutcome> {
    const { emit, config, model, goal, signal } = this.o;
    let reason: TerminationReason = "completed";
    try {
      emit({ type: "run_started", at: now(), runId: this.o.runId, goal, config, scenarioId: this.o.scenarioId });
      const descriptors = this.o.tools.map((t) => t.descriptor);
      emit({ type: "agent_initialized", at: now(), provider: model.id, model: model.model, vendor: model.vendor, mock: model.mock, tools: descriptors });

      this.system = this.buildSystemPrompt(descriptors);
      emit({ type: "system_instructions", at: now(), text: this.system, tokenEstimate: countTokens(this.system) });

      this.messages.push({ role: "user", content: goal });
      const kb = config.ragKbId && this.o.knowledgeBases ? this.o.knowledgeBases.get(config.ragKbId)?.snapshot() : undefined;
      emit({
        type: "context_loaded",
        at: now(),
        messages: this.summaries(),
        memory: this.o.session.memoryEntries(),
        files: this.o.session.fileNames(),
        knowledgeBase: kb ? { id: kb.id, documents: kb.documents.length, chunks: kb.chunks.length } : null,
        tokenEstimate: this.contextTokens(),
      });
      this.emitState("context loaded");

      while (true) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        this.iteration += 1;
        emit({ type: "iteration_started", at: now(), iteration: this.iteration });
        const atCap = this.iteration > config.maxIterations;
        const overBudget = config.tokenBudget !== null && this.usage.totalTokens >= config.tokenBudget;
        const timedOut = now() - this.startedAt - this.humanWaitMs >= config.timeoutMs;
        const forceText = atCap || overBudget || timedOut;
        if (forceText) {
          const why = atCap ? "the iteration cap was reached" : overBudget ? "the token budget is spent" : "the time limit was reached";
          emit({ type: "notice", at: now(), level: "warn", message: `Asking the model to answer now, with no more tool calls, because ${why}.` });
          reason = atCap ? "max_iterations" : overBudget ? "token_budget" : "timeout";
        }

        const turn = await this.modelTurn(forceText);
        this.selectedTools = turn.toolCalls.map((c) => c.name);

        if (turn.toolCalls.length === 0 || forceText) {
          this.status = "responding";
          emit({ type: "decision", at: now(), iteration: this.iteration, kind: forceText && turn.toolCalls.length ? "stop" : "respond", reason: forceText ? `Final answer requested: ${reason.replace(/_/g, " ")}.` : "The response contained no tool calls, so the model considers the goal answered.", toolCalls: 0, parallel: false, source: turn.source });
          this.messages.push({ role: "assistant", content: turn.text, toolCalls: [] });
          emit({ type: "final_response", at: now(), text: turn.text, iteration: this.iteration, source: turn.source });
          this.status = "completed";
          this.emitState("final answer");
          break;
        }

        const parallel = config.parallelToolCalls && turn.toolCalls.length > 1;
        emit({ type: "decision", at: now(), iteration: this.iteration, kind: "call_tools", reason: `The response contained ${turn.toolCalls.length} tool call${turn.toolCalls.length === 1 ? "" : "s"}${parallel ? ", run in parallel" : turn.toolCalls.length > 1 ? ", run one after another" : ""}.`, toolCalls: turn.toolCalls.length, parallel, source: turn.source });
        this.messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

        const results = parallel
          ? await Promise.all(turn.toolCalls.map((call) => this.runCall(call, turn.text, descriptors)))
          : await sequential(turn.toolCalls, (call) => this.runCall(call, turn.text, descriptors));

        this.messages.push({ role: "tool", results: results.map((r) => ({ callId: r.call.id, name: r.call.name, content: r.result.content, isError: !r.result.ok })) });
        this.status = "evaluating_result";
        this.emitState(`iteration ${this.iteration} complete`);
      }
    } catch (err) {
      if (signal.aborted) {
        reason = "stopped";
        this.status = "stopped";
      } else {
        reason = "error";
        this.status = "failed";
        this.errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number }).status;
        emit({ type: "error", at: now(), message, status, retryable: false });
      }
    } finally {
      this.finished = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.resolve({ approved: false, input: null, timedOut: true });
      }
      this.pending.clear();
      resetUnreliable(this.o.runId);
      if (!signal.aborted || reason === "stopped") {
        emit({
          type: "run_completed",
          at: now(),
          reason,
          iterations: this.iteration,
          totalMs: now() - this.startedAt,
          usage: this.usage,
          toolCalls: this.toolCalls,
          errors: this.errors,
          retries: this.retries,
          state: this.snapshot(),
        });
      }
    }
    return { reason, iterations: this.iteration, usage: this.usage, toolCalls: this.toolCalls, errors: this.errors, retries: this.retries };
  }

  /* ─────────────────────────────── model ─────────────────────────────── */

  private async modelTurn(forceText: boolean) {
    const { emit, config, model, signal } = this.o;
    this.status = "planning";
    const tools = this.o.tools.map((t) => t.descriptor);
    emit({ type: "model_request", at: now(), iteration: this.iteration, messages: this.messages.length, tokenEstimate: this.contextTokens(), tools: tools.length, forceText });
    this.emitState("planning");
    let index = 0;
    const turn = await model.complete({
      system: this.system,
      messages: [...this.messages],
      tools,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      forceText,
      parallelToolCalls: config.parallelToolCalls,
      signal,
      onTextDelta: (text) => emit({ type: "final_text_delta", at: now(), text, index: index++ }),
    });
    this.modelMs += turn.latencyMs;
    if (turn.usage) {
      this.usage.inputTokens += turn.usage.inputTokens ?? 0;
      this.usage.outputTokens += turn.usage.outputTokens ?? 0;
      this.usage.totalTokens = this.usage.inputTokens + this.usage.outputTokens;
    }
    emit({ type: "model_response", at: now(), iteration: this.iteration, latencyMs: turn.latencyMs, ttfbMs: turn.ttfbMs, usage: turn.usage, stopReason: turn.stopReason, text: turn.text, toolCalls: turn.toolCalls, model: turn.model, source: turn.source });
    this.selectedTools = turn.toolCalls.map((c) => c.name);
    this.status = turn.toolCalls.length ? "selecting_tool" : "responding";
    this.emitState("model responded");
    return turn;
  }

  /* ─────────────────────────────── tools ─────────────────────────────── */

  private async runCall(call: ToolCallRequest, modelText: string, offered: AgentToolDescriptor[]): Promise<{ call: ToolCallRequest; result: ToolResult }> {
    const { emit, config } = this.o;
    const impl = this.toolsByName.get(call.name);
    this.toolCalls += 1;
    this.status = "selecting_tool";
    const descriptor: AgentToolDescriptor = impl?.descriptor ?? {
      id: call.name,
      name: call.name,
      description: "Not offered to the model.",
      category: "custom",
      inputSchema: { type: "object", properties: {}, required: [] },
      source: "live",
      sourceNote: "The model asked for a tool that does not exist.",
      sideEffects: false,
      available: false,
      unavailableReason: "unknown tool",
    };
    emit({
      type: "tool_selected",
      at: now(),
      iteration: this.iteration,
      call,
      tool: descriptor,
      rationale: {
        offeredDescription: descriptor.description,
        modelText: modelText.trim() || null,
        argsSummary: summarizeArgs(call.args),
        alternatives: offered.filter((t) => t.name !== call.name).map((t) => t.name),
      },
      source: this.o.model.mock ? "simulation" : "live",
    });

    if (!impl) {
      this.errors += 1;
      const result: ToolResult = { ok: false, content: `Unknown tool "${call.name}". Available tools: ${[...this.toolsByName.keys()].join(", ")}.`, source: "live", latencyMs: 0, note: "The model asked for a tool it was not given.", truncated: false };
      emit({ type: "tool_completed", at: now(), callId: call.id, tool: call.name, result, attempts: 0, iteration: this.iteration });
      this.observe(call, result);
      return { call, result };
    }

    if (config.approvalRequired.includes(impl.descriptor.id)) {
      const decision = await this.waitForHuman(call.id, "approve", `Allow ${impl.descriptor.name} with ${summarizeArgs(call.args)}?`, call, impl.descriptor.name);
      if (!decision.approved) {
        const result: ToolResult = { ok: false, content: decision.timedOut ? "The human did not respond in time, so the action was not taken." : `The human rejected this action${decision.input ? `: ${decision.input}` : "."}`, source: "live", latencyMs: decision.waitedMs, note: decision.timedOut ? "Approval timed out" : "Rejected by the human", truncated: false };
        emit({ type: "tool_completed", at: now(), callId: call.id, tool: call.name, result, attempts: 0, iteration: this.iteration });
        this.observe(call, result);
        return { call, result };
      }
    }

    let outcome = await this.executeWithRetries(impl, call);
    if (!outcome.result) {
      const fallbackId = config.fallbacks[impl.descriptor.id];
      const fallback = fallbackId ? this.toolsById.get(fallbackId) : undefined;
      if (fallback && fallback !== impl) {
        emit({ type: "tool_fallback", at: now(), callId: call.id, from: impl.descriptor.name, to: fallback.descriptor.name, reason: `${impl.descriptor.name} failed ${outcome.attempts} time${outcome.attempts === 1 ? "" : "s"}: ${outcome.lastError}` });
        const fb = await this.executeWithRetries(fallback, { ...call, args: adaptArgsFor(fallback.descriptor, call.args, outcome.lastError ?? "") }, outcome.attempts);
        if (fb.result) {
          fb.result = { ...fb.result, note: `Fallback from ${impl.descriptor.name}: ${fb.result.note}` };
          outcome = fb;
        } else outcome = { ...fb, attempts: outcome.attempts + fb.attempts };
      }
    }
    const result: ToolResult = outcome.result ?? { ok: false, content: `Tool ${call.name} failed after ${outcome.attempts} attempt${outcome.attempts === 1 ? "" : "s"}: ${outcome.lastError}`, source: outcome.lastSource ?? "live", latencyMs: outcome.ms, note: "Every attempt failed", truncated: false };
    if (!result.ok) this.errors += 1;
    emit({ type: "tool_completed", at: now(), callId: call.id, tool: outcome.toolName ?? call.name, result, attempts: outcome.attempts, iteration: this.iteration });
    this.observe(call, result);
    return { call, result };
  }

  private async executeWithRetries(impl: ToolImpl, call: ToolCallRequest, attemptOffset = 0): Promise<{ result: ToolResult | null; attempts: number; lastError: string | null; lastSource: ToolResult["source"] | null; ms: number; toolName: string }> {
    const { emit, config, signal } = this.o;
    const maxAttempts = Math.max(1, config.retry.maxAttempts);
    let lastError: string | null = null;
    let lastSource: ToolResult["source"] | null = null;
    let attempts = 0;
    const started = now();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      this.status = "executing_tool";
      emit({ type: "tool_started", at: now(), callId: call.id, tool: impl.descriptor.name, attempt: attempt + attemptOffset, maxAttempts: maxAttempts + attemptOffset });
      const attemptStart = now();
      try {
        const result = await impl.execute(call.args, this.toolContext(call.id, attempt));
        this.toolMs += now() - attemptStart;
        return { result: { ...result, latencyMs: result.latencyMs || now() - attemptStart }, attempts, lastError: null, lastSource: null, ms: now() - started, toolName: impl.descriptor.name };
      } catch (err) {
        this.toolMs += now() - attemptStart;
        if (signal.aborted) throw err;
        const retryable = err instanceof ToolExecutionError ? err.retryable : true;
        lastError = err instanceof Error ? err.message : String(err);
        lastSource = err instanceof ToolExecutionError ? err.source : "live";
        const willRetry = retryable && attempt < maxAttempts;
        const retryInMs = willRetry ? config.retry.backoffMs * 2 ** (attempt - 1) : null;
        if (willRetry) this.retries += 1;
        emit({ type: "tool_attempt_failed", at: now(), callId: call.id, tool: impl.descriptor.name, attempt: attempt + attemptOffset, error: lastError, willRetry, retryInMs, source: lastSource });
        if (!willRetry) break;
        await sleep(retryInMs!, signal);
      }
    }
    return { result: null, attempts, lastError, lastSource, ms: now() - started, toolName: impl.descriptor.name };
  }

  private observe(call: ToolCallRequest, result: ToolResult): void {
    this.status = "evaluating_result";
    this.lastTool = { name: call.name, ok: result.ok, preview: result.content.slice(0, 200) };
    this.o.emit({ type: "observation", at: now(), callId: call.id, tool: call.name, summary: result.content.split("\n").find((l) => l.trim())?.slice(0, 200) ?? "(empty)", chars: result.content.length, tokenEstimate: countTokens(result.content), isError: !result.ok });
    this.emitState(`tool ${call.name} ${result.ok ? "returned" : "failed"}`);
  }

  private toolContext(callId: string, attempt: number): ToolContext {
    return {
      runId: this.o.runId,
      callId,
      attempt,
      config: this.o.config,
      session: this.o.session,
      signal: this.o.signal,
      keys: this.o.keys,
      knowledgeBases: this.o.knowledgeBases,
      askHuman: (prompt) => this.waitForHuman(callId, "answer", prompt, undefined, "ask_human"),
      emitMemory: (op, key) => this.o.emit({ type: "memory_updated", at: now(), op, key, entries: this.o.session.memoryEntries() }),
    };
  }

  /* ─────────────────────────────── humans ────────────────────────────── */

  private waitForHuman(callId: string, kind: "approve" | "answer", prompt: string, call: ToolCallRequest | undefined, toolName: string): Promise<{ approved: boolean; input: string | null; waitedMs: number; timedOut: boolean }> {
    const { emit, signal } = this.o;
    const requestedAt = now();
    this.status = "awaiting_human";
    this.pendingApproval = { callId, tool: toolName };
    emit({ type: "approval_requested", at: requestedAt, callId, tool: toolName, args: call?.args ?? {}, prompt, kind });
    this.emitState(kind === "approve" ? "waiting for approval" : "waiting for an answer");
    return new Promise((resolve) => {
      const finish = (decision: { approved: boolean; input: string | null; timedOut: boolean }) => {
        signal.removeEventListener("abort", onAbort);
        const waitedMs = now() - requestedAt;
        this.humanWaitMs += waitedMs;
        this.pendingApproval = undefined;
        emit({ type: "approval_resolved", at: now(), callId, approved: decision.approved, input: decision.input, waitedMs, timedOut: decision.timedOut });
        resolve({ ...decision, waitedMs });
      };
      const onAbort = () => {
        const p = this.pending.get(callId);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(callId);
        }
        finish({ approved: false, input: null, timedOut: false });
      };
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        finish({ approved: false, input: null, timedOut: true });
      }, AGENT_LIMITS.approvalTimeoutMs);
      this.pending.set(callId, { callId, kind, requestedAt, resolve: finish, timer });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /* ─────────────────────────────── state ─────────────────────────────── */

  private buildSystemPrompt(tools: AgentToolDescriptor[]): string {
    const { config, session } = this.o;
    const parts = [BASE_SYSTEM_PROMPT, `You may use up to ${config.maxIterations} tool-calling rounds.`];
    if (tools.length === 0) parts.push("No tools are available; answer from what you know and say so.");
    const memory = session.memoryEntries();
    if (config.tools.includes("memory") && memory.length) parts.push(`Memory from earlier runs:\n${memory.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`);
    if (config.tools.includes("file_ops")) parts.push(`Files already in the workspace: ${session.fileNames().join(", ") || "none"}.`);
    if (config.approvalRequired.length) parts.push(`Calls to ${config.approvalRequired.join(", ")} pause for a human to approve them; if a call is rejected, respect that.`);
    if (config.systemPrompt.trim()) parts.push(config.systemPrompt.trim());
    return parts.join("\n\n");
  }

  private summaries(): MessageSummary[] {
    const out: MessageSummary[] = [{ role: "system", preview: this.system.slice(0, 200), chars: this.system.length, tokenEstimate: countTokens(this.system) }];
    for (const m of this.messages) {
      if (m.role === "user") out.push({ role: "user", preview: m.content.slice(0, 200), chars: m.content.length, tokenEstimate: countTokens(m.content) });
      else if (m.role === "assistant") {
        const text = m.content;
        out.push({ role: "assistant", preview: (text || (m.toolCalls.length ? `→ ${m.toolCalls.map((c) => c.name).join(", ")}` : "")).slice(0, 200), chars: text.length, tokenEstimate: countTokens(text) + m.toolCalls.reduce((n, c) => n + countTokens(JSON.stringify(c.args)) + 8, 0), toolCalls: m.toolCalls.map((c) => c.name) });
      } else {
        const text = m.results.map((r) => r.content).join("\n");
        out.push({ role: "tool", preview: m.results.map((r) => `${r.name}: ${r.content.split("\n")[0]}`).join(" · ").slice(0, 200), chars: text.length, tokenEstimate: countTokens(text), callIds: m.results.map((r) => r.callId) });
      }
    }
    return out;
  }

  private contextTokens(): number {
    return this.summaries().reduce((n, s) => n + s.tokenEstimate, 0);
  }

  private snapshot(): AgentStateSnapshot {
    return {
      status: this.status,
      goal: this.o.goal,
      iteration: this.iteration,
      maxIterations: this.o.config.maxIterations,
      messages: this.summaries(),
      contextTokens: this.contextTokens(),
      availableTools: this.o.tools.map((t) => t.descriptor.name),
      selectedTools: this.selectedTools,
      lastTool: this.lastTool,
      memory: this.o.session.memoryEntries(),
      files: this.o.session.fileNames(),
      usage: { ...this.usage },
      modelMs: this.modelMs,
      toolMs: this.toolMs,
      toolCalls: this.toolCalls,
      errors: this.errors,
      retries: this.retries,
      pendingApproval: this.pendingApproval,
    };
  }

  private emitState(cause: string): void {
    this.o.emit({ type: "state_updated", at: now(), iteration: this.iteration, state: this.snapshot(), cause });
  }
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

async function sequential<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await fn(item));
  return out;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "no arguments";
  return entries.map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v) : JSON.stringify(v)}`).join(", ");
}

/**
 * A fallback tool rarely shares the failed tool's argument names. The best the
 * runner can do without inventing intent is carry over any field the fallback
 * also declares and, for a messaging fallback, explain what failed.
 */
export function adaptArgsFor(fallback: AgentToolDescriptor, args: Record<string, unknown>, failure: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fallback.inputSchema.properties)) if (key in args) out[key] = args[key];
  if (fallback.name === "external_service") {
    out.action ??= "notify";
    out.channel ??= "on-call";
    out.message ??= `Primary tool failed: ${failure}. Original request: ${summarizeArgs(args)}`;
  }
  for (const key of fallback.inputSchema.required) if (!(key in out)) out[key] = typeof args[Object.keys(args)[0] ?? ""] === "string" ? args[Object.keys(args)[0]!] : "";
  return out;
}
