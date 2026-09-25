import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AssembledContext, AssembledPrompt } from "@shared/rag";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";

export interface ContextInspectorProps {
  context?: AssembledContext;
  prompt?: { prompt: AssembledPrompt; provider: string; model: string };
  selectedChunkId?: string | null;
  onSelectChunk?: (chunkId: string | null) => void;
}

/**
 * Exactly what the model was given: each numbered passage, how much of the
 * token budget it used, what was retrieved but did not fit, and the full
 * system and user prompt text. Nothing here is paraphrased.
 */
export function ContextInspector({ context, prompt, selectedChunkId, onSelectChunk }: ContextInspectorProps) {
  const [showRaw, setShowRaw] = useState(false);
  if (!context) return <p className="mono text-[11px] text-muted">The context appears once passages have been retrieved and packed.</p>;

  const used = context.tokenCount;
  const pct = Math.min(100, (used / Math.max(1, context.budget)) * 100);

  return (
    <div className="grid gap-3 min-w-0">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="mono text-[11px] text-muted">
            <span className="text-ink">{formatNumber(used)}</span> of {formatNumber(context.budget)} context tokens · {context.pieces.length} passage{context.pieces.length === 1 ? "" : "s"}
            {context.dropped.length ? <span className="text-warn"> · {context.dropped.length} retrieved but dropped</span> : null}
          </p>
          <SourceBadge source="live" compact />
        </div>
        <div className="h-2 rounded surface-2 overflow-hidden flex" role="img" aria-label={`${used} of ${context.budget} tokens used`}>
          {context.pieces.map((p, i) => (
            <button
              key={p.chunkId}
              type="button"
              title={`[${p.citation}] ${p.docName} · ${p.tokenCount} tokens`}
              onClick={() => onSelectChunk?.(selectedChunkId === p.chunkId ? null : p.chunkId)}
              className={cn("h-full transition-opacity", i % 2 === 0 ? "bg-live/80" : "bg-live/50", selectedChunkId === p.chunkId && "ring-1 ring-accent-soft")}
              style={{ width: `${(p.tokenCount / Math.max(1, context.budget)) * 100}%` }}
            />
          ))}
          <span className="h-full bg-transparent" style={{ width: `${Math.max(0, 100 - pct)}%` }} aria-hidden="true" />
        </div>
      </div>

      <ol className="grid gap-1.5" aria-label="Context passages in order">
        {context.pieces.map((p) => {
          const selected = selectedChunkId === p.chunkId;
          return (
            <li key={p.chunkId}>
              <button type="button" onClick={() => onSelectChunk?.(selected ? null : p.chunkId)} aria-pressed={selected} className={cn("w-full text-left rounded-lg border px-3 py-2 grid gap-1 min-w-0", selected ? "border-accent/60 bg-accent/[0.07]" : "border-line surface-1 hover:border-line-strong")}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span className="mono text-[11px] text-accent-soft shrink-0">[{p.citation}]</span>
                  <span className="text-[11.5px] text-ink truncate">
                    {p.docName}
                    {p.page ? ` · p.${p.page}` : ""}
                  </span>
                  <span className="mono text-[10px] text-faint truncate">{p.chunkId}</span>
                  <Badge className="ml-auto shrink-0">{p.tokenCount} tok</Badge>
                </span>
                <span className="text-[11.5px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words line-clamp-4">{p.text}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {context.dropped.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/[0.06] px-3 py-2 grid gap-1">
          <p className="label-caps text-warn">Retrieved but not sent · budget full</p>
          {context.dropped.map((d) => (
            <p key={d.chunkId} className="mono text-[10.5px] text-muted truncate">
              #{d.rank} {d.chunkId} · cos {d.vectorScore.toFixed(3)}
            </p>
          ))}
        </div>
      ) : null}

      {prompt ? (
        <div className="rounded-lg border border-line">
          <button type="button" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw} className="w-full flex items-center justify-between gap-2 px-3 h-9 text-left">
            <span className="label-caps">
              Full prompt as sent · ~{formatNumber(prompt.prompt.tokenEstimate)} tokens → {prompt.provider}
            </span>
            <ChevronDown className={cn("size-4 text-muted transition-transform", showRaw && "rotate-180")} aria-hidden="true" />
          </button>
          {showRaw ? (
            <div className="border-t border-line p-3 grid gap-3">
              <div className="grid gap-1">
                <p className="label-caps text-[9.5px]">system</p>
                <pre className="mono text-[11px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words rounded-md border border-line bg-bg-elevated/60 p-2.5">{prompt.prompt.system}</pre>
              </div>
              <div className="grid gap-1">
                <p className="label-caps text-[9.5px]">user</p>
                <pre className="mono text-[11px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words rounded-md border border-line bg-bg-elevated/60 p-2.5 max-h-[320px] overflow-y-auto panel-scroll">{prompt.prompt.user}</pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
