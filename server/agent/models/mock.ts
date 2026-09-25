import type { AgentToolDescriptor, ToolCallRequest } from "@shared/agent";
import { countTokens } from "../../rag/chunker";
import type { AgentMessage, AgentModel, ModelTurn, ModelTurnRequest } from "../types";

/**
 * The offline planner. It decides which tools to call with plain rules over the
 * goal and the tools on offer, so the whole agent loop can be watched without a
 * key. Every decision it makes is labelled a simulation. The tools it calls are
 * the real ones, so their results stay live.
 */
export class MockAgentModel implements AgentModel {
  readonly id = "mock" as const;
  readonly vendor = "Local mock";
  readonly mock = true;
  readonly model = "mock-planner-1";
  private counter = 0;

  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    const sentAt = Date.now();
    await sleep(350 + Math.round(Math.random() * 350), req.signal);
    const goal = req.messages.find((m) => m.role === "user")?.content ?? "";
    const turn = req.forceText ? null : this.plan(goal, req);
    let text = "";
    let toolCalls: ToolCallRequest[] = [];
    if (turn && turn.calls.length) {
      toolCalls = turn.calls.map((c) => ({ id: `mock_${++this.counter}`, name: c.name, args: c.args }));
      text = turn.note;
    } else {
      text = this.finalAnswer(goal, req.messages);
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        await sleep(12, req.signal);
        req.onTextDelta?.(piece);
      }
    }
    const finishedAt = Date.now();
    const inputTokens = countTokens(req.system) + req.messages.reduce((n, m) => n + countTokens(serialize(m)), 0);
    const outputTokens = countTokens(text) + toolCalls.reduce((n, c) => n + countTokens(JSON.stringify(c.args)) + 8, 0);
    return {
      text,
      toolCalls,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: finishedAt - sentAt,
      ttfbMs: toolCalls.length ? null : 120,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      model: this.model,
      source: "simulation",
    };
  }

  /** Picks the next phase of work that has tools available and has not run yet. */
  private plan(goal: string, req: ModelTurnRequest): { calls: { name: string; args: Record<string, unknown> }[]; note: string } | null {
    const tools = new Map(req.tools.map((t) => [t.name, t]));
    const has = (name: string) => tools.has(name);
    const calledNames = new Set<string>();
    const results = new Map<string, string[]>();
    for (const m of req.messages) {
      if (m.role === "assistant") for (const c of m.toolCalls) calledNames.add(c.name);
      if (m.role === "tool") for (const r of m.results) results.set(r.name, [...(results.get(r.name) ?? []), r.content]);
    }
    const used = (name: string) => calledNames.has(name);
    const iterationsSoFar = req.messages.filter((m) => m.role === "assistant").length;
    if (iterationsSoFar >= 6) return null;

    const phases: { name: string; calls: { name: string; args: Record<string, unknown> }[] }[] = [];

    // 1. Clarify with the human before anything else.
    if (has("ask_human") && !used("ask_human")) phases.push({ name: "clarify", calls: [{ name: "ask_human", args: { question: questionFor(goal) } }] });

    // 2. Gather facts.
    const gather: { name: string; args: Record<string, unknown> }[] = [];
    if (has("unreliable_service") && !used("unreliable_service")) gather.push({ name: "unreliable_service", args: { request: "current status" } });
    if (has("web_search") && !used("web_search")) for (const q of searchQueries(goal, results.get("ask_human")?.[0])) gather.push({ name: "web_search", args: { query: q, limit: 3 } });
    if (has("database") && !used("database")) gather.push({ name: "database", args: { sql: "SELECT p.category, ROUND(SUM(oi.quantity * p.unit_price), 2) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id WHERE o.status = 'shipped' GROUP BY p.category ORDER BY revenue DESC" } });
    if (has("rag_retrieve") && !used("rag_retrieve")) gather.push({ name: "rag_retrieve", args: { query: keywords(goal).slice(0, 6).join(" ") || "main topics", topK: 4 } });
    if (has("code_exec") && !used("code_exec")) gather.push({ name: "code_exec", args: { code: codeFor(goal) } });
    if (has("http_api") && !used("http_api")) {
      const url = /(https?:\/\/\S+)/.exec(goal)?.[1];
      if (url) gather.push({ name: "http_api", args: { url } });
    }
    if (has("clock") && !used("clock")) gather.push({ name: "clock", args: {} });
    if (gather.length) phases.push({ name: "gather", calls: gather });

    // 3. Read a page found by search.
    if (has("web_fetch") && !used("web_fetch")) {
      const url = results.get("web_search")?.flatMap((r) => r.match(/https?:\/\/\S+/g) ?? [])[0] ?? /(https?:\/\/\S+)/.exec(goal)?.[1];
      if (url) phases.push({ name: "read", calls: [{ name: "web_fetch", args: { url, maxChars: 3000 } }] });
    }

    // 4. Compute.
    if (has("calculator") && !used("calculator")) {
      const expr = expressionFor(goal, results);
      if (expr) phases.push({ name: "compute", calls: [{ name: "calculator", args: { expression: expr } }] });
    }

    // 5. Act on the results.
    const act: { name: string; args: Record<string, unknown> }[] = [];
    const summary = summarize(results);
    const file = /\b([\w-]+\.(?:md|txt|json|csv))\b/i.exec(goal)?.[1];
    if (has("file_ops") && !used("file_ops") && file) act.push({ name: "file_ops", args: { action: "write", path: file, content: `# Agent report\n\nGoal: ${goal}\n\n${summary}` } });
    if (has("external_service") && !used("external_service")) act.push({ name: "external_service", args: { action: "notify", channel: "on-call", message: summary.slice(0, 400) || goal } });
    if (has("memory") && !used("memory")) {
      const facts = factsFrom(results);
      act.push(...facts.map((f, i) => ({ name: "memory", args: { action: "remember", key: `fact_${i + 1}`, value: f } })));
    }
    if (act.length) phases.push({ name: "act", calls: act });

    const phase = phases[0];
    if (!phase) return null;
    const calls = req.parallelToolCalls ? phase.calls.slice(0, 4) : phase.calls.slice(0, 1);
    const notes: Record<string, string> = {
      clarify: "I need one detail from you before I proceed.",
      gather: `Gathering the facts the goal needs${calls.length > 1 ? ` with ${calls.length} tool calls at once` : ""}.`,
      read: "Reading the most relevant page in full.",
      compute: "Working out the number the goal asks for.",
      act: "Recording and sending the results.",
    };
    return { calls, note: notes[phase.name] ?? "" };
  }

  private finalAnswer(goal: string, messages: AgentMessage[]): string {
    const results = new Map<string, string[]>();
    for (const m of messages) if (m.role === "tool") for (const r of m.results) results.set(r.name, [...(results.get(r.name) ?? []), r.content]);
    const lines: string[] = [];
    for (const [name, contents] of results) {
      for (const c of contents) lines.push(`• ${name}: ${firstLine(c)}`);
    }
    const calc = results.get("calculator")?.[0];
    return [
      `Offline demo agent. The planner that chose these tools is scripted, but every tool below really ran.`,
      lines.length ? `What the tools returned:\n${lines.join("\n")}` : "No tools were needed or available for this goal.",
      calc ? `Result: ${calc}.` : "",
      `Goal addressed: "${goal.slice(0, 160)}${goal.length > 160 ? "…" : ""}". Add an API key to see a real model plan, reason over these results and write its own answer.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

/* ────────────────────────────── heuristics ───────────────────────────── */

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "then", "that", "this", "using", "use", "find", "out", "what", "which", "how", "many", "me", "my", "it", "is", "are", "was", "were", "by", "from", "about", "into", "your", "you", "i", "tell", "please", "answer", "two", "one", "sentences", "sentence", "name", "sources", "work", "today", "date", "ago", "years", "year"]);

function keywords(goal: string): string[] {
  return goal
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
}

/** "A, B and C" in the goal becomes one search per item; otherwise the goal's key phrase. */
function searchQueries(goal: string, humanAnswer?: string): string[] {
  const list = /(?:of|for|about)\s+([A-Z][\wÀ-ɏ]+(?:\s[A-Z][\wÀ-ɏ]+)*(?:,\s*[A-Z][\wÀ-ɏ]+(?:\s[A-Z][\wÀ-ɏ]+)*)+\s+and\s+[A-Z][\wÀ-ɏ]+(?:\s[A-Z][\wÀ-ɏ]+)*)/.exec(goal)?.[1];
  if (list) {
    const items = list.split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    if (items.length >= 2 && items.length <= 4) return items.map((i) => `${i} population`);
  }
  if (humanAnswer) return [humanAnswer.trim().slice(0, 60)];
  const proper = goal.match(/\b[A-Z][\wÀ-ɏ]+(?:\s+[A-Z][\wÀ-ɏ]+)*/g)?.filter((p) => !/^(Find|Using|Look|Write|Ask|Get|Search|Answer|Then|Work|Tell|If|Confirm|Summarise|Summarize)$/.test(p)) ?? [];
  if (proper.length) return [proper[0]!];
  return [keywords(goal).slice(0, 4).join(" ") || goal.slice(0, 60)];
}

function questionFor(goal: string): string {
  const m = /ask me (?:which|what|where|when|who|how)\s+([^,.;]+)/i.exec(goal);
  if (m) return `${m[0].replace(/^ask me\s+/i, "")}?`.replace(/^\w/, (c) => c.toUpperCase());
  return "Could you tell me the one detail I need to proceed?";
}

function codeFor(goal: string): string {
  if (/fibonacci/i.test(goal)) {
    const n = Number(/first\s+(\d+)/i.exec(goal)?.[1] ?? 15);
    return `const fib = [0, 1];\nwhile (fib.length < ${n}) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);\nconsole.log(fib.join(", "));\nconsole.log("sum:", fib.reduce((a, b) => a + b, 0));`;
  }
  const nums = goal.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return `const values = ${JSON.stringify(nums)};\nconsole.log("count:", values.length, "sum:", values.reduce((a, b) => a + b, 0));`;
}

function expressionFor(goal: string, results: Map<string, string[]>): string | null {
  const explicit = /(\d+(?:\.\d+)?)\s*([×x*+\-−/÷])\s*(\d+(?:\.\d+)?)/.exec(goal);
  if (explicit) return `${explicit[1]} ${explicit[2].replace(/[×x]/, "*").replace("÷", "/").replace("−", "-")} ${explicit[3]}`;
  const db = results.get("database")?.[0];
  if (db) {
    const revenues = [...db.matchAll(/"revenue":\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    if (revenues.length >= 2) return `${revenues[0]} - ${revenues[1]}`;
  }
  const fetched = [...(results.get("web_fetch") ?? []), ...(results.get("web_search") ?? [])].join(" ");
  const year = /\b(1[5-9]\d{2}|20[0-2]\d)\b/.exec(fetched)?.[1];
  const clock = results.get("clock")?.[0];
  const thisYear = /Year:\s*(\d{4})/.exec(clock ?? "")?.[1] ?? String(new Date().getFullYear());
  if (year && /ago|years|how long|since/i.test(goal)) return `${thisYear} - ${year}`;
  const nums = goal.match(/\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 2) return nums.slice(0, 2).join(" + ");
  return null;
}

function summarize(results: Map<string, string[]>): string {
  const parts: string[] = [];
  for (const [name, contents] of results) for (const c of contents) parts.push(`- ${name}: ${firstLine(c)}`);
  return parts.join("\n");
}

function factsFrom(results: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const contents of results.values()) for (const c of contents) for (const line of c.split("\n")) {
    const t = line.trim();
    if (t.length > 30 && !/^\[\d+\]/.test(t) && !t.startsWith("{") && !t.startsWith("http")) out.push(t.slice(0, 160));
    if (out.length >= 3) return out;
  }
  return out.length ? out : ["The tools returned no prose worth remembering."];
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.trim().slice(0, 140);
}

function serialize(m: AgentMessage): string {
  if (m.role === "tool") return m.results.map((r) => r.content).join("\n");
  return m.role === "assistant" ? `${m.content} ${JSON.stringify(m.toolCalls)}` : m.content;
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

export type { AgentToolDescriptor };
