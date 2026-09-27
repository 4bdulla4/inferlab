import type { ModelRow, TokenTotals } from "@shared/history";

/** Sums per-model usage rows into one row per provider, largest first. */
export function usageByProvider(models: ModelRow[]): { vendor: string; calls: number; tokens: TokenTotals }[] {
  const byVendor = new Map<string, { vendor: string; calls: number; tokens: TokenTotals }>();
  for (const m of models) {
    const row = byVendor.get(m.vendor) ?? { vendor: m.vendor, calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, total: 0 } };
    row.calls += m.calls;
    row.tokens = { input: row.tokens.input + m.tokens.input, output: row.tokens.output + m.tokens.output, cacheRead: row.tokens.cacheRead + m.tokens.cacheRead, total: row.tokens.total + m.tokens.total };
    byVendor.set(m.vendor, row);
  }
  return [...byVendor.values()].sort((a, b) => b.tokens.total - a.tokens.total);
}
