import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { useExecutionStore } from "@/store/executionStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { metricsFor } from "./MetricsPanel";
import { MiniPipeline } from "./MiniPipeline";
import { OutputPanel } from "./OutputPanel";

export function ComparisonView({ runs }: { runs: RunState[] }) {
  const activeRunId = useExecutionStore((s) => s.activeRunId);
  const setActiveRun = useExecutionStore((s) => s.setActiveRun);
  const columns = runs.map(metricsFor);
  const rows = columns[0]?.map((m) => m.label) ?? [];
  const input = runs[0]?.input;

  return (
    <div className="grid gap-4">
      <GlassPanel title="Multi-model comparison" subtitle={input ? `“${input.length > 70 ? `${input.slice(0, 70)}…` : input}”` : undefined} actions={<SourceBadge source="live" compact />} bodyClassName="p-4 grid gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {runs.map((run) => (
            <div key={run.id} className={cn("rounded-xl border p-3 grid gap-3", activeRunId === run.id ? "border-accent/50 bg-accent/[0.04]" : "border-line")}>
              <button type="button" onClick={() => setActiveRun(run.id)} className="flex items-center gap-2 text-left" aria-pressed={activeRunId === run.id}>
                <span className="mono text-[12px] font-semibold tracking-[0.12em] uppercase text-ink">{run.provider.name}</span>
                <span className="ml-auto mono text-[10px] text-muted">{activeRunId === run.id ? "shown in pipeline" : "show in pipeline →"}</span>
              </button>
              <MiniPipeline run={run} onFocus={() => setActiveRun(run.id)} />
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="label-caps text-left">
                <th className="py-2 pr-3 font-normal">Metric</th>
                {runs.map((r) => (
                  <th key={r.id} className="py-2 pr-3 font-normal text-ink-dim">{r.provider.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="mono">
              {rows.map((label, i) => (
                <tr key={label} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-muted">{label}</td>
                  {columns.map((col, c) => (
                    <td key={c} className="py-1.5 pr-3 text-ink">{col[i]?.value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">Only metrics the providers actually report are compared. Tokenizers differ between vendors, so token counts are not directly comparable.</p>
        </div>
      </GlassPanel>
      <div className="grid gap-4 lg:grid-cols-2">
        {runs.map((run) => (
          <OutputPanel key={run.id} run={run} compact />
        ))}
      </div>
    </div>
  );
}
