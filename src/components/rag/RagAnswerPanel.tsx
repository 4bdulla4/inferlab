import { Bot, User } from "lucide-react";
import type { RagRunState } from "@/labs/rag/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useRagStore } from "@/store/ragStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";

/**
 * The answer as the model wrote it, with every [n] marker turned into a chip
 * that points at the passage behind it, and the run's real telemetry beneath.
 */
export function RagAnswerPanel({ run, className, compact }: { run: RagRunState | undefined; className?: string; compact?: boolean }) {
  const v = run?.visual;
  const selectChunk = useRagStore((s) => s.selectChunk);
  const selectStage = useRagStore((s) => s.selectStage);
  const streaming = Boolean(v?.llm.requestSentAt) && !v?.llm.completed && !v?.error && !v?.stopped;
  const citations = v?.citations ?? [];
  const byMarker = new Map(citations.map((c) => [c.marker, c]));

  const openCitation = (marker: number) => {
    const c = byMarker.get(marker);
    if (!c) return;
    selectChunk(c.chunkId);
    selectStage("citations");
  };

  return (
    <GlassPanel
      title={compact ? run?.comparisonLabel ?? "Answer" : "Generated answer"}
      subtitle={run && !compact ? String(v?.prompt?.provider ?? run.settings.llmProvider) : run?.comparisonLabel ? `${run.settings.retrievalStrategy} · top-${run.settings.topK} · ${run.settings.vectorIndex}` : undefined}
      actions={<SourceBadge source="live" compact={compact} />}
      className={className}
      bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll"
    >
      {!run || run.kind !== "query" ? (
        <p className="mono text-[11px] text-muted">The answer streams here, cited back to the passages it came from.</p>
      ) : (
        <>
          <div className="flex gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line surface-1">
              <User className="size-3.5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 rounded-xl rounded-tl-sm border border-line surface-1 px-3 py-2 text-[13px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words">{run.label}</div>
          </div>
          <div className="flex gap-3">
            <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border", streaming ? "border-live/50 bg-live/10" : "border-accent/50 bg-accent/10")}>
              <Bot className={cn("size-3.5", streaming ? "text-live" : "text-accent-soft")} aria-hidden="true" />
            </span>
            <div className={cn("min-w-0 flex-1 rounded-xl rounded-tl-sm border px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words min-h-[44px]", streaming ? "border-live/30 bg-live/[0.04]" : "border-accent/25 bg-accent/[0.05]")}>
              {v?.llm.text ? (
                renderWithCitations(v.llm.text, byMarker, openCitation)
              ) : streaming ? (
                <span className="shimmer-text mono text-[12px]">waiting for the first token…</span>
              ) : v?.error ? (
                <span className="text-err text-[12.5px]">{v.error.message}</span>
              ) : (
                <span className="shimmer-text mono text-[12px]">retrieving…</span>
              )}
              {streaming && v?.llm.text ? <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" /> : null}
            </div>
          </div>

          {citations.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="label-caps mr-1">Sources</span>
              {citations.map((c) => (
                <button key={c.marker} type="button" onClick={() => openCitation(c.marker)} className="mono inline-flex h-6 items-center gap-1.5 rounded-md border border-live/40 bg-live/10 px-2 text-[10.5px] text-live hover:bg-live/20" title={c.chunkId}>
                  [{c.marker}] <span className="text-ink-dim normal-case max-w-[180px] truncate">{c.docName}</span>
                  {c.page ? <span className="text-faint">p.{c.page}</span> : null}
                </button>
              ))}
            </div>
          ) : v?.llm.completed ? (
            <p className="mono text-[10.5px] text-warn">The model did not use any [n] markers, so no claim can be traced to a passage.</p>
          ) : null}

          {!compact ? (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mono text-[11px] border-t border-line pt-3">
              <Stat label="retrieved" value={v ? `${v.results.length} passages` : "—"} />
              <Stat label="context" value={v?.context ? `${formatNumber(v.context.tokenCount)} tok` : "—"} />
              <Stat label="first token" value={v?.llm.ttfbMs !== undefined ? formatMs(v.llm.ttfbMs) : "—"} />
              <Stat label="latency" value={v?.llm.latencyMs !== undefined ? formatMs(v.llm.latencyMs) : "—"} />
              <Stat label="input tokens" value={v?.llm.usage?.inputTokens != null ? formatNumber(v.llm.usage.inputTokens) : "—"} />
              <Stat label="output tokens" value={v?.llm.usage?.outputTokens != null ? formatNumber(v.llm.usage.outputTokens) : "—"} />
              <Stat label="finish" value={v?.llm.finishReason ?? "—"} />
              <Stat label="end to end" value={v?.llm.totalMs !== undefined ? formatMs(v.llm.totalMs) : "—"} />
            </dl>
          ) : (
            <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
              <Badge>{v?.results.length ?? 0} retrieved</Badge>
              <Badge>{v?.context ? `${v.context.tokenCount} ctx tok` : "—"}</Badge>
              <Badge>{v?.llm.latencyMs !== undefined ? formatMs(v.llm.latencyMs) : "—"}</Badge>
              <Badge>{v?.llm.usage ? `${v.llm.usage.inputTokens ?? "?"}/${v.llm.usage.outputTokens ?? "?"} tok` : "—"}</Badge>
            </div>
          )}
        </>
      )}
    </GlassPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label-caps text-[9.5px]">{label}</dt>
      <dd className="text-ink truncate">{value}</dd>
    </div>
  );
}

/** Turns "[2]" in the answer into a clickable chip when a citation with that number exists. */
function renderWithCitations(text: string, byMarker: Map<number, unknown>, onOpen: (marker: number) => void): React.ReactNode {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return parts.map((part, i) => {
    const m = /^\[(\d{1,2})\]$/.exec(part);
    if (!m) return <span key={i}>{part}</span>;
    const n = Number(m[1]);
    if (!byMarker.has(n)) return <span key={i}>{part}</span>;
    return (
      <button key={i} type="button" onClick={() => onOpen(n)} className="mono mx-0.5 inline-flex h-5 items-center rounded border border-live/50 bg-live/15 px-1 text-[10.5px] text-live align-[0.1em] hover:bg-live/25" title="Open the cited passage">
        {n}
      </button>
    );
  });
}
