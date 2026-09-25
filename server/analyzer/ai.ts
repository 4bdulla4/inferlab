import Anthropic from "@anthropic-ai/sdk";
import type { AiStatus, AiUsage, RepoAnalysis, TraceResult, TraceStep } from "@shared/repo";
import { createAnthropicClient } from "../providers/claude/ClaudeProvider";

export interface AiAnalyzerOptions {
  apiKey: string | undefined;
  model: string;
  workspaceId?: string;
}

/** One index text per analysis so every model call shares the same cached prefix. */
const INDEX_BUDGET = 60_000;

function usageOf(res: Anthropic.Message): AiUsage {
  return {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
  };
}

interface SummaryOutput {
  overview: string;
  headline: string;
  nodes: { id: string; summary: string }[];
}

interface TraceOutput {
  answer: string;
  confidence: "high" | "medium" | "low";
  steps: { title: string; description: string; nodeId?: string; file?: string; line?: number; symbol?: string; edgeId?: string }[];
}

export const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "headline", "nodes"],
  properties: {
    headline: { type: "string", description: "One sentence: what this product is and does." },
    overview: { type: "string", description: "3-6 sentences describing how the product works end to end, referencing modules by their node labels." },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "summary"],
        properties: { id: { type: "string" }, summary: { type: "string", description: "1-2 sentences on this module's role in the product." } },
      },
    },
  },
};

export const TRACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "steps"],
  properties: {
    answer: { type: "string", description: "Direct answer to the question in 2-5 sentences, citing file paths." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    steps: {
      // Structured outputs reject minItems > 1 / maxItems; the count is bounded in code instead.
      type: "array",
      description: "Between 2 and 14 ordered steps.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          nodeId: { type: "string", description: "Architecture node id from the index, if applicable." },
          file: { type: "string", description: "Exact repository path from the index." },
          line: { type: "integer" },
          symbol: { type: "string", description: "Function/class name from the index." },
          edgeId: { type: "string", description: "Edge id from the index when this step follows a known relationship." },
        },
      },
    },
  },
};

/**
 * Optional model-powered layer. Everything it returns is labelled `kind: "ai"`
 * and cross-checked against the verified repository index before display.
 */
export class AiAnalyzer {
  private readonly client: Anthropic | null;

  constructor(private readonly options: AiAnalyzerOptions) {
    this.client = options.apiKey ? createAnthropicClient(options.apiKey, options.workspaceId) : null;
  }

  status(): AiStatus {
    return this.client
      ? { available: true, model: this.options.model, note: "Model-generated summaries and traces are labelled AI-INFERRED and checked against the repository index. Each question is one model call; the repository index is prompt-cached so follow-up questions cost far less." }
      : { available: false, note: "Set ANTHROPIC_API_KEY on the server (or enter a session key in Settings) to enable AI-inferred summaries and question answering. Verified facts and heuristic tracing work without it." };
  }

