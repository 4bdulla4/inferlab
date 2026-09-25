import { AlertTriangle, Bot, RotateCcw, User } from "lucide-react";
import { runtime } from "@/engine/execution/runtime";
import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";

export function OutputPanel({ run, compact, className }: { run: RunState | undefined; compact?: boolean; className?: string }) {
  const v = run?.visual;
  const text = v?.generation.text ?? "";
  const streaming = Boolean(v?.generation.started && !v?.generation.completed && !v?.error && !v?.stopped);

  return (
    <GlassPanel
      title={compact ? (run?.provider.name ?? "Response") : "Final response"}
      subtitle={!compact ? run?.provider.name : undefined}
      actions={<SourceBadge source="live" compact={compact} />}
      className={className}
      bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll"
    >
      {!run ? (
        <p className="mono text-[11px] text-muted">The model's answer streams here, exactly as the provider returns it.</p>
      ) : (
        <>
          <div className="flex gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line surface-1">
              <User className="size-3.5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 rounded-xl rounded-tl-sm border border-line surface-1 px-3 py-2 text-[13.5px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words">
              {run.input}
            </div>
          </div>

          <div className="flex gap-3">
            <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border", streaming ? "border-live/50 bg-live/10" : "border-accent/50 bg-accent/10")}>
              <Bot className={cn("size-3.5", streaming ? "text-live" : "text-accent-soft")} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 grid gap-2">
              {v?.generation.reasoning ? (
                <details className="rounded-lg border border-line surface-1 px-3 py-1.5 text-[12px] text-muted">
                  <summary className="cursor-pointer mono text-[10.5px] uppercase tracking-[0.12em]">Reasoning summary · live</summary>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed">{v.generation.reasoning}</p>
                </details>
              ) : null}
              <div className={cn("rounded-xl rounded-tl-sm border px-3.5 py-2.5 text-[14px] leading-relaxed text-ink whitespace-pre-wrap break-words min-h-[44px]", streaming ? "border-live/30 bg-live/[0.04]" : "border-accent/25 bg-accent/[0.05]")}>
                {text ? text : streaming ? <span className="shimmer-text mono text-[12px]">waiting for first token…</span> : v?.error ? <span className="text-muted">No output.</span> : <span className="shimmer-text mono text-[12px]">preparing request…</span>}
                {streaming && text ? <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" /> : null}
              </div>
              {v?.notices.map((n, i) => (
                <p key={i} className={cn("mono text-[11px] leading-snug", n.level === "warn" ? "text-warn" : "text-muted")}>
                  {n.level === "warn" ? "⚠ " : "ℹ "}
                  {n.message}
                </p>
              ))}
              {v?.error ? (
                <div role="alert" className="rounded-lg border border-err/40 bg-err/10 p-3 grid gap-2">
                  <p className="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.12em] text-err">
                    <AlertTriangle className="size-3.5" /> API error · {run.provider.name}
                    {v.error.status ? <Badge tone="err">HTTP {v.error.status}</Badge> : null}
                  </p>
                  <p className="text-[12.5px] text-ink-dim break-words">{v.error.message}</p>
                  <p className="mono text-[10.5px] text-muted">failed at stage: {v.error.stage}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" icon={<RotateCcw />} onClick={() => runtime.retry(run.id)}>
                      Retry
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => runtime.resetAll()}>
                      Reset
                    </Button>
                  </div>
                </div>
              ) : null}
              {v?.stopped ? <p className="mono text-[11px] text-warn">Stopped by user. The provider request was aborted.</p> : null}
            </div>
          </div>

          {v?.completion || v?.usage ? (
            <dl className="mono grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[11px]">
              <Meta label="model" value={v.completion?.model ?? run.provider.model} />
              <Meta label="latency" value={formatMs(v.completion?.latencyMs)} />
              <Meta label="input tokens" value={formatNumber(v.usage?.inputTokens)} />
              <Meta label="output tokens" value={formatNumber(v.usage?.outputTokens)} />
              <Meta label="total tokens" value={formatNumber(v.usage?.totalTokens)} />
              <Meta label="generation" value={formatMs(v.completion?.generationMs)} />
              <Meta label="finish reason" value={v.completion?.finishReason ?? "—"} />
              <Meta label="ttfb" value={formatMs(v.completion?.ttfbMs ?? v.generation.ttfbMs)} />
            </dl>
          ) : null}
        </>
      )}
    </GlassPanel>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="text-ink-dim truncate">{value}</dd>
    </div>
  );
}
