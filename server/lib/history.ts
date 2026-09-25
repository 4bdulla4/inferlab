import fs from "node:fs";
import path from "node:path";
import type {
  DailyBucket,
  HistoryEntry,
  HistoryInput,
  HistoryResponse,
  HistoryStats,
  ModelRow,
  RepoAnalysisEntry,
  RepoSummaryRow,
  TokenTotals,
  LlmRunEntry,
  RepoAiEntry,
} from "@shared/history";

const MAX_ENTRIES = 1000;
const DAILY_DAYS = 14;

function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, total: 0 };
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Append-only activity log persisted as JSON next to the project. It records
 * what was analyzed and every model call, so usage survives restarts.
 * Never stores code, keys or model output — only metadata and counts.
 */
export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private loaded = false;
  private writeTimer: NodeJS.Timeout | null = null;
  private truncated = false;

  constructor(private readonly filePath: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { entries?: HistoryEntry[]; truncated?: boolean };
        if (Array.isArray(parsed.entries)) this.entries = parsed.entries.filter((e) => e && typeof e.at === "number");
        this.truncated = Boolean(parsed.truncated);
      }
    } catch {
      this.entries = [];
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify({ entries: this.entries, truncated: this.truncated }), { mode: 0o600 });
      } catch {
        /* history is best-effort; never break a request over it */
      }
    }, 250);
    this.writeTimer.unref?.();
  }

  record(entry: HistoryInput): HistoryEntry {
    this.load();
    const full = { ...entry, id: entry.id ?? `${entry.kind}-${entry.at}-${Math.random().toString(36).slice(2, 8)}` } as HistoryEntry;
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      this.truncated = true;
    }
    this.scheduleWrite();
    return full;
  }

  all(): HistoryEntry[] {
    this.load();
    return [...this.entries].sort((a, b) => b.at - a.at);
  }

  clear(): void {
    this.load();
    this.entries = [];
    this.truncated = false;
    this.scheduleWrite();
  }

  response(limit = 200): HistoryResponse {
    const all = this.all();
    return { entries: all.slice(0, limit), stats: computeStats(all), truncated: this.truncated };
  }
}

