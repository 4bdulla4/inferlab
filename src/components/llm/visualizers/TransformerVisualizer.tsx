import type { NodeState } from "@/types/execution";
import type { VisualState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";
import { StatusIcon } from "@/components/layout/StatusIcon";

export function TransformerVisualizer({ visual }: { visual: VisualState | undefined }) {
  const expanded = useUIStore((s) => s.transformerExpanded);
  const setExpanded = useUIStore((s) => s.setTransformerExpanded);
  const selectStage = useUIStore((s) => s.selectStage);
  const mode = useUIStore((s) => s.mode);
  const layers = visual?.conceptualLayers ?? 12;
  const state: NodeState = visual?.nodes.transformer ?? "idle";
  const processing = state === "processing" || state === "active";
  const currentLayer = processing ? Math.floor((Date.now() / 220) % layers) : -1;

  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">block structure · {expanded ? `${layers} conceptual layers` : "single block view"}</p>

      {visual?.generation.ttfbMs !== undefined || visual?.generation.reasoning ? (
        <div className="rounded-lg border border-live/30 bg-live/[0.05] p-3 grid gap-1 text-[12px]">
          <p className="flex items-center gap-2 label-caps text-live">● live provider telemetry</p>
          {visual.generation.ttfbMs !== undefined ? <p className="text-ink-dim">The real model answered after <span className="mono text-ink">{formatMs(visual.generation.ttfbMs)}</span> (time to first byte).</p> : null}
          {visual.generation.model ? <p className="mono text-[11px] text-muted">served by {visual.generation.model}</p> : null}
          {visual.generation.reasoning ? <p className="text-ink-dim">An extended-thinking phase streamed {visual.generation.reasoning.length} characters of summarized reasoning before the answer.</p> : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="label-caps">Transformer block</p>
          <button type="button" onClick={() => setExpanded(!expanded)} aria-pressed={expanded} className="mono text-[10.5px] text-ink-dim border border-line rounded px-1.5 h-6 hover:border-line-strong">
            {expanded ? "Collapse layers" : `Expand ${layers} layers`}
          </button>
        </div>
        {expanded ? (
          <ol className="grid gap-1" aria-label="Conceptual layers">
            {Array.from({ length: layers }).map((_, i) => (
              <li
                key={i}
                className={cn(
                  "mono flex items-center gap-2 rounded border px-2 h-7 text-[11px]",
                  i === currentLayer ? "border-sim/70 bg-sim/15 text-ink shadow-glow-sim" : "border-line text-muted",
                )}
              >
                <span className="w-16">Layer {i + 1}</span>
                <span className="text-faint">attention → norm → MLP → norm</span>
                {i === currentLayer ? <span className="ml-auto text-sim">◇ processing</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="grid gap-1.5 text-[12px]">
            <BlockRow label="Attention" state={visual?.nodes.attention ?? "idle"} onClick={() => selectStage("attention")} />
            <div className="mono text-faint text-center text-[10px]">↓ residual add + normalization</div>
            <BlockRow label="MLP / Feed forward" state={visual?.nodes.mlp ?? "idle"} onClick={() => selectStage("mlp")} />
            <div className="mono text-faint text-center text-[10px]">↓ residual add + normalization</div>
            <div className="mono text-faint text-center text-[10px]">× N blocks</div>
          </div>
        )}
      </div>

      <p className="text-[11.5px] leading-snug text-muted">
        Conceptual transformer visualization. The layer count shown is illustrative; the selected model's true depth, width and head count are not published through the API.
      </p>
      {mode === "advanced" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          Pre-norm residual blocks: x ← x + Attn(LN(x)); x ← x + MLP(LN(x)). Decoder-only models apply a causal mask so position t only sees ≤ t. The whole stack runs on the provider's infrastructure between "request sent" and "first byte".
        </p>
      ) : null}
    </div>
  );
}

function BlockRow({ label, state, onClick }: { label: string; state: NodeState; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex items-center gap-2 rounded-md border px-3 h-9 text-left hover:surface-1", state === "completed" ? "border-ok/40" : state === "processing" || state === "active" ? "border-sim/60" : "border-line")}>
      <span className="text-[14px] inline-flex"><StatusIcon state={state} /></span>
      <span className="mono text-[11.5px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
      <span className="ml-auto mono text-[10px] text-faint">inspect →</span>
    </button>
  );
}
