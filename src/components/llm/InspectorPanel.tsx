import { Pause, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { DataSource } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import { cn } from "@/lib/cn";
import { LLM_STAGES, type LLMStageId } from "@/labs/llm/stages";
import type { RunState } from "@/labs/llm/state";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { WhatIsHappening } from "./WhatIsHappening";
import { AttentionVisualizer } from "./visualizers/AttentionVisualizer";
import { DetokenizationVisualizer } from "./visualizers/DetokenizationVisualizer";
import { EmbeddingVisualizer } from "./visualizers/EmbeddingVisualizer";
import { GenerationVisualizer } from "./visualizers/GenerationVisualizer";
import { InputVisualizer, ResponseVisualizer } from "./visualizers/InputResponseVisualizers";
import { LogitVisualizer } from "./visualizers/LogitVisualizer";
import { MLPVisualizer } from "./visualizers/MLPVisualizer";
import { PositionalVisualizer } from "./visualizers/PositionalVisualizer";
import { RequestVisualizer } from "./visualizers/RequestVisualizer";
import { TokenVisualizer } from "./visualizers/TokenVisualizer";
import { TransformerVisualizer } from "./visualizers/TransformerVisualizer";

/** What the inspector and the visualization are both looking at right now. */
export function useInspectedStage(run: RunState | undefined) {
  const selected = useUIStore((s) => s.selectedStage);
  const selectStage = useUIStore((s) => s.selectStage);
  const visual = run?.visual;

  // Default to the currently executing stage when nothing is pinned.
  const stage: LLMStageId | null = selected ?? visual?.currentStage ?? null;
  const def = stage ? LLM_STAGES[stage] : null;
  const state: NodeState = stage ? (visual?.nodes[stage] ?? "idle") : "idle";
  const source: DataSource = stage ? (visual?.nodeSources[stage] ?? LLM_STAGES[stage].defaultSource) : "simulation";

  /** Freezes on the stage being shown, or resumes following the run. */
  const toggleFollow = useCallback(() => {
    if (selected) selectStage(null);
    else if (stage) selectStage(stage);
  }, [selected, stage, selectStage]);

  return { stage, def, state, source, isActive: state === "active" || state === "processing", pinned: Boolean(selected), selectStage, toggleFollow, visual };
}

/** The two panels share a header: which stage, its state, and where its data came from. */
function StageHeader({ def, state, source, reducedMotion }: { def: { label: string }; state: NodeState; source: DataSource; reducedMotion: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[16px] inline-flex"><StatusIcon state={state} spin={!reducedMotion} /></span>
      <h3 className="mono text-[13px] font-semibold tracking-[0.14em] uppercase text-ink">{def.label}</h3>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted">{NODE_STATE_LABEL[state]}</span>
        <SourceBadge source={source} compact />
      </span>
    </div>
  );
}

/**
 * Follow the run, or hold one stage still to read it. This is deliberate and
 * explicit: nothing freezes on its own, so a run always plays through.
 */
function FollowToggle({ pinned, onToggle, disabled }: { pinned: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pinned}
      title={pinned ? "Resume following the run" : "Hold this stage still so it stops changing"}
      className={cn(
        "mono inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] uppercase tracking-[0.1em] disabled:opacity-40 disabled:cursor-not-allowed",
        pinned
          ? "border-accent/50 bg-accent/10 text-accent-soft hover:border-accent"
          : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
      )}
    >
      {pinned ? <PlayCircle className="size-3" aria-hidden="true" /> : <Pause className="size-3" aria-hidden="true" />}
      {pinned ? "follow" : "hold"}
    </button>
  );
}

export function InspectorPanel({ run, className }: { run: RunState | undefined; className?: string }) {
  const mode = useUIStore((s) => s.mode);
  const reducedMotion = useReducedMotion();
  const { stage, def, state, source, pinned, toggleFollow, visual } = useInspectedStage(run);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Only a deliberate pin starts a stage from the top. Following execution never
  // moves the scroll position, so reading is never interrupted.
  useEffect(() => {
    if (pinned) bodyRef.current?.scrollTo({ top: 0 });
  }, [pinned, stage]);

  return (
    <GlassPanel
      bodyRef={bodyRef}
      title="Inspector"
      subtitle={pinned ? "held still" : stage ? "following execution" : undefined}
      actions={<FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!stage} />}
      className={className}
      bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll content-start"
    >
      {!def || !stage ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Click any pipeline node, token, or timeline entry to inspect it. While a run is playing the inspector follows the active stage.</p>
      ) : (
        <>
          <StageHeader def={def} state={state} source={source} reducedMotion={reducedMotion} />

          <WhatIsHappening def={def} />

          <div className="rounded-lg border border-line p-3 grid gap-1">
            <p className="label-caps">Data source</p>
            <p className="flex items-center gap-2 text-[12px] text-ink-dim">
              <SourceBadge source={source} />
              <span>{source === "live" ? "Provider API" : "Educational simulation"}</span>
            </p>
            <p className="text-[11.5px] leading-snug text-muted">{def.sourceNote}</p>
          </div>

          {mode === "advanced" && visual?.lastEvent && visual.lastEvent.stage === stage ? (
            <details className="rounded-lg border border-line p-3 text-[11px]">
              <summary className="cursor-pointer label-caps">Last event · {visual.lastEvent.type}</summary>
              <pre className="mono mt-2 max-h-48 overflow-auto text-[10.5px] leading-snug text-muted whitespace-pre-wrap break-all">{JSON.stringify(compactEvent(visual.lastEvent), null, 2)}</pre>
            </details>
          ) : null}
        </>
      )}
    </GlassPanel>
  );
}

