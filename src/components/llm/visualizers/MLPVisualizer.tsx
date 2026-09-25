import type { MLPSimulation } from "@/labs/llm/events";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/store/uiStore";

export function MLPVisualizer({ mlp, active }: { mlp: MLPSimulation | undefined; active: boolean }) {
  const mode = useUIStore((s) => s.mode);
  const stages = [
    { label: "Attention output", width: 8, tone: "sim" },
    { label: "Linear (up-projection)", width: 20, tone: "sim" },
    { label: `Activation · ${mlp?.activation ?? "GELU"}`, width: 20, tone: "live" },
    { label: "Linear (down-projection)", width: 8, tone: "sim" },
    { label: "Output → residual add", width: 8, tone: "ok" },
  ] as const;

  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">position-wise · hidden width {mlp?.hiddenMultiplier ?? 4}× model width</p>
      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-2">
        {stages.map((s, i) => (
          <div key={s.label} className="grid gap-1 animate-fade-up" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="flex items-center justify-between">
              <span className="mono text-[11.5px] text-ink-dim">{s.label}</span>
              <span className="mono text-[10px] text-faint">{s.width === 20 ? "d_ff" : "d_model"}</span>
            </div>
            <div className="flex justify-center gap-[3px]" aria-hidden="true">
              {Array.from({ length: s.width }).map((_, k) => (
                <span
                  key={k}
                  className={cn(
                    "h-3 w-2 rounded-[2px]",
                    s.tone === "live" ? "bg-live/70" : s.tone === "ok" ? "bg-ok/70" : "bg-sim/60",
                    active && "animate-pulse",
                  )}
                  style={{ animationDelay: `${k * 40}ms`, opacity: 0.45 + ((k * 7 + i * 3) % 10) / 18 }}
                />
              ))}
            </div>
            {i < stages.length - 1 ? <div className="text-center mono text-faint text-[10px] leading-none">↓</div> : null}
          </div>
        ))}
      </div>
      <p className="text-[11.5px] leading-snug text-muted">
        {mlp?.note ?? "The feed-forward network transforms the representation independently at each position within a transformer block."}
      </p>
      {mode === "advanced" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          MLP(x) = W₂ · φ(W₁x + b₁) + b₂. Most of a transformer's parameters live here; these layers are widely understood to store factual associations. Internal activations of the proprietary model are not exposed.
        </p>
      ) : null}
    </div>
  );
}
