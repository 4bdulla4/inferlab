import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DataSource } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import type { ConnectionLayout } from "@/labs/llm/layout";
import { getPipelineSpec } from "@/labs/llm/pipelines/specs";
import type { LLMStageId } from "@/labs/llm/stages";
import type { RunState, VisualState } from "@/labs/llm/state";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { selectProvider, useUIStore } from "@/store/uiStore";
import { ConnectionMarkers, PipelineConnection, type ConnectionState } from "./PipelineConnection";
import { PipelineHUD } from "./PipelineHUD";
import { PipelineNode, nodeSublabel } from "./PipelineNode";
import { ParticleLayer } from "./ParticleLayer";

export function connectionState(conn: ConnectionLayout, nodes: Record<LLMStageId, NodeState> | undefined): ConnectionState {
  if (!nodes) return "idle";
  const from = nodes[conn.from];
  const to = nodes[conn.to];
  if (from === "error" || to === "error") return "error";
  if (to === "active" || to === "processing") return "active";
  if (conn.kind === "loop" && from === "processing") return "active";
  if (from === "completed" && to === "completed") return "done";
  if ((from === "completed" || from === "processing" || from === "active") && (to === "idle" || to === "queued")) return "pending";
  return "idle";
}

export function Pipeline({ run }: { run: RunState | undefined }) {
  const visual: VisualState | undefined = run?.visual;
  const selected = useUIStore(selectProvider);
  // While a run exists the diagram follows that run's provider; otherwise the selected one.
  const spec = getPipelineSpec(run?.provider.id ?? selected?.id);
  const { nodes: NODE_LAYOUTS, connections: CONNECTIONS, width: PIPELINE_W, height: PIPELINE_H } = spec.layout;
  const NODE_ORDER = spec.order;
  const selectedStage = useUIStore((s) => s.selectedStage);
  const selectStage = useUIStore((s) => s.selectStage);
  const expanded = useUIStore((s) => s.transformerExpanded);
  const setExpanded = useUIStore((s) => s.setTransformerExpanded);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / PIPELINE_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [PIPELINE_W]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const current = target.dataset.pipelineNode as LLMStageId | undefined;
    if (!current) return;
    const idx = NODE_ORDER.indexOf(current);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = Math.min(NODE_ORDER.length - 1, idx + 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = Math.max(0, idx - 1);
    if (e.key === "Home") nextIdx = 0;
    if (e.key === "End") nextIdx = NODE_ORDER.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      e.stopPropagation();
      const next = containerRef.current?.querySelector<HTMLElement>(`[data-pipeline-node="${NODE_ORDER[nextIdx]}"]`);
      next?.focus();
    }
  }, [NODE_ORDER]);

  // Stable identity so a memoized node is not re-rendered by a new closure.
  const onToggleTransformer = useCallback(() => {
    setExpanded(!expanded);
    selectStage("transformer");
  }, [expanded, setExpanded, selectStage]);

  const fontScale = Math.min(1.15, Math.max(0.78, scale));

  return (
    <div className="overflow-x-auto overflow-y-hidden -mx-1 px-1">
      <div
        ref={containerRef}
        role="group"
        aria-label="LLM execution pipeline"
        onKeyDown={onKeyDown}
        className="pipeline-scale relative w-full min-w-[960px] select-none"
        style={{ aspectRatio: `${PIPELINE_W} / ${PIPELINE_H}`, ["--scale" as string]: scale, ["--fs" as string]: fontScale }}
      >
        <svg viewBox={`0 0 ${PIPELINE_W} ${PIPELINE_H}`} className="absolute inset-0 size-full" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
          <ConnectionMarkers />
          {CONNECTIONS.map((c) => (
            <PipelineConnection
              key={c.id}
              conn={c}
              state={connectionState(c, visual?.nodes)}
              source={(visual?.nodeSources[c.to] ?? "simulation") as DataSource}
              reducedMotion={reducedMotion}
            />
          ))}
          {/* band labels */}
          <g className="mono" fill="rgba(255,255,255,0.28)" fontSize="10" letterSpacing="2">
            <text x="36" y="24">01 · INPUT PROCESSING</text>
            <text x="782" y="142">02 · MODEL · {spec.api.toUpperCase()}</text>
            <text x="36" y="234">03 · NEXT-TOKEN PREDICTION</text>
            <text x="36" y="418">04 · AUTOREGRESSIVE LOOP → OUTPUT</text>
          </g>
        </svg>

        {NODE_LAYOUTS.map((node) => (
          <PipelineNode
            key={node.id}
            layout={node}
            state={visual?.nodes[node.id] ?? "idle"}
            source={visual?.nodeSources[node.id] ?? "simulation"}
            pulse={visual?.pulses[node.id] ?? 0}
            selected={selectedStage === node.id}
            sublabel={nodeSublabel(node.id, visual, visual?.nodes[node.id] ?? "idle")}
            layers={node.id === "transformer" ? visual?.conceptualLayers : undefined}
            reasoningActive={node.id === "transformer" ? Boolean(visual?.generation.reasoning) : undefined}
            definition={spec.stages[node.id]}
            layoutW={PIPELINE_W}
            layoutH={PIPELINE_H}
            reducedMotion={reducedMotion}
            expanded={node.id === "transformer" ? expanded : undefined}
            onSelect={selectStage}
            onToggleExpand={node.id === "transformer" ? onToggleTransformer : undefined}
          />
        ))}

        {!reducedMotion ? (
          <ParticleLayer runId={run?.id ?? null} scale={scale} connections={CONNECTIONS} cycle={spec.cycle} width={PIPELINE_W} height={PIPELINE_H} />
        ) : null}
        <PipelineHUD run={run} width={PIPELINE_W} height={PIPELINE_H} />
      </div>
    </div>
  );
}