/**
 * The stage visual in a frame of its own, so a diagram is never a paragraph
 * deep inside a scrolling column of prose.
 */
export function VisualizationPanel({ run, className }: { run: RunState | undefined; className?: string }) {
  const reducedMotion = useReducedMotion();
  const { stage, def, state, source, isActive, pinned, toggleFollow } = useInspectedStage(run);

  // The panel is short, so the stage name, its state and its source ride in the
  // panel header instead of taking a second row of their own. That row and its
  // gap were the only things between the frame and the drawing it exists for.
  return (
    <GlassPanel
      title="Visualization"
      subtitle={
        def && stage ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] inline-flex shrink-0"><StatusIcon state={state} spin={!reducedMotion} /></span>
            <span className="mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink truncate">{def.label}</span>
            <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted truncate">{pinned ? "held" : NODE_STATE_LABEL[state]}</span>
          </span>
        ) : undefined
      }
      actions={
        <>
          {def && stage ? <SourceBadge source={source} compact /> : null}
          <FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!stage} />
        </>
      }
      className={className}
      bodyClassName="px-3.5 py-3 grid gap-2.5 content-start overflow-y-auto panel-scroll"
    >
      {!def || !stage ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Each stage draws what it is doing here: tokens, vectors, attention weights, candidate probabilities and the answer taking shape.
        </p>
      ) : (
        <StageVisualizer stage={stage} run={run} active={isActive} reducedMotion={reducedMotion} />
      )}
    </GlassPanel>
  );
}

/** The provider's own count of the request, when it publishes one. */
function TokenCountCard({ visual }: { visual: RunState["visual"] | undefined }) {
  const count = visual?.inputTokenCount;
  if (!count) {
    return <p className="mono text-[11px] text-muted">The input token count appears once this stage has run.</p>;
  }
  return (
    <div className="rounded-lg border border-live/30 bg-live/[0.05] p-3 text-[12px] grid gap-1">
      <p className="label-caps text-live">● live input token count</p>
      <p className="text-ink">
        <span className="mono text-[18px]">{count.count}</span> tokens
      </p>
      <p className="text-[11.5px] text-muted leading-snug">{count.note}</p>
    </div>
  );
}

/** Whatever the provider chose to reveal of its reasoning, which is usually a summary. */
function ReasoningVisualizer({ visual }: { visual: RunState["visual"] | undefined }) {
  const text = visual?.generation.reasoning?.trim();
  const tokens = visual?.usage?.reasoningTokens;
  return (
    <div className="grid gap-2">
      {tokens ? (
        <p className="mono text-[11px] text-ink-dim">
          <span className="text-[16px]">{tokens}</span> reasoning tokens, billed as output
        </p>
      ) : null}
      {text ? (
        <p className="rounded-lg border border-line bg-bg-elevated/60 p-3 text-[12.5px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words">{text}</p>
      ) : (
        <p className="mono text-[11px] text-muted">
          No reasoning text came back. Providers either hide these tokens entirely or return a short summary of them.
        </p>
      )}
    </div>
  );
}

function compactEvent(event: RunState["visual"]["lastEvent"]): unknown {
  if (!event) return null;
  const { data, ...rest } = event;
  const compact = JSON.stringify(data ?? null);
  return { ...rest, data: compact.length > 1200 ? `${compact.slice(0, 1200)}… (${compact.length} chars)` : (data ?? null) };
}

function StageVisualizer({ stage, run, active, reducedMotion }: { stage: LLMStageId; run: RunState | undefined; active: boolean; reducedMotion: boolean }) {
  const v = run?.visual;
  switch (stage) {
    case "input":
      return <InputVisualizer run={run} />;
    case "request":
      return <RequestVisualizer visual={v} />;
    case "tokenization":
      return <TokenVisualizer tokenization={v?.tokenization} showIds={false} inputText={run?.input ?? ""} />;
    case "tokenIds":
      return (
        <div className="grid gap-3">
          <TokenCountCard visual={v} />
          <TokenVisualizer tokenization={v?.tokenization} showIds inputText={run?.input ?? ""} />
        </div>
      );
    case "tokenCount":
      return <TokenCountCard visual={v} />;
    case "thinking":
    case "reasoning":
      return <ReasoningVisualizer visual={v} />;
    case "embeddings":
      return <EmbeddingVisualizer embeddings={v?.embeddings} />;
    case "positional":
      return <PositionalVisualizer positional={v?.positional} />;
    case "transformer":
      return <TransformerVisualizer visual={v} />;
    case "attention":
      return <AttentionVisualizer attention={v?.attention} active={active} />;
    case "mlp":
      return <MLPVisualizer mlp={v?.mlp} active={active} />;
    case "logits":
      return <LogitVisualizer candidates={v?.logits} variant="logits" reducedMotion={reducedMotion} />;
    case "probabilities":
      return <LogitVisualizer candidates={v?.logits} variant="probabilities" reducedMotion={reducedMotion} />;
    case "tokenSelection":
      return <LogitVisualizer candidates={v?.logits} variant="selection" reducedMotion={reducedMotion} />;
    case "nextToken":
      return <GenerationVisualizer visual={v} variant="nextToken" reducedMotion={reducedMotion} />;
    case "loop":
      return <GenerationVisualizer visual={v} variant="loop" reducedMotion={reducedMotion} />;
    case "detokenization":
      return <DetokenizationVisualizer visual={v} />;
    case "response":
      return <ResponseVisualizer run={run} />;
  }
}
