import { memo } from "react";
import { Layers } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { DataSource } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import type { NodeLayout } from "@/labs/llm/layout";
import { LLM_STAGES, type LLMStageId, type StageDefinition } from "@/labs/llm/stages";
import type { VisualState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { formatMs, visibleToken } from "@/lib/format";
import { SourceDot } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";

export interface PipelineNodeProps {
  layout: NodeLayout;
  state: NodeState;
  source: DataSource;
  pulse: number;
  selected: boolean;
  /** Precomputed in the parent so a node re-renders only when its own text changes. */
  sublabel?: string;
  /** Transformer node only. */
  layers?: number;
  reasoningActive?: boolean;
  /** Provider-specific wording for this stage; falls back to the shared definition. */
  definition?: StageDefinition;
  layoutW: number;
  layoutH: number;
  reducedMotion: boolean;
  expanded?: boolean;
  onSelect: (id: LLMStageId) => void;
  onToggleExpand?: (id: LLMStageId) => void;
}

const STATE_STYLE: Record<NodeState, string> = {
  idle: "border-line surface-1 text-muted",
  queued: "border-line-strong surface-1 text-ink-dim",
  active: "surface-2 text-ink",
  processing: "surface-2 text-ink",
  completed: "border-ok/40 bg-ok/[0.05] text-ink",
  error: "border-err/60 bg-err/[0.08] text-ink shadow-glow-err",
};

export const PipelineNode = memo(function PipelineNode(props: PipelineNodeProps) {
  const { layout, state, source, pulse, selected, sublabel, layers, reasoningActive, definition, layoutW, layoutH, reducedMotion, expanded, onSelect, onToggleExpand } = props;
  const def = definition ?? LLM_STAGES[layout.id];
  const live = state === "active" || state === "processing";
  const glow = live ? (source === "live" ? "border-live/70 shadow-glow-live" : "border-sim/70 shadow-glow-sim") : "";
  const positionStyle = {
    left: `${(layout.x / layoutW) * 100}%`,
    top: `${(layout.y / layoutH) * 100}%`,
    width: `${(layout.w / layoutW) * 100}%`,
    height: `${(layout.h / layoutH) * 100}%`,
  } as const;

  const ariaLabel = `${def.label}, ${NODE_STATE_LABEL[state]}, ${source === "live" ? "live data" : "simulation"}${sublabel ? `, ${sublabel}` : ""}`;

  if (layout.variant === "block") {
    return (
      <div className="absolute" style={positionStyle}>
        <motion.div
          className={cn(
            "relative size-full rounded-xl border transition-colors duration-300",
            STATE_STYLE[state],
            glow,
            selected && "ring-2 ring-accent-soft/70 ring-offset-2 ring-offset-bg",
          )}
          animate={{ scale: live && !reducedMotion ? 1.01 : 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          {expanded ? (
            <div aria-hidden="true" className="absolute inset-x-3 -top-2 h-2 rounded-t-xl border-x border-t border-sim/30 bg-sim/5" />
          ) : null}
          <button
            type="button"
            data-pipeline-node={layout.id}
            aria-label={ariaLabel}
            aria-pressed={selected}
            onClick={() => onSelect(layout.id)}
            className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 text-left rounded-t-xl hover:surface-1"
            style={{ height: `${(34 / layout.h) * 100}%`, fontSize: "calc(12px * var(--fs))" }}
          >
            <span className="text-[1.15em] inline-flex"><StatusIcon state={state} spin={!reducedMotion} /></span>
            <span className="mono font-semibold tracking-[0.14em] uppercase text-[0.95em]">{def.label}</span>
            <span className="mono text-[0.8em] tracking-[0.1em] uppercase text-sim border border-sim/40 rounded px-1 leading-[1.6]">conceptual</span>
            {sublabel ? <span className="mono text-[0.85em] text-muted truncate">{sublabel}</span> : null}
            <span className="ml-auto inline-flex items-center gap-2">
              <SourceDot source={source} />
            </span>
          </button>
          {onToggleExpand ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(layout.id);
              }}
              aria-pressed={expanded}
              aria-label={expanded ? "Collapse transformer layers" : "Expand transformer layers"}
              className="absolute right-2 bottom-1.5 mono inline-flex items-center gap-1 rounded border border-line px-1.5 text-muted hover:text-ink hover:border-line-strong"
              style={{ fontSize: "calc(10px * var(--fs))", height: "calc(18px * var(--fs))" }}
            >
              <Layers className="size-[1.1em]" />
              {expanded ? "Layers ▲" : `Layers ×${layers ?? 12}`}
            </button>
          ) : null}
          <span className="absolute left-3 bottom-1.5 right-[13em] truncate mono text-muted" style={{ fontSize: "calc(10px * var(--fs))" }}>
            {reasoningActive ? "reasoning streaming (live summary)" : "attention → residual/norm → MLP → residual/norm"}
          </span>
          <PulseFlash pulse={pulse} source={source} reducedMotion={reducedMotion} rounded="rounded-xl" />
        </motion.div>
      </div>
    );
  }

  const inner = layout.variant === "inner";
  const wide = layout.variant === "wide";

  return (
    <motion.button
      type="button"
      data-pipeline-node={layout.id}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={() => onSelect(layout.id)}
      className={cn(
        "absolute rounded-lg border text-left transition-colors duration-300 overflow-hidden focus-visible:z-10",
        STATE_STYLE[state],
        glow,
        selected && "ring-2 ring-accent-soft/70 ring-offset-2 ring-offset-bg",
        inner && "rounded-md",
      )}
      style={{ ...positionStyle, fontSize: "calc(12px * var(--fs))" }}
      animate={{ scale: live && !reducedMotion ? 1.035 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      {inner ? (
        <span className="flex size-full items-center gap-2 px-3">
          <span className="text-[1.2em] inline-flex"><StatusIcon state={state} spin={!reducedMotion} /></span>
          <span className="mono font-semibold tracking-[0.12em] uppercase text-[0.9em]">{def.label}</span>
          <span className="mono text-[0.85em] text-muted truncate">{sublabel ?? def.caption}</span>
          <span className="ml-auto"><SourceDot source={source} /></span>
        </span>
      ) : (
        <span className="grid size-full grid-cols-[auto_1fr_auto] grid-rows-[auto_auto] content-center items-start gap-x-2 gap-y-[0.25em] px-3">
          <span className="text-[1.2em] inline-flex mt-[0.05em]"><StatusIcon state={state} spin={!reducedMotion} /></span>
          <span className={cn("mono font-semibold uppercase leading-[1.15]", wide ? "text-[0.9em] tracking-[0.12em] truncate" : "text-[0.82em] tracking-[0.07em] line-clamp-2 break-words")}>{def.label}</span>
          <span className="mt-[0.1em]"><SourceDot source={source} /></span>
          <span className={cn("mono col-span-3 text-[0.82em] truncate", wide ? "text-ink-dim" : "text-muted")}>
            {sublabel ?? def.caption}
          </span>
        </span>
      )}
      <PulseFlash pulse={pulse} source={source} reducedMotion={reducedMotion} rounded={inner ? "rounded-md" : "rounded-lg"} />
    </motion.button>
  );
});

function PulseFlash({ pulse, source, reducedMotion, rounded }: { pulse: number; source: DataSource; reducedMotion: boolean; rounded: string }) {
  if (reducedMotion || pulse === 0) return null;
  return (
    <AnimatePresence>
      <motion.span
        key={pulse}
        aria-hidden="true"
        className={cn("pointer-events-none absolute inset-0", rounded, source === "live" ? "bg-live" : "bg-sim")}
        initial={{ opacity: 0.32 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
      />
    </AnimatePresence>
  );
}

/** Dynamic one-liner under each node, derived purely from visual state. */
export function nodeSublabel(stage: NodeLayout["id"], v: VisualState | undefined, state: NodeState): string | undefined {
  if (!v) return undefined;
  switch (stage) {
    case "input":
      return state === "idle" ? undefined : `${v.metrics.inputChars} chars`;
    case "request":
      return v.request?.vendor;
    case "tokenization":
      return v.tokenization ? `${v.tokenization.tokens.length} tokens${v.tokenization.exact ? "" : " (approx.)"}` : undefined;
    case "tokenIds":
      if (v.inputTokenCount) return `${v.inputTokenCount.count} input tokens (${v.inputTokenCount.source})`;
      return v.tokenization ? `${v.tokenization.ids.length} ids · ${v.tokenization.encoding}` : undefined;
    case "embeddings":
      return v.embeddings ? `${v.embeddings.vectors.length} × ${v.embeddings.dims}-d vectors` : undefined;
    case "positional":
      return v.positional ? `positions 0 … ${v.positional.positions.length - 1}` : undefined;
    case "transformer":
      if (v.generation.reasoning) return `reasoning ${v.generation.reasoning.length} chars`;
      return v.generation.ttfbMs !== undefined ? `first byte ${formatMs(v.generation.ttfbMs)}` : undefined;
    case "attention":
      return v.attention ? `${v.attention.tokens.length}×${v.attention.tokens.length} causal · ${v.attention.heads} heads` : undefined;
    case "mlp":
      return v.mlp ? `${v.mlp.hiddenMultiplier}× hidden · ${v.mlp.activation}` : undefined;
    case "logits": {
      const top = v.logits?.candidates[0];
      return top ? `top: ${JSON.stringify(visibleToken(top.token))}` : undefined;
    }
    case "probabilities": {
      const top = v.logits?.candidates[0];
      return top ? `${(top.probability * 100).toFixed(0)}% ${v.logits?.source === "live" ? "(live)" : "(sim)"}` : undefined;
    }
    case "tokenSelection":
      return v.selection ? `→ ${JSON.stringify(visibleToken(v.selection.token))}` : undefined;
    case "nextToken": {
      const last = v.generation.steps[v.generation.steps.length - 1];
      return last ? `${last.granularity} ${last.step + 1}: ${JSON.stringify(visibleToken(last.token))}` : undefined;
    }
    case "loop":
      if (!v.generation.started) return undefined;
      return `step ${v.generation.steps.length}${v.metrics.tokensPerSec ? ` · ${v.metrics.tokensPerSec.toFixed(1)}/s` : ""}`;
    case "detokenization":
      return v.detokenization ? `${v.detokenization.tokens.length} pieces → ${v.detokenization.text.length} chars` : undefined;
    case "response": {
      const text = v.generation.text;
      if (!text) return v.generation.started ? "waiting for first token…" : undefined;
      const preview = text.replace(/\s+/g, " ").trim();
      return preview.length > 96 ? `…${preview.slice(-92)}` : preview;
    }
  }
}
