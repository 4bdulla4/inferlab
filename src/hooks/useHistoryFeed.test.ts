import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@shared/history";
import { describeEntry } from "./useHistoryFeed";

describe("notification feed titles", () => {
  it("name the provider, never the model id", () => {
    const entries = [
      { id: "1", kind: "llm_run", at: 1, ok: true, vendor: "Anthropic", model: "claude-opus-5", finishReason: "end_turn", totalTokens: 10 },
      { id: "2", kind: "rag_query", at: 1, ok: true, vendor: "Anthropic", llmProvider: "claude", model: "claude-opus-5", retrieved: 3, strategy: "hybrid" },
      { id: "3", kind: "agent_run", at: 1, ok: true, vendor: "OpenAI", model: "gpt-5.6", mock: false, reason: "completed", iterations: 2, toolCalls: 3 },
    ] as unknown as HistoryEntry[];
    const titles = entries.map((e) => describeEntry(e).title);
    expect(titles).toEqual(["LLM request · Anthropic", "RAG question · Anthropic", "Agent · OpenAI"]);
    expect(JSON.stringify(entries.map(describeEntry))).not.toMatch(/claude-opus|gpt-5/);
  });
});

describe("notification feed window", () => {
  it("keeps only the last 24 hours, newest twelve at most", async () => {
    const { recentFeed, FEED_WINDOW_MS } = await import("./useHistoryFeed");
    const now = 10 * FEED_WINDOW_MS;
    const item = (id: string, ageMs: number) => ({ id, title: id, detail: "", ok: true, at: now - ageMs });
    const out = recentFeed([item("fresh", 60_000), item("almost", FEED_WINDOW_MS - 1), item("day-old", FEED_WINDOW_MS), item("old", 3 * FEED_WINDOW_MS)], now);
    expect(out.map((i) => i.id)).toEqual(["fresh", "almost"]);
    const many = Array.from({ length: 30 }, (_, i) => item(`n${i}`, i * 1000));
    expect(recentFeed(many, now)).toHaveLength(12);
  });
});
