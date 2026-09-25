import type { AgentConfig, AgentToolDescriptor, BuiltinToolId, CustomToolSpec, ToolInputSchema, ToolResult } from "@shared/agent";
import type { KnowledgeBaseStore } from "../../rag/KnowledgeBase";
import type { ToolContext, ToolImpl } from "../types";
import { ToolExecutionError } from "../types";
import { evaluateExpression } from "./calculator";
import { runJavaScript } from "./code";
import { DATABASE_SCHEMA, runReadOnlyQuery } from "./database";
import { retrieveFromKnowledgeBase } from "./rag";
import { jsonForModel, numberArg, stringArg, truncateContent } from "./shared";
import { fetchJsonApi, fetchPageText, searchWikipedia } from "./web";

const schema = (properties: ToolInputSchema["properties"], required: string[] = []): ToolInputSchema => ({ type: "object", properties, required });

type Executor = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

interface BuiltinSpec {
  descriptor: Omit<AgentToolDescriptor, "available" | "unavailableReason">;
  execute: Executor;
}

const result = (partial: Omit<ToolResult, "ok" | "truncated"> & { truncated?: boolean }): ToolResult => ({ ok: true, truncated: false, ...partial });

/* ────────────────────────────── built-ins ───────────────────────────── */

const BUILTINS: Record<BuiltinToolId, BuiltinSpec> = {
  web_search: {
    descriptor: {
      id: "web_search",
      name: "web_search",
      description: "Search Wikipedia for articles about a topic. Returns titles, snippets and URLs. Use it to find facts or pages worth reading with web_fetch.",
      category: "web",
      inputSchema: schema({ query: { type: "string", description: "What to search for, as a few keywords." }, limit: { type: "integer", description: "How many results to return, 1–8. Default 5." } }, ["query"]),
      source: "live",
      sourceNote: "Live: a real request to Wikipedia's public search API. Hits, snippets and timing are what it returned.",
      sideEffects: false,
    },
    async execute(args, ctx) {
      const query = stringArg(args, "query");
      const limit = numberArg(args, "limit", 5);
      const out = await searchWikipedia(query, limit, ctx.signal);
      const lines = out.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.snippet}\n   ${h.url}`);
      const { text, truncated } = truncateContent(lines.length ? lines.join("\n") : "No results.");
      return result({ content: text, data: out, source: "live", latencyMs: out.ms, note: `Wikipedia search API · ${out.hits.length} of ${out.totalHits.toLocaleString()} hits`, truncated });
    },
  },
  web_fetch: {
    descriptor: {
      id: "web_fetch",
      name: "web_fetch",
      description: "Download a public web page or PDF by URL and return its readable text. Use it after web_search to read a page in detail.",
      category: "web",
      inputSchema: schema({ url: { type: "string", description: "Absolute http(s) URL." }, maxChars: { type: "integer", description: "Cap on returned characters (200–20000). Default 6000." } }, ["url"]),
      source: "live",
      sourceNote: "Live: the page was really fetched; the text is what the extractor pulled out of it. Local-network addresses are refused.",
      sideEffects: false,
    },
    async execute(args) {
      const out = await fetchPageText(stringArg(args, "url"), numberArg(args, "maxChars", 6000));
      const { text, truncated } = truncateContent(out.text);
      return result({ content: text, data: { finalUrl: out.finalUrl, bytes: out.bytes, chars: out.chars, extraction: out.extraction }, source: "live", latencyMs: 0, note: out.extraction, truncated: truncated || out.truncated });
    },
  },
  http_api: {
    descriptor: {
      id: "http_api",
      name: "http_api",
      description: "Call a public JSON API with an HTTP GET and return the parsed response. For example https://api.open-meteo.com or https://api.github.com endpoints.",
      category: "web",
      inputSchema: schema({ url: { type: "string", description: "Absolute http(s) URL including any query string." } }, ["url"]),
      source: "live",
      sourceNote: "Live: a real GET request; status code, body and timing are the API's. Only public hosts are reachable.",
      sideEffects: false,
    },
    async execute(args, ctx) {
      const out = await fetchJsonApi(stringArg(args, "url"), ctx.signal);
      const { text, truncated } = jsonForModel(out.body);
      return result({ content: text, data: { status: out.status, contentType: out.contentType, bytes: out.bytes }, source: "live", latencyMs: out.ms, note: `HTTP ${out.status} · ${out.contentType || "unknown type"} · ${out.bytes} bytes`, truncated });
    },
  },
  calculator: {
    descriptor: {
      id: "calculator",
      name: "calculator",
      description: "Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses and functions sqrt, abs, round(x, digits), floor, ceil, min, max, pow, log, ln, exp, sin, cos, tan, plus pi and e.",
      category: "compute",
      inputSchema: schema({ expression: { type: "string", description: "The expression, e.g. (2026 - 1889) * 12" } }, ["expression"]),
      source: "live",
      sourceNote: "Live: real arithmetic by a parser the lab owns. No model guessed this number.",
      sideEffects: false,
    },
    async execute(args) {
      const expression = stringArg(args, "expression");
      const started = Date.now();
      try {
        const value = evaluateExpression(expression);
        return result({ content: `${expression} = ${formatNumber(value)}`, data: { expression, value }, source: "live", latencyMs: Date.now() - started, note: "Evaluated by the lab's arithmetic parser." });
      } catch (err) {
        throw new ToolExecutionError(err instanceof Error ? err.message : String(err), "live", false);
      }
    },
  },
  code_exec: {
    descriptor: {
      id: "code_exec",
      name: "code_exec",
      description: "Run a self-contained JavaScript snippet and return what it printed with console.log plus the value of the last expression. No modules, no network, 2 second limit.",
      category: "compute",
      inputSchema: schema({ code: { type: "string", description: "JavaScript source. Use console.log to print results." } }, ["code"]),
      source: "live",
      sourceNote: "Live: the code really ran in an isolated V8 context on the server; output and errors are its own.",
      sideEffects: false,
    },
    async execute(args) {
      const code = stringArg(args, "code");
      if (!code.trim()) throw new ToolExecutionError("Code is required.", "live", false);
      const out = runJavaScript(code);
      const parts = [out.stdout ? `stdout:\n${out.stdout}` : "stdout: (nothing printed)", out.result !== null ? `result: ${out.result}` : null, out.error ? `error: ${out.error}` : null].filter(Boolean);
      const { text, truncated } = truncateContent(parts.join("\n"));
      if (out.error) return { ok: false, content: text, data: out, source: "live", latencyMs: out.ms, note: `Threw after ${out.ms} ms in an isolated V8 context.`, truncated };
      return result({ content: text, data: out, source: "live", latencyMs: out.ms, note: `Ran in ${out.ms} ms in an isolated V8 context.`, truncated });
    },
  },
  database: {
    descriptor: {
      id: "database",
      name: "database",
      description: `Run a read-only SQL SELECT against the shop database (SQLite). Tables:\n${DATABASE_SCHEMA}\nRevenue for an item is quantity * unit_price. Only SELECT statements are accepted.`,
      category: "data",
      inputSchema: schema({ sql: { type: "string", description: "One SELECT statement." } }, ["sql"]),
      source: "live",
      sourceNote: "Live: a real SQLite database in the server's memory ran the query; rows and timing are its own. The dataset is a small fixture.",
      sideEffects: false,
    },
    async execute(args) {
      const sql = stringArg(args, "sql");
      try {
        const out = runReadOnlyQuery(sql);
        const { text, truncated } = jsonForModel({ columns: out.columns, rowCount: out.rowCount, rows: out.rows });
        return result({ content: text, data: out, source: "live", latencyMs: out.ms, note: `${out.rowCount} row${out.rowCount === 1 ? "" : "s"} in ${out.ms} ms · SQLite in memory`, truncated: truncated || out.truncated });
      } catch (err) {
        throw new ToolExecutionError(err instanceof Error ? err.message : String(err), "live", false);
      }
    },
  },
  file_ops: {
    descriptor: {
      id: "file_ops",
      name: "file_ops",
      description: "Work with files in the agent's private workspace: list, read, write (replace), append or delete. Paths are flat file names such as report.md.",
      category: "files",
      inputSchema: schema(
        {
          action: { type: "string", description: "list | read | write | append | delete", enum: ["list", "read", "write", "append", "delete"] },
          path: { type: "string", description: "File name, required for everything but list." },
          content: { type: "string", description: "Text to write or append." },
        },
        ["action"],
      ),
      source: "live",
      sourceNote: "Live: a real in-memory workspace for this browser session. Reads return exactly what was written.",
      sideEffects: true,
    },
    async execute(args, ctx) {
      const action = stringArg(args, "action").toLowerCase();
      const path = stringArg(args, "path");
      const started = Date.now();
      const s = ctx.session;
      const done = (content: string, data: unknown, note: string) => result({ content, data, source: "live", latencyMs: Date.now() - started, note });
      try {
        switch (action) {
          case "list":
            return done(s.fileNames().map((n) => `${n} (${s.readFile(n)!.length} chars)`).join("\n") || "(empty)", { files: s.fileNames() }, `${s.fileNames().length} file(s) in the workspace`);
          case "read": {
            const text = s.readFile(path);
            if (text === undefined) throw new ToolExecutionError(`No file named "${path}".`, "live", false);
            const { text: t, truncated } = truncateContent(text);
            return { ...done(t, { path, chars: text.length }, `Read ${text.length} characters`), truncated };
          }
          case "write":
          case "append": {
            const out = s.writeFile(path, stringArg(args, "content"), action === "append");
            return done(`${action === "append" ? "Appended to" : "Wrote"} ${out.path} (${out.chars} characters).`, out, `${action === "append" ? "Appended" : "Wrote"} ${out.path}`);
          }
          case "delete":
            if (!s.deleteFile(path)) throw new ToolExecutionError(`No file named "${path}".`, "live", false);
            return done(`Deleted ${path}.`, { path }, `Deleted ${path}`);
          default:
            throw new ToolExecutionError(`Unknown action "${action}". Use list, read, write, append or delete.`, "live", false);
        }
      } catch (err) {
        if (err instanceof ToolExecutionError) throw err;
        throw new ToolExecutionError(err instanceof Error ? err.message : String(err), "live", false);
      }
    },
  },
  rag_retrieve: {
    descriptor: {
      id: "rag_retrieve",
      name: "rag_retrieve",
      description: "Search the attached knowledge base (the user's own documents) and return the most relevant passages with citations. Use it before answering questions about those documents.",
      category: "knowledge",
      inputSchema: schema({ query: { type: "string", description: "What to look for." }, topK: { type: "integer", description: "How many passages, 1–10. Defaults to the knowledge base setting." } }, ["query"]),
      source: "live",
      sourceNote: "Live: real passages from the user's documents, ranked by the RAG lab's retrieval code. The embedding label follows the embedder that built the index.",
      sideEffects: false,
    },
    execute: retrieveFromKnowledgeBase,
  },
  memory: {
    descriptor: {
      id: "memory",
      name: "memory",
      description: "Long-term key-value memory that persists across steps and runs in this session. Actions: remember(key, value), recall(key) or recall() for everything, forget(key).",
      category: "memory",
      inputSchema: schema(
        {
          action: { type: "string", description: "remember | recall | forget", enum: ["remember", "recall", "forget"] },
          key: { type: "string", description: "Short snake_case key." },
          value: { type: "string", description: "What to remember." },
        },
        ["action"],
      ),
      source: "live",
      sourceNote: "Live: a real store on the server for this browser session. What is recalled is exactly what was remembered.",
      sideEffects: true,
    },
    async execute(args, ctx) {
      const action = stringArg(args, "action").toLowerCase();
      const key = stringArg(args, "key").trim().slice(0, 60);
      const started = Date.now();
      const s = ctx.session;
      const done = (content: string, data: unknown, note: string) => result({ content, data, source: "live", latencyMs: Date.now() - started, note });
      switch (action) {
        case "remember": {
          if (!key) throw new ToolExecutionError("A key is required to remember something.", "live", false);
          const entry = s.remember(key, stringArg(args, "value").slice(0, 2000));
          ctx.emitMemory("remember", key);
          return done(`Remembered ${key}.`, entry, `Stored "${key}" (${s.memory.size} entries)`);
        }
        case "recall": {
          const entries = key ? s.memoryEntries().filter((e) => e.key === key) : s.memoryEntries();
          const content = entries.length ? entries.map((e) => `${e.key}: ${e.value}`).join("\n") : key ? `Nothing stored under "${key}".` : "Memory is empty.";
          return done(content, { entries }, `${entries.length} entr${entries.length === 1 ? "y" : "ies"} recalled`);
        }
        case "forget": {
          if (!key) throw new ToolExecutionError("A key is required to forget something.", "live", false);
          const existed = s.forget(key);
          if (existed) ctx.emitMemory("forget", key);
          return done(existed ? `Forgot ${key}.` : `Nothing was stored under "${key}".`, { key, existed }, existed ? `Removed "${key}"` : "No such key");
        }
        default:
          throw new ToolExecutionError(`Unknown action "${action}". Use remember, recall or forget.`, "live", false);
      }
    },
  },
  clock: {
    descriptor: {
      id: "clock",
      name: "clock",
      description: "Get the current date and time on the server, in UTC and the server's local timezone.",
      category: "system",
      inputSchema: schema({}),
      source: "live",
      sourceNote: "Live: the server's real clock.",
      sideEffects: false,
    },
    async execute() {
      const now = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = { iso: now.toISOString(), local: now.toString(), timezone: tz, epochMs: now.getTime(), year: now.getFullYear() };
      return result({ content: `UTC: ${data.iso}\nLocal (${tz}): ${data.local}\nYear: ${data.year}`, data, source: "live", latencyMs: 0, note: "Server clock" });
    },
  },
  external_service: {
    descriptor: {
      id: "external_service",
      name: "external_service",
      description: "Perform an action in an external system: send a notification, create a ticket or post a status update. Provide the action and a message.",
      category: "external",
      inputSchema: schema(
        {
          action: { type: "string", description: "notify | create_ticket | post_status", enum: ["notify", "create_ticket", "post_status"] },
          message: { type: "string", description: "What to send." },
          channel: { type: "string", description: "Destination, e.g. on-call or #alerts." },
        },
        ["action", "message"],
      ),
      source: "simulation",
      sourceNote: "Simulation: no external system exists behind this tool. The acknowledgement is generated by the lab so side-effect flows can be practised safely.",
      sideEffects: true,
    },
    async execute(args, ctx) {
      const action = stringArg(args, "action") || "notify";
      const message = stringArg(args, "message");
      const channel = stringArg(args, "channel") || "default";
      const started = Date.now();
      await sleep(180 + Math.round(Math.random() * 120), ctx.signal);
      const id = `SIM-${ctx.runId.slice(-4).toUpperCase()}-${ctx.callId.slice(-4).toUpperCase()}`;
      const data = { simulated: true, action, channel, id, acceptedAt: new Date().toISOString(), messageChars: message.length };
      return result({
        content: `[simulated] ${action} accepted by ${channel}. Reference ${id}. Message (${message.length} chars): ${message.slice(0, 300)}`,
        data,
        source: "simulation",
        latencyMs: Date.now() - started,
        note: "Simulated acknowledgement; nothing was sent anywhere.",
      });
    },
  },
  unreliable_service: {
    descriptor: {
      id: "unreliable_service",
      name: "unreliable_service",
      description: "Fetch the latest status report from the status service. The service is known to be flaky.",
      category: "external",
      inputSchema: schema({ request: { type: "string", description: "What to ask the service for, e.g. 'current status'." } }),
      source: "simulation",
      sourceNote: "Simulation: this tool fails on purpose for the first attempts so retries and fallbacks can be watched. The failure count is a setting.",
      sideEffects: false,
    },
    async execute(args, ctx) {
      const started = Date.now();
      await sleep(250 + Math.round(Math.random() * 150), ctx.signal);
      const budget = Math.max(0, ctx.config.unreliableFailures);
      const seen = unreliableAttempts.get(ctx.runId) ?? 0;
      unreliableAttempts.set(ctx.runId, seen + 1);
      if (seen < budget) {
        throw new ToolExecutionError(`503 Service Unavailable (injected failure ${seen + 1} of ${budget})`, "simulation", true);
      }
      const data = { simulated: true, status: "degraded", incidents: 1, uptime30d: "99.62%", request: stringArg(args, "request"), attemptsBeforeSuccess: seen };
      return result({ content: `[simulated] status: degraded · 1 open incident (checkout latency) · 30-day uptime 99.62%`, data, source: "simulation", latencyMs: Date.now() - started, note: `Succeeded on attempt ${seen + 1} after ${seen} injected failure(s).` });
    },
  },
  ask_human: {
    descriptor: {
      id: "ask_human",
      name: "ask_human",
      description: "Ask the human user a question and wait for their answer. Use it when the goal is ambiguous or needs information only they have.",
      category: "human",
      inputSchema: schema({ question: { type: "string", description: "The question to show the user." } }, ["question"]),
      source: "live",
      sourceNote: "Live: a real person typed the answer in the browser while the run waited.",
      sideEffects: false,
    },
    async execute(args, ctx) {
      const question = stringArg(args, "question").trim() || "The agent needs your input.";
      const started = Date.now();
      const answer = await ctx.askHuman(question);
      if (answer.timedOut) throw new ToolExecutionError("The human did not answer in time.", "live", false);
      if (!answer.approved) return { ok: false, content: "The user declined to answer.", data: answer, source: "live", latencyMs: Date.now() - started, note: "Declined by the user", truncated: false };
      return result({ content: answer.input ?? "", data: answer, source: "live", latencyMs: Date.now() - started, note: `Answered after ${Math.round(answer.waitedMs / 1000)} s` });
    },
  },
};

/** Attempt counters for the injected-failure tool, per run. */
const unreliableAttempts = new Map<string, number>();
export function resetUnreliable(runId: string): void {
  unreliableAttempts.delete(runId);
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

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return Number(n.toPrecision(12)).toString();
}

/* ─────────────────────────────── custom ─────────────────────────────── */

export function customToolId(slug: string): string {
  return `custom:${slug}`;
}

export function sanitizeCustomTool(spec: Partial<CustomToolSpec>): CustomToolSpec | null {
  const slug = String(spec.slug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (!slug) return null;
  const parameters = Array.isArray(spec.parameters)
    ? spec.parameters
        .slice(0, 6)
        .map((p) => ({
          name: String(p?.name ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_")
            .slice(0, 32),
          type: p?.type === "number" || p?.type === "boolean" ? p.type : ("string" as const),
          description: String(p?.description ?? "").slice(0, 200),
          required: Boolean(p?.required),
        }))
        .filter((p) => p.name)
    : [];
  return { slug, description: String(spec.description ?? "").slice(0, 400) || `Custom tool ${slug}.`, parameters, response: String(spec.response ?? "").slice(0, 2000) || "ok" };
}

function customTool(spec: CustomToolSpec): BuiltinSpec {
  const props: ToolInputSchema["properties"] = {};
  for (const p of spec.parameters) props[p.name] = { type: p.type, description: p.description };
  return {
    descriptor: {
      id: customToolId(spec.slug),
      name: spec.slug,
      description: spec.description,
      category: "custom",
      inputSchema: schema(props, spec.parameters.filter((p) => p.required).map((p) => p.name)),
      source: "simulation",
      sourceNote: "Simulation: a tool you defined in the UI with a templated response. The model's call to it is real; the result is the template you wrote.",
      sideEffects: false,
    },
    async execute(args, ctx) {
      const started = Date.now();
      await sleep(120 + Math.round(Math.random() * 80), ctx.signal);
      const content = spec.response.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (args[k] === undefined ? "" : String(args[k])));
      return result({ content: `[simulated] ${content}`, data: { simulated: true, args }, source: "simulation", latencyMs: Date.now() - started, note: "Templated response from your custom tool definition." });
    },
  };
}

/* ────────────────────────────── registry ────────────────────────────── */

export const BUILTIN_TOOL_IDS = Object.keys(BUILTINS) as BuiltinToolId[];

export function isBuiltinToolId(id: string): id is BuiltinToolId {
  return id in BUILTINS;
}

/** Descriptors for the catalogue, with availability resolved against the current state. */
export function describeTools(config: Pick<AgentConfig, "ragKbId" | "customTools">, knowledgeBases: KnowledgeBaseStore | null): AgentToolDescriptor[] {
  const out: AgentToolDescriptor[] = [];
  for (const id of BUILTIN_TOOL_IDS) {
    const d = BUILTINS[id].descriptor;
    if (id === "rag_retrieve") {
      const kb = config.ragKbId && knowledgeBases ? knowledgeBases.get(config.ragKbId) : undefined;
      const snap = kb?.snapshot();
      const ok = Boolean(snap && snap.documents.length > 0 && snap.index && !snap.stale);
      out.push({ ...d, available: ok, unavailableReason: ok ? undefined : !config.ragKbId ? "No knowledge base attached. Add documents in the RAG lab first." : !snap ? "The attached knowledge base has expired." : snap.stale ? "The knowledge base index is stale; rebuild it in the RAG lab." : "The attached knowledge base has no documents." });
    } else out.push({ ...d, available: true });
  }
  for (const spec of config.customTools) out.push({ ...customTool(spec).descriptor, available: true });
  return out;
}

/** The tools a run actually offers the model, in the order the config lists them. */
export function buildToolset(config: AgentConfig, knowledgeBases: KnowledgeBaseStore | null): ToolImpl[] {
  const catalogue = describeTools(config, knowledgeBases);
  const byId = new Map(catalogue.map((d) => [d.id, d]));
  const impls: ToolImpl[] = [];
  const seen = new Set<string>();
  const wanted = [...config.tools, ...Object.values(config.fallbacks)];
  for (const id of wanted) {
    if (seen.has(id)) continue;
    const descriptor = byId.get(id);
    if (!descriptor || !descriptor.available) continue;
    seen.add(id);
    if (isBuiltinToolId(id)) impls.push({ descriptor, execute: BUILTINS[id].execute });
    else {
      const spec = config.customTools.find((c) => customToolId(c.slug) === id);
      if (spec) impls.push({ descriptor, execute: customTool(spec).execute });
    }
  }
  return impls;
}
