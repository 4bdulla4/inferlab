import { motion } from "motion/react";
import type { CandidateSet } from "@/engine/simulation";
import { cn } from "@/lib/cn";
import { formatPct, visibleToken } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";

export function LogitVisualizer({ candidates, variant, reducedMotion }: { candidates: CandidateSet | undefined; variant: "logits" | "probabilities" | "selection"; reducedMotion: boolean }) {
  const mode = useUIStore((s) => s.mode);
  if (!candidates) return <p className="mono text-[11px] text-muted">Candidates appear once the model starts generating.</p>;
  const max = Math.max(...candidates.candidates.map((c) => c.probability), 0.0001);
  const selected = candidates.candidates.find((c) => c.selected);

  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">
        step {candidates.step + 1} · {candidates.candidates.length} candidates{variant === "logits" && mode === "advanced" && candidates.source === "live" ? " · logprob shown" : ""}
      </p>

      <ol className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-2" aria-label="Candidate tokens">
        {candidates.candidates.map((c, i) => (
          <li key={`${c.token}-${i}`} className="grid grid-cols-[92px_1fr_64px] items-center gap-2">
            <span className={cn("mono text-[12px] truncate rounded border px-1.5 py-0.5", c.selected ? "border-live/60 bg-live/15 text-live" : "border-line text-ink-dim")} title={c.token}>
              {visibleToken(c.token)}
            </span>
            <div className="h-4 rounded surface-1 overflow-hidden">
              <motion.div
                className={cn("h-full rounded", c.selected ? "bg-live/80" : candidates.source === "live" ? "bg-live/35" : "bg-sim/60")}
                initial={reducedMotion ? false : { width: 0 }}
                animate={{ width: `${(c.probability / max) * 100}%` }}
                transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : i * 0.05, ease: "easeOut" }}
              />
            </div>
            <span className="mono text-[11px] text-right text-ink-dim">
              {variant === "logits" && mode === "advanced" && c.logprob !== null ? c.logprob.toFixed(2) : formatPct(c.probability)}
            </span>
          </li>
        ))}
      </ol>

      {variant === "selection" && selected ? (
        <div className="rounded-lg border border-live/40 bg-live/[0.06] p-3 grid gap-1 text-center">
          <p className="label-caps text-live">Selected</p>
          <p className="mono text-[20px] text-ink">{visibleToken(selected.token)}</p>
          <p className="mono text-[10.5px] text-muted">{formatPct(selected.probability)} · appended to the context</p>
        </div>
      ) : null}

      <p className="text-[11.5px] leading-snug text-muted">{candidates.note}</p>
      {mode === "advanced" && variant === "probabilities" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          p(tokenᵢ) = exp(zᵢ / T) / Σⱼ exp(zⱼ / T). With T → 0 the distribution collapses onto the argmax (greedy); T &gt; 1 flattens it. Nucleus (top-p) sampling keeps the smallest set of tokens whose cumulative mass exceeds p.
        </p>
      ) : null}
    </div>
  );
}