export function computeStats(entries: HistoryEntry[]): HistoryStats {
  const stats: HistoryStats = {
    totals: { entries: entries.length, llmRuns: 0, analyses: 0, questions: 0, summaries: 0, ragQueries: 0, ragDocuments: 0, agentRuns: 0, mlRuns: 0, errors: 0 },
    tokens: emptyTokens(),
    byVendor: {},
    models: [],
    repos: [],
    daily: [],
    llm: { avgLatencyMs: null, avgTtfbMs: null, totalOutputTokens: 0 },
    analysis: { avgDurationMs: null, totalFilesScanned: 0, totalNodes: 0 },
    firstAt: null,
    lastAt: null,
  };

  const modelMap = new Map<string, ModelRow>();
  const repoMap = new Map<string, RepoSummaryRow>();
  const dayMap = new Map<string, DailyBucket>();
  let latencySum = 0;
  let latencyCount = 0;
  let ttfbSum = 0;
  let ttfbCount = 0;
  let analysisDurationSum = 0;
  let analysisCount = 0;

  const bumpVendor = (vendor: string, t: Partial<TokenTotals>) => {
    const v = (stats.byVendor[vendor] ??= emptyTokens());
    v.input += t.input ?? 0;
    v.output += t.output ?? 0;
    v.cacheRead += t.cacheRead ?? 0;
    v.total += (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0);
    stats.tokens.input += t.input ?? 0;
    stats.tokens.output += t.output ?? 0;
    stats.tokens.cacheRead += t.cacheRead ?? 0;
    stats.tokens.total += (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0);
  };

  const bumpModel = (model: string, vendor: string, t: Partial<TokenTotals>) => {
    const row = modelMap.get(model) ?? { model, vendor, calls: 0, tokens: emptyTokens() };
    row.calls += 1;
    row.tokens.input += t.input ?? 0;
    row.tokens.output += t.output ?? 0;
    row.tokens.cacheRead += t.cacheRead ?? 0;
    row.tokens.total = row.tokens.input + row.tokens.output + row.tokens.cacheRead;
    modelMap.set(model, row);
  };

  const day = (at: number) => {
    const k = dayKey(at);
    const b = dayMap.get(k) ?? { date: k, llmRuns: 0, analyses: 0, questions: 0, ragQueries: 0, tokens: 0 };
    dayMap.set(k, b);
    return b;
  };

  for (const e of entries) {
    stats.firstAt = stats.firstAt === null ? e.at : Math.min(stats.firstAt, e.at);
    stats.lastAt = stats.lastAt === null ? e.at : Math.max(stats.lastAt, e.at);
    if (!e.ok) stats.totals.errors += 1;
    const bucket = day(e.at);

    if (e.kind === "llm_run") {
      const r = e as LlmRunEntry;
      stats.totals.llmRuns += 1;
      bucket.llmRuns += 1;
      const t = { input: r.inputTokens ?? 0, output: r.outputTokens ?? 0, cacheRead: 0 };
      bumpVendor(r.vendor, t);
      bumpModel(r.model, r.vendor, t);
      bucket.tokens += t.input + t.output;
      stats.llm.totalOutputTokens += t.output;
      if (typeof r.latencyMs === "number") {
        latencySum += r.latencyMs;
        latencyCount += 1;
      }
      if (typeof r.ttfbMs === "number") {
        ttfbSum += r.ttfbMs;
        ttfbCount += 1;
      }
    } else if (e.kind === "repo_analysis") {
      const a = e as RepoAnalysisEntry;
      stats.totals.analyses += 1;
      bucket.analyses += 1;
      stats.analysis.totalFilesScanned += a.filesScanned;
      stats.analysis.totalNodes += a.nodes;
      if (typeof a.durationMs === "number") {
        analysisDurationSum += a.durationMs;
        analysisCount += 1;
      }
      const row = repoMap.get(a.repo) ?? { repo: a.repo, url: a.url, analyses: 0, questions: 0, lastAt: 0, lastSha: a.sha, isPrivate: a.isPrivate, filesScanned: a.filesScanned, nodes: a.nodes };
      row.analyses += 1;
      if (a.at >= row.lastAt) {
        row.lastAt = a.at;
        row.lastSha = a.sha;
        row.filesScanned = a.filesScanned;
        row.nodes = a.nodes;
        row.isPrivate = a.isPrivate;
        row.url = a.url;
      }
      repoMap.set(a.repo, row);
    } else if (e.kind === "rag_ingest") {
      stats.totals.ragDocuments += 1;
      if (typeof e.embedTokens === "number" && e.embedTokens > 0) {
        const vendor = e.embeddingProvider === "openai" ? "OpenAI" : e.embeddingProvider === "gemini" ? "Google" : "Local";
        const t = { input: e.embedTokens, output: 0, cacheRead: 0 };
        bumpVendor(vendor, t);
        bumpModel(e.embeddingModel, vendor, t);
        bucket.tokens += e.embedTokens;
      }
    } else if (e.kind === "ml_run") {
      stats.totals.mlRuns = (stats.totals.mlRuns ?? 0) + 1;
    } else if (e.kind === "agent_run") {
      stats.totals.agentRuns = (stats.totals.agentRuns ?? 0) + 1;
      bucket.agentRuns = (bucket.agentRuns ?? 0) + 1;
      // The offline planner's counts are synthetic; only real providers are billed.
      const t = { input: e.inputTokens ?? 0, output: e.outputTokens ?? 0, cacheRead: 0 };
      if (!e.mock && t.input + t.output > 0) {
        bumpVendor(e.vendor, t);
        bumpModel(e.model, e.vendor, t);
        bucket.tokens += t.input + t.output;
        stats.llm.totalOutputTokens += t.output;
      }
    } else if (e.kind === "rag_query") {
      stats.totals.ragQueries += 1;
      bucket.ragQueries += 1;
      const t = { input: e.inputTokens ?? 0, output: e.outputTokens ?? 0, cacheRead: 0 };
      if (t.input + t.output > 0) {
        bumpVendor(e.vendor, t);
        if (e.model) bumpModel(e.model, e.vendor, t);
        bucket.tokens += t.input + t.output;
        stats.llm.totalOutputTokens += t.output;
      }
      if (typeof e.latencyMs === "number") {
        latencySum += e.latencyMs;
        latencyCount += 1;
      }
    } else {
      const q = e as RepoAiEntry;
      if (q.kind === "repo_ask") {
        stats.totals.questions += 1;
        bucket.questions += 1;
      } else {
        stats.totals.summaries += 1;
      }
      if (q.usage) {
        const t = { input: q.usage.inputTokens, output: q.usage.outputTokens, cacheRead: q.usage.cacheReadTokens };
        bumpVendor("Anthropic", t);
        if (q.model) bumpModel(q.model, "Anthropic", t);
        bucket.tokens += t.input + t.output + t.cacheRead;
      }
      if (q.repo) {
        const row = repoMap.get(q.repo);
        if (row && q.kind === "repo_ask") row.questions += 1;
      }
    }
  }

  stats.llm.avgLatencyMs = latencyCount ? Math.round(latencySum / latencyCount) : null;
  stats.llm.avgTtfbMs = ttfbCount ? Math.round(ttfbSum / ttfbCount) : null;
  stats.analysis.avgDurationMs = analysisCount ? Math.round(analysisDurationSum / analysisCount) : null;
  stats.models = [...modelMap.values()].sort((a, b) => b.calls - a.calls);
  stats.repos = [...repoMap.values()].sort((a, b) => b.lastAt - a.lastAt);

  // Last N days, including days with no activity so the chart has a stable axis.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = DAILY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const k = dayKey(d.getTime());
    stats.daily.push(dayMap.get(k) ?? { date: k, llmRuns: 0, analyses: 0, questions: 0, ragQueries: 0, tokens: 0 });
  }
  return stats;
}
