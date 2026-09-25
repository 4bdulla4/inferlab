import type { DataSource } from "@shared/llm";
import type { RunState } from "@/labs/llm/state";
import { formatMs, formatNumber } from "@/lib/format";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceDot } from "@/components/layout/SourceBadge";

interface Metric {
  label: string;
  value: string;
  source: DataSource;
  hint?: string;
}

export function metricsFor(run: RunState | undefined): Metric[] {
  const m = run?.visual.metrics;
  const v = run?.visual;
  return [
    { label: "Provider", value: run?.provider.vendor ?? "—", source: "live" },
    { label: "Model", value: v?.completion?.model ?? run?.provider.model ?? "—", source: "live" },
    { label: "Latency", value: formatMs(m?.latencyMs), source: "live", hint: "request sent → completion" },
    { label: "Time to first byte", value: formatMs(m?.ttfbMs), source: "live" },
    { label: "Generation time", value: formatMs(m?.generationMs), source: "live" },
    { label: "Input tokens", value: formatNumber(m?.inputTokens ?? m?.inputTokenCount), source: m?.inputTokens !== undefined ? "live" : (m?.inputTokenSource ?? "live") },
    { label: "Output tokens", value: formatNumber(m?.outputTokens), source: "live" },
    { label: "Total tokens", value: formatNumber(m?.totalTokens), source: "live" },
    { label: "Tokens / sec", value: m?.tokensPerSec ? m.tokensPerSec.toFixed(1) : "—", source: "live", hint: "output tokens ÷ generation time" },
    { label: "Streamed pieces", value: m ? String(m.streamedSteps) : "—", source: "live", hint: "chunks or tokens received" },
    { label: "Finish reason", value: m?.finishReason ?? "—", source: "live" },
    { label: "Output chars", value: m ? formatNumber(m.outputChars) : "—", source: "live" },
  ];
}

export function MetricsPanel({ run, className }: { run: RunState | undefined; className?: string }) {
  const metrics = metricsFor(run);
  return (
    <GlassPanel title="Metrics" subtitle="provider telemetry" className={className} bodyClassName="p-3">
      <dl className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-line surface-1 px-2.5 py-2 min-w-0" title={m.hint}>
            <dt className="flex items-start justify-between gap-1.5 label-caps text-[9.5px]">
              <span className="leading-[1.35] min-w-0">{m.label}</span>
              <span className="mt-0.5 shrink-0">
                <SourceDot source={m.source} />
              </span>
            </dt>
            <dd className="mono text-[13px] text-ink truncate mt-0.5">{m.value}</dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  );
}
