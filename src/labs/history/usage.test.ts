import { describe, expect, it } from "vitest";
import type { ModelRow } from "@shared/history";
import { usageByProvider } from "./usage";

const row = (model: string, vendor: string, calls: number, total: number): ModelRow => ({ model, vendor, calls, tokens: { input: total - 10, output: 10, cacheRead: 5, total } });

describe("usageByProvider", () => {
  it("sums model rows per provider, largest first, and drops the model ids", () => {
    const out = usageByProvider([row("claude-a", "Anthropic", 2, 100), row("gpt-x", "OpenAI", 1, 500), row("claude-b", "Anthropic", 3, 300)]);
    expect(out.map((r) => [r.vendor, r.calls, r.tokens.total, r.tokens.cacheRead])).toEqual([
      ["OpenAI", 1, 500, 5],
      ["Anthropic", 5, 400, 10],
    ]);
    expect(JSON.stringify(out)).not.toMatch(/claude-|gpt-/);
  });
});
