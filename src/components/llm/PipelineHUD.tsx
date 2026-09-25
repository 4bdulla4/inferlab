import { memo, useEffect, useRef } from "react";
import type { DataSource } from "@shared/llm";
import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { formatMs, visibleToken } from "@/lib/format";
import { SourceBadge } from "@/components/layout/SourceBadge";

function makePos(canvasW: number, canvasH: number) {
  return (x: number, y: number, w: number, h: number) =>
    ({
      left: `${(x / canvasW) * 100}%`,
      top: `${(y / canvasH) * 100}%`,
      width: `${(w / canvasW) * 100}%`,
      height: `${(h / canvasH) * 100}%`,
    }) as const;
}

/** Overlays drawn inside the diagram: the growing context window and generation stats. */
export function PipelineHUD({ run, width, height }: { run: RunState | undefined; width: number; height: number }) {
  const pos = makePos(width, height);
  const v = run?.visual;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stepCount = v?.generation.steps.length ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [stepCount]);

  const tokens = v?.tokenization?.tokens ?? [];
  const tokSource = v?.tokenization?.source ?? "simulation";
  const steps = v?.generation.steps ?? [];
  const generating = Boolean(v?.generation.started && !v?.generation.completed && !v?.error && !v?.stopped);

  return (
    <>
      {/* Context window strip */}
      <div
        className={cn(
          "absolute rounded-lg border border-line bg-bg-elevated/70 flex flex-col overflow-hidden transition-opacity",
          tokens.length === 0 && "opacity-40",
        )}
        style={{ ...pos(36, 112, 600, 86), fontSize: "calc(11px * var(--fs))" }}
        aria-live="off"
      >
        <div className="flex items-center gap-2 px-2.5 shrink-0" style={{ height: "calc(24px * var(--fs))" }}>
          <span className="mono tracking-[0.14em] uppercase text-muted text-[0.9em]">Context window</span>
          <span className="mono text-[0.85em] text-faint">what the model conditions on · grows every step</span>
          <span className="ml-auto mono text-[0.85em] text-ink-dim">{tokens.length + steps.length} pieces</span>
        </div>
        <div ref={scrollRef} className="flex-1 flex items-center gap-[0.35em] px-2.5 overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tokens.length === 0 ? (
            <span className="mono text-faint text-[0.9em]">tokens will appear here once tokenization runs</span>
          ) : null}
          <ContextTokens tokens={tokens} tokSource={tokSource} />
          {steps.length > 0 ? <span className="mono text-faint text-[0.9em] shrink-0">▸</span> : null}
          {steps.map((s) => (
            <span
              key={`out-${s.step}`}
              className="mono shrink-0 rounded border border-live/50 bg-live/15 text-live px-[0.45em] leading-[1.7] text-[0.9em] animate-fade-up"
            >
              {visibleToken(s.token)}
            </span>
          ))}
          {generating ? <span className="mono shrink-0 text-live animate-pulse">▍</span> : null}
        </div>
      </div>

      {/* Generation statistics */}
      <div
        className={cn(
          "absolute rounded-lg border border-line bg-bg-elevated/70 px-3 flex flex-col justify-center gap-[0.2em] transition-opacity",
          !v?.generation.started && "opacity-40",
        )}
        style={{ ...pos(1120, 380, 244, 62), fontSize: "calc(11px * var(--fs))" }}
      >
        <div className="flex items-center justify-between">
          <span className="mono tracking-[0.14em] uppercase text-muted text-[0.9em]">Generation loop</span>
          <SourceBadge source="live" compact />
        </div>
        <div className="mono grid grid-cols-3 gap-2 text-[0.95em]">
          <Stat label="step" value={v?.generation.started ? String(steps.length) : "—"} />
          <Stat label="tok/s" value={v?.metrics.tokensPerSec ? v.metrics.tokensPerSec.toFixed(1) : "—"} />
          <Stat label="ttfb" value={v?.generation.ttfbMs !== undefined ? formatMs(v.generation.ttfbMs) : "—"} />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[0.75em] uppercase tracking-[0.12em] text-faint">{label}</span>
      <span className="text-ink-dim truncate">{value}</span>
    </span>
  );
}

/**
 * The prompt's tokens never change once tokenization has run, so they are held
 * apart from the generated ones and skipped on every later event.
 */
const ContextTokens = memo(function ContextTokens({ tokens, tokSource }: { tokens: string[]; tokSource: DataSource }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span
          key={`in-${i}`}
          className={cn(
            "mono shrink-0 rounded border px-[0.45em] leading-[1.7] text-[0.9em]",
            tokSource === "live" ? "border-live/30 bg-live/10 text-ink-dim" : "border-sim/30 bg-sim/10 text-ink-dim",
          )}
        >
          {visibleToken(t)}
        </span>
      ))}
    </>
  );
});
