import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import type { AttentionSimulation } from "@/engine/simulation";
import { cn } from "@/lib/cn";
import { visibleToken } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";

const MAX_TOKENS = 14;

export function AttentionVisualizer({ attention, active }: { attention: AttentionSimulation | undefined; active: boolean }) {
  const focus = useUIStore((s) => s.attentionFocus);
  const setFocus = useUIStore((s) => s.setAttentionFocus);
  const mode = useUIStore((s) => s.mode);
  const qkvOpen = useUIStore((s) => s.qkvOpen);
  const setQkvOpen = useUIStore((s) => s.setQkvOpen);

  const view = useMemo(() => {
    if (!attention) return null;
    const n = Math.min(attention.tokens.length, MAX_TOKENS);
    return { tokens: attention.tokens.slice(0, n), weights: attention.weights.slice(0, n).map((r) => r.slice(0, n)) };
  }, [attention]);

  if (!attention || !view) return <p className="mono text-[11px] text-muted">The attention pattern appears once this stage has run.</p>;

  const n = view.tokens.length;
  const focusIdx = focus !== null && focus < n ? focus : n - 1;
  const W = 420;
  const rowH = 26;
  const H = n * rowH + 8;
  const leftX = 110;
  const rightX = W - 110;

  return (
    <div className="@container grid gap-2">
      <p className="mono text-[10px] leading-none text-muted">
        {attention.tokens.length} tokens · causal · {attention.heads} conceptual heads
        {attention.tokens.length > n ? ` · showing first ${n}` : ""}
      </p>

      {/* The flow and the matrix are two readings of the same weights, so they
          sit on one line whenever the panel is wide enough to hold both. */}
      <div className="grid gap-2.5 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-start">
        <div className="min-w-0 rounded-lg border border-line bg-bg-elevated/60 px-2.5 py-2 grid gap-1.5">
          <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-faint truncate">Selected <span className="text-ink-dim normal-case tracking-normal">{visibleToken(view.tokens[focusIdx]!)}</span> · click a token to see where it looks</p>
          {/* A fixed pixel height with uniform scaling keeps the drawing at 1:1 in a
              wide panel instead of magnifying the text, and shrinks it in a narrow one. */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ height: H }}
            preserveAspectRatio="xMidYMid meet"
            className="w-full"
            role="img"
            aria-label={`Attention from ${view.tokens[focusIdx]} to earlier tokens`}
          >
            {view.weights[focusIdx]!.map((w, j) => {
              if (j > focusIdx) return null;
              const y1 = focusIdx * rowH + rowH / 2 + 4;
              const y2 = j * rowH + rowH / 2 + 4;
              const c1 = leftX + 60;
              const c2 = rightX - 60;
              return (
                <path
                  key={j}
                  d={`M ${leftX} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${rightX} ${y2}`}
                  fill="none"
                  stroke={j === focusIdx ? "rgba(34,211,238,0.9)" : "rgba(167,139,250,0.95)"}
                  strokeWidth={0.8 + w * 9}
                  opacity={0.25 + w * 0.75}
                  strokeLinecap="round"
                  className={cn(active && "animate-pulse")}
                  style={{ animationDuration: `${1.2 + j * 0.15}s` }}
                />
              );
            })}
            {view.tokens.map((t, i) => {
              const y = i * rowH + rowH / 2 + 4;
              const w = view.weights[focusIdx]![i] ?? 0;
              return (
                <g key={i}>
                  <foreignObject x={0} y={y - 11} width={leftX - 6} height={22}>
                    <button
                      type="button"
                      onClick={() => setFocus(i)}
                      aria-pressed={i === focusIdx}
                      className={cn("mono block w-full h-[22px] truncate rounded text-right pr-1 text-[11px] leading-[22px]", i === focusIdx ? "bg-live/20 text-live" : "text-ink-dim hover:surface-2")}
                    >
                      {visibleToken(t)}
                    </button>
                  </foreignObject>
                  <foreignObject x={rightX + 6} y={y - 11} width={W - rightX - 6} height={22}>
                    <div className={cn("mono h-[22px] truncate pl-1 text-[11px] leading-[22px]", i <= focusIdx ? "text-ink-dim" : "text-faint")}>
                      {visibleToken(t)}
                      {i <= focusIdx ? <span className="ml-1.5 text-sim">{(w * 100).toFixed(0)}%</span> : <span className="ml-1.5 text-faint">masked</span>}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
          <p className="mono text-[9.5px] leading-snug text-faint">left: querying position · right: positions it can attend to · thickness = conceptual weight · later positions are masked (causal)</p>
        </div>

        <div className="min-w-0 rounded-lg border border-line bg-bg-elevated/60 px-2.5 py-2 grid content-start gap-1.5">
          <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-faint">Attention matrix · rows attend to columns</p>
          <div
            className="grid gap-[2px] w-[min(100%,240px)] @xl:w-[190px]"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}
            role="img"
            aria-label="Attention weight matrix"
          >
            {view.weights.flatMap((row, i) =>
              row.map((w, j) => (
                <button
                  type="button"
                  key={`${i}-${j}`}
                  onClick={() => setFocus(i)}
                  aria-label={`${view.tokens[i]} → ${view.tokens[j]}: ${(w * 100).toFixed(0)}%`}
                  className={cn("aspect-square rounded-[2px]", i === focusIdx && "ring-1 ring-live/70")}
                  style={{ backgroundColor: j > i ? "rgba(255,255,255,0.03)" : `rgba(167,139,250,${0.08 + w * 0.92})` }}
                />
              )),
            )}
          </div>
        </div>
      </div>

      <p className="text-[11.5px] leading-snug text-muted">{attention.note}</p>

      {mode === "advanced" ? (
        <div className="rounded-lg border border-line">
          <button type="button" onClick={() => setQkvOpen(!qkvOpen)} aria-expanded={qkvOpen} className="w-full flex items-center justify-between px-3 h-9 text-left">
            <span className="label-caps">Query · Key · Value</span>
            <ChevronDown className={cn("size-4 text-muted transition-transform", qkvOpen && "rotate-180")} />
          </button>
          {qkvOpen ? <QKVDiagram /> : null}
        </div>
      ) : null}
    </div>
  );
}

function QKVDiagram() {
  const box = "rounded-md border px-2 py-1 mono text-[11px] text-center";
  return (
    <div className="border-t border-line p-3 grid gap-3">
      <div className="grid gap-1.5 justify-items-center text-[11px]">
        <span className={cn(box, "border-line text-ink-dim w-56")}>Input representation xᵢ</span>
        <span className="mono text-faint">│ three learned projections</span>
        <div className="grid grid-cols-3 gap-2 w-full max-w-md">
          <span className={cn(box, "border-live/40 text-live")}>Q = xW<sub>Q</sub></span>
          <span className={cn(box, "border-sim/40 text-sim")}>K = xW<sub>K</sub></span>
          <span className={cn(box, "border-ok/40 text-ok")}>V = xW<sub>V</sub></span>
        </div>
        <span className="mono text-faint">↓</span>
        <span className={cn(box, "border-line text-ink-dim w-64")}>scores = softmax(QKᵀ / √d<sub>k</sub> + mask)</span>
        <span className="mono text-faint">↓</span>
        <span className={cn(box, "border-line text-ink-dim w-56")}>weighted values = scores · V</span>
        <span className="mono text-faint">↓ concat heads · W<sub>O</sub></span>
        <span className={cn(box, "border-accent/40 text-accent-soft w-56")}>Updated representation</span>
      </div>
      <details className="text-[12px] text-muted leading-relaxed">
        <summary className="cursor-pointer mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">Learn more</summary>
        <p className="mt-2">
          Each position asks a question (Query), advertises what it contains (Key) and carries content to share (Value). The dot product between a Query and every Key gives compatibility scores; softmax turns them into weights that sum to 1; the weighted sum of Values becomes the new representation. Multiple heads run this in parallel with different projections so they can specialize (syntax, coreference, position…). Causal masking hides future positions so the model can be trained to predict the next token.
        </p>
      </details>
    </div>
  );
}
