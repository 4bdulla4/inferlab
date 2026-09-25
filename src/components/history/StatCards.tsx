import type { HistoryStats } from "@shared/history";
import { formatMs, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function StatCards({ stats }: { stats: HistoryStats }) {
  const cards: { label: string; value: string; hint?: string; tone?: string }[] = [
    { label: "LLM runs", value: formatNumber(stats.totals.llmRuns), hint: stats.llm.avgLatencyMs !== null ? `avg ${formatMs(stats.llm.avgLatencyMs)}` : undefined },
    { label: "Repos analyzed", value: formatNumber(stats.repos.length), hint: `${stats.totals.analyses} analyses` },
    { label: "Questions traced", value: formatNumber(stats.totals.questions), hint: `${stats.totals.summaries} summaries` },
    { label: "Tokens used", value: compact(stats.tokens.total), hint: stats.tokens.cacheRead ? `${compact(stats.tokens.cacheRead)} from cache` : "across all models" },
    { label: "RAG questions", value: formatNumber(stats.totals.ragQueries ?? 0), hint: `${formatNumber(stats.totals.ragDocuments ?? 0)} documents indexed` },
    { label: "Agent runs", value: formatNumber(stats.totals.agentRuns ?? 0), hint: "goals run through the agent loop" },
    { label: "ML runs", value: formatNumber(stats.totals.mlRuns ?? 0), hint: "models trained end to end" },
    { label: "Errors", value: formatNumber(stats.totals.errors), tone: stats.totals.errors ? "err" : undefined, hint: stats.totals.errors ? "see activity below" : "none" },
  ];
  return (
    <dl className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-line surface-1 px-3 py-2.5 min-w-0">
          <dt className="label-caps text-[9.5px] truncate">{c.label}</dt>
          <dd className={cn("mono text-[20px] leading-tight mt-0.5 truncate", c.tone === "err" ? "text-err" : "text-ink")}>{c.value}</dd>
          {c.hint ? <dd className="mono text-[10px] text-faint truncate">{c.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
