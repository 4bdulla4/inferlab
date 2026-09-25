import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@shared/history";
import { HistoryStore, computeStats } from "./history";

const day = 86_400_000;
const base = (over: Partial<HistoryEntry> = {}) => ({ at: Date.now(), ok: true, ...over });

function entries(): HistoryEntry[] {
  return [
    { id: "1", kind: "llm_run", ...base(), provider: "claude", vendor: "Anthropic", model: "claude-opus-5", inputChars: 44, streaming: true, sessionKey: false, latencyMs: 2000, ttfbMs: 500, finishReason: "end_turn", inputTokens: 20, outputTokens: 100, totalTokens: 120 },
    { id: "2", kind: "llm_run", ...base({ at: Date.now() - day }), provider: "openai", vendor: "OpenAI", model: "gpt-5.6", inputChars: 44, streaming: true, sessionKey: true, latencyMs: 1000, ttfbMs: 300, inputTokens: 10, outputTokens: 40, totalTokens: 50 },
    { id: "3", kind: "llm_run", ...base({ ok: false, error: "401" }), provider: "claude", vendor: "Anthropic", model: "claude-opus-5", inputChars: 10, streaming: true, sessionKey: false },
    { id: "4", kind: "repo_analysis", ...base(), durationMs: 8000, analysisId: "a1", repo: "me/app", url: "https://github.com/me/app", sha: "abc1234", isPrivate: true, headline: "h", stack: ["Next.js"], filesScanned: 259, filesTotal: 924, bytesRead: 1000, loc: 26535, nodes: 29, edges: 106, routes: 128, models: 42, envVars: 41, deps: 30, jobs: 0, infra: 1 },
    { id: "5", kind: "repo_ask", ...base(), analysisId: "a1", repo: "me/app", model: "claude-opus-5", question: "How does auth work?", source: "ai", steps: 13, confidence: "medium", usage: { inputTokens: 150, outputTokens: 1700, cacheReadTokens: 29000, cacheWriteTokens: 0 } },
    { id: "6", kind: "repo_summarize", ...base(), analysisId: "a1", repo: "me/app", model: "claude-opus-5", usage: { inputTokens: 130, outputTokens: 2800, cacheReadTokens: 29900, cacheWriteTokens: 0 } },
  ] as HistoryEntry[];
}

describe("history stats", () => {
  it("counts every kind of activity", () => {
    const s = computeStats(entries());
    expect(s.totals).toMatchObject({ entries: 6, llmRuns: 3, analyses: 1, questions: 1, summaries: 1, errors: 1 });
  });

  it("aggregates tokens per vendor and model, including cache reads", () => {
    const s = computeStats(entries());
    expect(s.byVendor.Anthropic!.output).toBe(100 + 1700 + 2800);
    expect(s.byVendor.Anthropic!.cacheRead).toBe(29000 + 29900);
    expect(s.byVendor.OpenAI!.total).toBe(50);
    expect(s.tokens.total).toBe(s.byVendor.Anthropic!.total + s.byVendor.OpenAI!.total);
    const opus = s.models.find((m) => m.model === "claude-opus-5")!;
    expect(opus.calls).toBe(4);
    expect(opus.vendor).toBe("Anthropic");
  });

  it("summarises repositories and averages performance", () => {
    const s = computeStats(entries());
    expect(s.repos).toHaveLength(1);
    expect(s.repos[0]).toMatchObject({ repo: "me/app", analyses: 1, questions: 1, isPrivate: true, nodes: 29 });
    expect(s.llm.avgLatencyMs).toBe(1500);
    expect(s.analysis.avgDurationMs).toBe(8000);
    expect(s.analysis.totalFilesScanned).toBe(259);
  });

  it("builds a 14 day series with today last and gaps filled", () => {
    const s = computeStats(entries());
    expect(s.daily).toHaveLength(14);
    const today = s.daily[13]!;
    expect(today.llmRuns).toBe(2);
    expect(today.analyses).toBe(1);
    expect(today.questions).toBe(1);
    expect(s.daily[12]!.llmRuns).toBe(1);
    expect(s.daily.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
  });

  it("handles an empty log", () => {
    const s = computeStats([]);
    expect(s.totals.entries).toBe(0);
    expect(s.firstAt).toBeNull();
    expect(s.daily).toHaveLength(14);
  });
});

describe("HistoryStore", () => {
  it("persists to disk and reloads, newest first", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hist-")), "history.json");
    const store = new HistoryStore(file);
    store.record({ kind: "llm_run", at: 1000, ok: true, provider: "claude", vendor: "Anthropic", model: "m", inputChars: 1, streaming: true, sessionKey: false });
    store.record({ kind: "llm_run", at: 2000, ok: true, provider: "claude", vendor: "Anthropic", model: "m", inputChars: 1, streaming: true, sessionKey: false });
    expect(store.all().map((e) => e.at)).toEqual([2000, 1000]);
    await new Promise((r) => setTimeout(r, 350));
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).entries).toHaveLength(2);
    const reopened = new HistoryStore(file);
    expect(reopened.all()).toHaveLength(2);
    reopened.clear();
    expect(reopened.all()).toHaveLength(0);
  });

  it("generates ids and reports stats through response()", () => {
    const store = new HistoryStore(join(mkdtempSync(join(tmpdir(), "hist-")), "h.json"));
    const rec = store.record({ kind: "llm_run", at: Date.now(), ok: true, provider: "openai", vendor: "OpenAI", model: "gpt-5.6", inputChars: 5, streaming: false, sessionKey: false, outputTokens: 7 });
    expect(rec.id).toMatch(/^llm_run-/);
    const res = store.response(10);
    expect(res.entries).toHaveLength(1);
    expect(res.stats.totals.llmRuns).toBe(1);
    expect(res.truncated).toBe(false);
  });
});