  /**
   * System prompt = [cached repository index] + [task instructions]. The index
   * comes first so summaries and every question share one cached prefix.
   */
  private systemFor(analysis: RepoAnalysis, task: string): Anthropic.TextBlockParam[] {
    return [
      { type: "text", text: `You are given a VERIFIED index extracted from a GitHub repository (files with symbols and import relationships, HTTP routes with file:line, architecture nodes with ids, edges with ids, schema, jobs, infra, env vars).\n\nRepository index:\n\n${buildIndex(analysis, INDEX_BUDGET, true)}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: task },
    ];
  }

  async summarize(analysis: RepoAnalysis, signal?: AbortSignal): Promise<{ headline: string; overview: string; nodes: Record<string, string>; usage: AiUsage } | null> {
    if (!this.client) return null;
    // Output scales with the number of modules; truncated JSON cannot be parsed.
    const maxTokens = Math.min(8000, 1200 + analysis.graph.nodes.length * 140);
    const res = await this.client.messages.create(
      {
        model: this.options.model,
        max_tokens: maxTokens,
        system: this.systemFor(
          analysis,
          "You are a senior software architect documenting this codebase for engineers. Describe how the product works using only what the index supports. Refer to modules by their node labels. Never invent files, services or behaviour that the index does not contain; when something is uncertain say so briefly. Be concrete and concise.",
        ),
        messages: [{ role: "user", content: "Write the headline, overview, and a 1-2 sentence role summary for every architecture node id listed under NODES." }],
        output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA }, effort: "low" },
      },
      { signal, timeout: 90_000 },
    );
    const parsed = parseJson<SummaryOutput>(res, "summarize");
    if (!parsed) return null;
    const valid = new Set(analysis.graph.nodes.map((n) => n.id));
    const nodes: Record<string, string> = {};
    for (const n of parsed.nodes) if (valid.has(n.id) && n.summary) nodes[n.id] = n.summary.trim();
    return { headline: parsed.headline.trim(), overview: parsed.overview.trim(), nodes, usage: usageOf(res) };
  }

  async trace(analysis: RepoAnalysis, question: string, id: string, signal?: AbortSignal): Promise<TraceResult | null> {
    if (!this.client) return null;
    const res = await this.client.messages.create(
      {
        model: this.options.model,
        max_tokens: 3000,
        system: this.systemFor(
          analysis,
          "You trace code paths through this repository for engineers. Answer the user's question by listing the ordered steps a request/action takes through the code. Every step must reference a nodeId, file path, symbol or edgeId that appears verbatim in the index. If the index lacks the information, say so in the answer, lower the confidence, and keep steps to what is supported. Never fabricate paths or function names. Keep descriptions to one or two sentences.",
        ),
        messages: [{ role: "user", content: `Question: ${question.trim()}` }],
        output_config: { format: { type: "json_schema", schema: TRACE_SCHEMA }, effort: "low" },
      },
      { signal, timeout: 120_000 },
    );
    const parsed = parseJson<TraceOutput>(res, "trace");
    if (!parsed) return null;
    const nodeIds = new Set(analysis.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(analysis.graph.edges.map((e) => e.id));
    const files = new Map(analysis.files.map((f) => [f.path, f]));
    const notes: string[] = ["AI-inferred trace: the model proposed these steps; each file, symbol, node and edge reference was checked against the repository index."];
    let unverified = 0;
    const steps: TraceStep[] = parsed.steps.slice(0, 14).map((s, i) => {
      const file = s.file ? resolveFile(s.file, files) : undefined;
      const symbolExists = Boolean(file && s.symbol && files.get(file)?.symbols.some((x) => x.name === s.symbol));
      const nodeExists = Boolean(s.nodeId && nodeIds.has(s.nodeId));
      const nodeId = nodeExists ? s.nodeId : file ? analysis.graph.nodes.find((n) => n.files.includes(file))?.id : undefined;
      const edgeId = s.edgeId && edgeIds.has(s.edgeId) ? s.edgeId : undefined;
      if ((s.file && !file) || (s.symbol && !symbolExists) || (s.nodeId && !nodeExists)) unverified++;
      const line = file && s.symbol && symbolExists ? files.get(file)!.symbols.find((x) => x.name === s.symbol)!.line : s.line;
      return { index: i + 1, title: s.title, description: s.description, nodeId, edgeId, file, line, symbol: s.symbol, kind: "ai", verification: { nodeExists: Boolean(nodeId), fileExists: Boolean(file), symbolExists } };
    });
    if (unverified > 0) notes.push(`${unverified} step reference${unverified === 1 ? "" : "s"} could not be matched to the index and are shown with a warning.`);
    return { id, analysisId: analysis.id, question, answer: parsed.answer, steps, source: "ai", model: res.model, confidence: parsed.confidence, notes, createdAt: Date.now(), usage: usageOf(res) };
  }
}

/** Parses the structured response; logs only metadata (never content) when it cannot be used. */
function parseJson<T>(res: Anthropic.Message, task: string): T | null {
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const diag = `stop_reason=${res.stop_reason} out_tokens=${res.usage.output_tokens} text_chars=${text.length} blocks=${res.content.map((b) => b.type).join(",")}`;
  if (res.stop_reason === "refusal") {
    console.log(`[ai] ${task}: model declined (${diag})`);
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    console.log(`[ai] ${task}: response was not valid JSON (${diag})${res.stop_reason === "max_tokens" ? " — output hit max_tokens" : ""}`);
    return null;
  }
}

function resolveFile(candidate: string, files: Map<string, unknown>): string | undefined {
  const c = candidate.replace(/^\.?\//, "").trim();
  if (files.has(c)) return c;
  const suffix = [...files.keys()].filter((p) => p.endsWith(`/${c}`) || p.endsWith(c));
  if (suffix.length === 1) return suffix[0];
  return undefined;
}

/** Compact textual index of verified facts, truncated to a character budget. */
export function buildIndex(a: RepoAnalysis, budget: number, includeImports = false): string {
  const lines: string[] = [];
  lines.push(`REPO ${a.meta.fullName} @ ${a.meta.sha.slice(0, 10)} — ${a.meta.description ?? "no description"}`);
  lines.push(`STATS files=${a.stats.totalFiles} scanned=${a.stats.scannedFiles} languages=${Object.entries(a.stats.languages).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(",")}`);
  lines.push(`STACK ${a.integrations.map((i) => `${i.name}[${i.category}]`).join("; ")}`);
  lines.push("");
  lines.push("NODES (id | label | category | summary | files… | key symbols…)");
  for (const n of a.graph.nodes) {
    lines.push(`- ${n.id} | ${n.label} | ${n.category} | ${n.summary} | files: ${n.files.slice(0, 12).join(", ")}${n.files.length > 12 ? ` (+${n.files.length - 12})` : ""} | symbols: ${n.symbols.slice(0, 12).map((s) => `${s.name}@${s.file.split("/").pop()}:${s.line}`).join(", ")}${n.envVars.length ? ` | env: ${n.envVars.slice(0, 8).join(",")}` : ""}`);
  }
  lines.push("");
  lines.push("EDGES (id | from → to | kind | label | evidence)");
  for (const e of a.graph.edges.slice(0, 120)) lines.push(`- ${e.id} | ${e.from} → ${e.to} | ${e.kind} | ${e.label} | ${e.evidence.kind}${e.evidence.file ? ` ${e.evidence.file}:${e.evidence.line ?? ""}` : ""}`);
  lines.push("");
  lines.push("ROUTES (method path | file:line | handler | kind)");
  for (const r of a.routes.slice(0, 160)) lines.push(`- ${r.method} ${r.path} | ${r.file}:${r.line} | ${r.handler ?? "-"} | ${r.kind}`);
  if (a.schema.length) {
    lines.push("");
    lines.push("SCHEMA");
    for (const s of a.schema.slice(0, 60)) lines.push(`- ${s.name} (${s.kind}) ${s.file}:${s.line} fields: ${s.fields.slice(0, 12).join(",")}`);
  }
  if (a.jobs.length) {
    lines.push("");
    lines.push("JOBS");
    for (const j of a.jobs.slice(0, 40)) lines.push(`- ${j.kind} ${j.name}${j.schedule ? ` [${j.schedule}]` : ""} ${j.file}:${j.line} (${j.library})`);
  }
  if (a.infra.length) {
    lines.push("");
    lines.push("INFRA");
    for (const c of a.infra.slice(0, 30)) lines.push(`- ${c.kind} ${c.file}: ${c.summary}`);
  }
  lines.push("");
  lines.push(`ENV ${a.envVars.slice(0, 80).map((v) => v.name).join(", ")}`);
  if (includeImports) {
    lines.push("");
    lines.push("FILES (path | roles | symbols | imports→resolved)");
    const scanned = a.files.filter((f) => f.scanned && f.symbols.length + f.imports.length > 0).sort((x, y) => y.importedBy.length - x.importedBy.length);
    for (const f of scanned) {
      const line = `- ${f.path} | ${f.roles.join(",")} | ${f.symbols.slice(0, 14).map((s) => `${s.name}:${s.line}`).join(",")} | ${f.imports.filter((i) => i.resolved).slice(0, 10).map((i) => i.resolved).join(",")}`;
      if (lines.join("\n").length + line.length > budget) break;
      lines.push(line);
    }
  }
  let out = lines.join("\n");
  if (out.length > budget) out = `${out.slice(0, budget)}\n… (index truncated)`;
  return out;
}
