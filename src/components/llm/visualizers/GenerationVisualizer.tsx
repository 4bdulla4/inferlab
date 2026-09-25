import { useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import type { VisualState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { formatMs, visibleToken } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";

/** Recent steps rendered inline; the panel itself scrolls, so no nested scroll area. */
const VISIBLE_STEPS = 12;

export function GenerationVisualizer({ visual, variant, reducedMotion }: { visual: VisualState | undefined; variant: "nextToken" | "loop"; reducedMotion: boolean }) {
  const mode = useUIStore((s) => s.mode);
  const gen = visual?.generation;
  const steps = gen?.steps ?? [];

  /**
   * Each row shows the text generated before its token. Building that prefix per
   * row rescans the whole list, so with a long answer the cost grows with the
   * square of the token count on every render. One pass, memoized, instead.
   */
  const rows = useMemo(() => {
    const visible = steps.slice(-VISIBLE_STEPS);
    if (visible.length === 0) return [];
    let prefix = steps.slice(0, visible[0]!.step).map((p) => p.token).join("");
    return visible.map((s) => {
      const row = { step: s.step, token: s.token, prefix };
      prefix += s.token;
      return row;
    });
  }, [steps]);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length]);

  if (!gen?.started) return <p className="mono text-[11px] text-muted">Generation steps appear once the provider starts streaming.</p>;
  const running = !gen.completed && !visual?.error && !visual?.stopped;
  const last = steps[steps.length - 1];
  const granularity = last?.granularity ?? "chunk";

  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">
        {steps.length} {granularity === "token" ? "tokens" : "chunks"} streamed · {visual?.metrics.tokensPerSec ? `${visual.metrics.tokensPerSec.toFixed(1)}/s` : "…"}
      </p>

      {variant === "loop" ? (
        <div className="rounded-lg border border-line bg-bg-elevated/60 p-3">
          <p className="label-caps mb-2">Generation loop</p>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <ol className="grid gap-1 mono text-[11px]">
              {["CONTEXT", "MODEL", "NEXT TOKEN", "APPEND TOKEN", "NEW CONTEXT"].map((label, i) => (
                <li key={label} className="flex items-center gap-2">
                  <span className={cn("rounded border px-2 py-0.5 w-32 text-center", running ? "border-live/40 text-ink-dim" : "border-line text-muted", running && !reducedMotion && "animate-pulse")} style={{ animationDelay: `${i * 160}ms` }}>
                    {label}
                  </span>
                  {i < 4 ? <span className="text-faint">↓</span> : <span className="text-faint">↺ back to MODEL</span>}
                </li>
              ))}
            </ol>
            <dl className="mono text-[11px] grid gap-1 text-right">
              <div><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">step</dt><dd className="text-ink text-[16px]">{steps.length}</dd></div>
              <div><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">context</dt><dd className="text-ink-dim">{(visual?.tokenization?.tokens.length ?? 0) + steps.length} pieces</dd></div>
              <div><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">ttfb</dt><dd className="text-ink-dim">{formatMs(gen.ttfbMs)}</dd></div>
              <div><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">status</dt><dd className={running ? "text-live" : "text-ok"}>{running ? "generating" : gen.finishReason ?? "done"}</dd></div>
            </dl>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3">
        <p className="label-caps mb-2">Context grows one step at a time</p>
        {steps.length > VISIBLE_STEPS ? (
          <p className="mono text-[10.5px] text-faint mb-1">+{steps.length - VISIBLE_STEPS} earlier steps · showing the most recent {VISIBLE_STEPS}</p>
        ) : null}
        <ol ref={listRef} className="grid gap-1 pr-1" aria-label="Generation steps">
          {rows.map((s) => {
            const prefix = s.prefix;
            return (
              <motion.li
                key={s.step}
                initial={reducedMotion ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="grid grid-cols-[44px_1fr] gap-2 items-baseline mono text-[11.5px]"
              >
                <span className="text-faint">#{s.step + 1}</span>
                <span className="truncate text-muted">
                  {prefix.length > 60 ? `…${prefix.slice(-58)}` : prefix}
                  <span className="rounded border border-live/50 bg-live/15 px-1 text-live">{visibleToken(s.token)}</span>
                </span>
              </motion.li>
            );
          })}
        </ol>
      </div>

      <p className="text-[11.5px] leading-snug text-muted">
        {granularity === "token"
          ? "Each row is one real token returned by the provider's streaming API."
          : "This provider streams text chunks; a chunk may contain several tokens. The final usage report gives the exact output token count."}
      </p>
      {mode === "advanced" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          Decoding is O(n) forward passes with KV-cache reuse: keys and values for earlier positions are cached so each new step only computes attention for the newest token against the cache.
        </p>
      ) : null}
    </div>
  );
}
