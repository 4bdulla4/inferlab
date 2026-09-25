import { NODE_ORDER } from "@/labs/llm/layout";
import { LLM_STAGES } from "@/labs/llm/stages";
import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useUIStore } from "@/store/uiStore";
import { StatusIcon } from "@/components/layout/StatusIcon";

/** Compact horizontal strip of stage states, used in comparison mode. */
export function MiniPipeline({ run, onFocus }: { run: RunState | undefined; onFocus?: () => void }) {
  const selectStage = useUIStore((s) => s.selectStage);
  const reducedMotion = useReducedMotion();
  return (
    <ol className="flex flex-wrap gap-1" aria-label={`${run?.provider.name ?? ""} pipeline stages`}>
      {NODE_ORDER.map((id) => {
        const state = run?.visual.nodes[id] ?? "idle";
        const source = run?.visual.nodeSources[id] ?? "simulation";
        const live = state === "active" || state === "processing";
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => {
                onFocus?.();
                selectStage(id);
              }}
              title={`${LLM_STAGES[id].label} · ${state}`}
              className={cn(
                "mono inline-flex items-center gap-1 rounded border px-1.5 h-6 text-[10px] uppercase tracking-[0.08em] transition-colors",
                state === "completed" ? "border-ok/40 text-ink-dim" : live ? (source === "live" ? "border-live/60 text-ink shadow-glow-live" : "border-sim/60 text-ink shadow-glow-sim") : state === "error" ? "border-err/60 text-err" : "border-line text-muted",
              )}
            >
              <span className="text-[11px] inline-flex"><StatusIcon state={state} spin={!reducedMotion} /></span>
              {LLM_STAGES[id].shortLabel}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
