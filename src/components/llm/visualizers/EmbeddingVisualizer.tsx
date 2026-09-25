import type { EmbeddingSimulation } from "@/engine/simulation";
import { visibleToken } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";

export function EmbeddingVisualizer({ embeddings }: { embeddings: EmbeddingSimulation | undefined }) {
  const mode = useUIStore((s) => s.mode);
  if (!embeddings) return <p className="mono text-[11px] text-muted">Vectors appear once this stage has run.</p>;
  const shown = embeddings.vectors.slice(0, 12);
  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">{embeddings.vectors.length} tokens → {embeddings.dims}-dimensional vectors</p>
      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-1.5">
        {shown.map((v, i) => (
          <div key={i} className="grid grid-cols-[84px_1fr] items-center gap-3 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="mono text-[12px] text-ink truncate" title={v.token}>
              {visibleToken(v.token)}
            </span>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${embeddings.dims}, minmax(0, 1fr))` }} aria-label={`Vector for ${v.token}`}>
              {v.values.map((val, j) => (
                <span
                  key={j}
                  className="h-3 rounded-[1px]"
                  style={{
                    backgroundColor: val >= 0 ? `rgba(34,211,238,${0.12 + Math.abs(val) * 0.85})` : `rgba(142,45,255,${0.12 + Math.abs(val) * 0.85})`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        {embeddings.vectors.length > shown.length ? <p className="mono text-[10.5px] text-faint">+{embeddings.vectors.length - shown.length} more</p> : null}
        <p className="mono text-[10px] text-faint flex gap-3 mt-1">
          <span><span className="inline-block size-2 rounded-[1px] bg-live align-middle mr-1" />positive</span>
          <span><span className="inline-block size-2 rounded-[1px] bg-accent align-middle mr-1" />negative</span>
          <span>intensity = magnitude</span>
        </p>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{embeddings.note}</p>
      {mode === "advanced" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          Identical tokens map to identical vectors, as they would in a real embedding table. Tokens sharing a stem are drawn correlated to convey that similar tokens sit near each other in embedding space.
        </p>
      ) : null}
    </div>
  );
}
