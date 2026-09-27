import type { ToolCallRequest } from "@shared/agent";
import type { RepoAnalysis } from "@shared/repo";
import { countTokens } from "../../rag/chunker";
import type { AgentMessage, AgentModel, ModelTurn, ModelTurnRequest } from "../../agent/types";
import { extractKeywords, heuristicTrace } from "../tracer";

type Call = { name: string; args: Record<string, unknown> };

const GROUP_FACTS: Record<string, string> = {
  auth: "routes", api: "routes", payments: "routes", ui: "routes", email: "integrations", upload: "integrations",
  data: "schema", async: "jobs", ai: "integrations", deploy: "infra", search: "integrations", realtime: "integrations",
};

/**
 * The investigator without a model. It follows fixed rules: search for the
 * question's keywords, open the files with the most hits, follow the symbol the
 * heuristic tracer ranks first, then write an answer that cites only the lines
 * its tools returned. Every decision is labelled a simulation; the tool results
 * are real reads of the repository.
 */
export class OfflineInvestigatorModel implements AgentModel {
  readonly id = "mock" as const;
  readonly vendor = "inferLab (offline)";
  readonly mock = true;
  readonly model = "offline-investigator";
  private counter = 0;

  constructor(private readonly analysis: RepoAnalysis, private readonly question: string) {}

  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    const sentAt = Date.now();
    await sleep(300 + Math.round(Math.random() * 250), req.signal);
    const round = req.messages.filter((m) => m.role === "assistant").length;
    const calls = req.forceText ? [] : this.plan(round, req.messages);
    let text = "";
    let toolCalls: ToolCallRequest[] = [];
    if (calls.length) {
      toolCalls = calls.map((c) => ({ id: `offline_${++this.counter}`, name: c.name, args: c.args }));
    } else {
      text = this.answer(req.messages);
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        await sleep(6, req.signal);
        req.onTextDelta?.(piece);
      }
    }
    const inputTokens = countTokens(req.system) + req.messages.reduce((n, m) => n + countTokens(JSON.stringify(m)), 0);
    const outputTokens = countTokens(text) + toolCalls.reduce((n, c) => n + countTokens(JSON.stringify(c.args)) + 8, 0);
    return {
      text,
      toolCalls,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: Date.now() - sentAt,
      ttfbMs: toolCalls.length ? null : 90,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      model: this.model,
      source: "simulation",
    };
  }

  private keywords(): string[] {
    return [...extractKeywords(this.question).direct].filter((k) => k.length >= 3).sort((a, b) => b.length - a.length).slice(0, 3);
  }

  private plan(round: number, messages: AgentMessage[]): Call[] {
    const kw = this.keywords();
    if (round === 0) {
      const groups = extractKeywords(this.question).groups;
      const kind = GROUP_FACTS[groups[0] ?? ""] ?? "modules";
      const calls: Call[] = [{ name: "get_facts", args: { kind } }];
      if (kw.length) calls.unshift({ name: "search_code", args: { pattern: kw.map(escape).join("|"), is_regex: true, max_results: 30 } });
      return calls;
    }
    const opened = openedFiles(messages);
    if (round === 1) {
      const hits = searchHits(messages);
      const byFile = new Map<string, number[]>();
      for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h.line]);
      const top = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 2);
      const calls: Call[] = top.map(([file, lines]) => ({ name: "read_file", args: { path: file, start_line: Math.max(1, lines[0]! - 12), end_line: lines[0]! + 48 } }));
      const symbol = heuristicTrace(this.analysis, this.question, "offline").steps.find((s) => s.symbol)?.symbol;
      if (symbol) calls.push({ name: "find_symbol", args: { name: symbol } });
      if (calls.length === 0 && kw[0]) calls.push({ name: "list_files", args: { name_contains: kw[0] } });
      return calls;
    }
    if (round === 2) {
      // Follow the definition find_symbol reported, if that file is not open yet.
      const def = definitions(messages).find((d) => !opened.has(d.file));
      if (def) return [{ name: "read_file", args: { path: def.file, start_line: Math.max(1, def.line - 4), end_line: def.line + 60 } }];
    }
    return [];
  }

  private answer(messages: AgentMessage[]): string {
    const reads = readRanges(messages);
    const hits = searchHits(messages);
    const trace = heuristicTrace(this.analysis, this.question, "offline");
    const lines: string[] = [];
    lines.push(`Offline planner (simulation): the steps below were chosen by keyword rules, not by a model, so they show where "${this.question.trim()}" is most likely handled rather than an explanation of it. The files and lines cited are real reads of the repository.`);
    lines.push("");
    if (reads.length === 0 && hits.length === 0) {
      lines.push("No file matched the question's keywords, so there is nothing to cite. Try naming a feature, route or function that appears in the code.");
    } else {
      let n = 0;
      for (const r of reads) {
        const firstHit = hits.find((h) => h.file === r.file && h.line >= r.start && h.line <= r.end);
        lines.push(`${++n}. **${r.file.split("/").pop()}**: ${firstHit ? `matches the question at line ${firstHit.line} (\`${firstHit.text.slice(0, 90)}\`)` : "opened to follow the trail"}. (${r.file}:${r.start}-${r.end})`);
      }
      for (const h of hits.filter((x) => !reads.some((r) => r.file === x.file)).slice(0, 4)) lines.push(`${++n}. **${h.file.split("/").pop()}** also mentions it: \`${h.text.slice(0, 90)}\` (${h.file}:${h.line})`);
    }
    const unseen = trace.steps.filter((s) => s.file && !reads.some((r) => r.file === s.file)).slice(0, 3);
    lines.push("", "**Gaps**");
    lines.push("- The offline planner cannot read code for meaning. Connect a model provider for an explained, step-by-step answer.");
    for (const s of unseen) lines.push(`- The heuristic tracer also points at ${s.file}${s.symbol ? ` (${s.symbol})` : ""}, which was not opened.`);
    return lines.join("\n");
  }
}

/* ───────────────────── reading earlier tool results ───────────────────── */

function toolResults(messages: AgentMessage[], name: string): string[] {
  return messages.flatMap((m) => (m.role === "tool" ? m.results.filter((r) => r.name === name && !r.isError).map((r) => r.content) : []));
}

function searchHits(messages: AgentMessage[]): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const content of toolResults(messages, "search_code")) {
    for (const l of content.split("\n")) {
      const m = /^(.+?):(\d+): (.*)$/.exec(l);
      if (m) out.push({ file: m[1]!, line: Number(m[2]), text: m[3]! });
    }
  }
  return out;
}

function readRanges(messages: AgentMessage[]): { file: string; start: number; end: number }[] {
  const out: { file: string; start: number; end: number }[] = [];
  for (const content of toolResults(messages, "read_file")) {
    const m = /^(.+?) · lines (\d+)–(\d+) of/.exec(content.split("\n")[0] ?? "");
    if (m) out.push({ file: m[1]!, start: Number(m[2]), end: Number(m[3]) });
  }
  return out;
}

function openedFiles(messages: AgentMessage[]): Set<string> {
  return new Set(readRanges(messages).map((r) => r.file));
}

function definitions(messages: AgentMessage[]): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  for (const content of toolResults(messages, "find_symbol")) {
    for (const l of content.split("\n")) {
      const m = /^(\S+?):(\d+) {2}\w/.exec(l);
      if (m) out.push({ file: m[1]!, line: Number(m[2]) });
    }
  }
  return out;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}
