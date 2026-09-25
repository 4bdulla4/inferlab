import { memo, useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DataSource } from "@shared/llm";
import type { Metrics } from "@shared/ml";
import type { NodeState } from "@/types/execution";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { ML_BAND_LABELS, ML_CANVAS_H, ML_CANVAS_W, ML_CONNECTIONS, ML_NODES, ML_NODE_ORDER, type MLConnectionLayout, type MLNodeLayout } from "@/labs/ml/layout";
import { ML_STAGES, type MLStageId } from "@/labs/ml/stages";
import type { MLRunState, MLVisualState } from "@/labs/ml/state";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { useMLStore } from "@/store/mlStore";
import { SourceDot } from "@/components/layout/SourceBadge";
import { StatusIcon } from "@/components/layout/StatusIcon";

type ConnectionState = "idle" | "pending" | "active" | "done" | "error" | "skipped";

function connectionState(conn: MLConnectionLayout, v: MLVisualState | undefined): ConnectionState {
  if (!v) return "idle";
  if (v.skipped.includes(conn.from) || v.skipped.includes(conn.to)) return "skipped";
  const from = v.nodes[conn.from];
  const to = v.nodes[conn.to];
  if (from === "error" || to === "error") return "error";
  if (conn.kind === "loop") return to === "active" || to === "processing" ? "active" : v.stepsSeen > 0 ? "done" : "idle";
  if (to === "active" || to === "processing") return "active";
  if (from === "completed" && to === "completed") return "done";
  if (from === "completed" && (to === "idle" || to === "queued")) return "pending";
  return "idle";
}

const STROKE: Record<ConnectionState, string> = {
  idle: "stroke-line",
  pending: "stroke-line-strong",
  active: "stroke-live",
  done: "stroke-ok/60",
  error: "stroke-err",
  skipped: "stroke-line",
};

/**
 * The ML diagram: four bands, one per act. Data becomes matrices; a loop
 * learns; held-out rows judge; a saved model answers new rows. Stages the
 * chosen algorithm never visits are dimmed with the reason, and the loop's
 * return edge pulses while training runs.
 */
export function MLPipeline({ run, dimmed }: { run: MLRunState | undefined; dimmed?: boolean }) {
  const visual = run?.visual;
  const selectedStage = useMLStore((s) => s.selectedStage);
  const selectStage = useMLStore((s) => s.selectStage);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / ML_CANVAS_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const current = (e.target as HTMLElement).dataset.mlNode as MLStageId | undefined;
    if (!current) return;
    const idx = ML_NODE_ORDER.indexOf(current);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(ML_NODE_ORDER.length - 1, idx + 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, idx - 1);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = ML_NODE_ORDER.length - 1;
    if (next !== null) {
      e.preventDefault();
      containerRef.current?.querySelector<HTMLElement>(`[data-ml-node="${ML_NODE_ORDER[next]}"]`)?.focus();
    }
  }, []);

  const fontScale = Math.min(1.15, Math.max(0.78, scale));
  // stepsSeen counts DRAWN passes; the step itself carries the true iteration number.
  const ranSoFar = visual?.completion?.iterations ?? visual?.step?.iteration ?? visual?.stepsSeen ?? 0;
  const loopLabel = visual && visual.stepsSeen > 0 ? `${ranSoFar.toLocaleString()} iteration${ranSoFar === 1 ? "" : "s"}${visual.stride > 1 ? ` · every ${visual.stride}th drawn` : ""}` : "the training loop";

  return (
    <div ref={containerRef} className={cn("relative w-full min-w-0 select-none", dimmed && "opacity-60")} style={{ height: ML_CANVAS_H * scale }} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 origin-top-left" style={{ width: ML_CANVAS_W, height: ML_CANVAS_H, transform: `scale(${scale})`, ["--fs" as string]: fontScale }}>
        {ML_BAND_LABELS.map((label, i) => (
          <span key={label} className="mono absolute left-9 text-[10.5px] uppercase tracking-[0.16em] text-faint" style={{ top: [12, 168, 324, 480][i], fontSize: `calc(10.5px * var(--fs))` }}>
            {label}
          </span>
        ))}

        <svg className="absolute inset-0 overflow-visible" width={ML_CANVAS_W} height={ML_CANVAS_H} aria-hidden="true">
          <defs>
            <marker id="ml-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-line-strong" />
            </marker>
          </defs>
          {ML_CONNECTIONS.map((conn) => {
            const state = connectionState(conn, visual);
            const d = conn.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
            const animated = state === "active" && !reducedMotion;
            return (
              <g key={conn.id} className={state === "skipped" ? "opacity-30" : undefined}>
                <path d={d} fill="none" className={cn("transition-colors", STROKE[state])} strokeWidth={state === "active" ? 2.2 : 1.4} strokeDasharray={conn.kind === "loop" ? "5 5" : animated ? "8 8" : undefined} markerEnd="url(#ml-arrow)" strokeLinejoin="round">
                  {animated ? <animate attributeName="stroke-dashoffset" from="32" to="0" dur="1.1s" repeatCount="indefinite" /> : null}
                </path>
                {conn.kind === "loop" ? (
                  <text x={(conn.points[1]![0] + conn.points[2]![0]) / 2} y={conn.points[1]![1] + 14} textAnchor="middle" className={cn("mono fill-muted", state === "active" && "fill-live")} style={{ fontSize: `calc(10px * var(--fs))`, letterSpacing: "0.08em" }}>
                    ↺ {loopLabel}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {ML_NODES.map((node) => (
          <MLNode
            key={node.id}
            layout={node}
            state={visual?.nodes[node.id] ?? "idle"}
            source={visual?.nodeSources[node.id] ?? ML_STAGES[node.id].defaultSource}
            pulse={visual?.pulses[node.id] ?? 0}
            selected={selectedStage === node.id}
            skipped={visual?.skipped.includes(node.id) ?? false}
            skipReason={visual?.skipReason ?? null}
            sublabel={visual?.skipped.includes(node.id) ? undefined : sublabelFor(node.id, visual)}
            reducedMotion={reducedMotion}
            onSelect={selectStage}
          />
        ))}
      </div>
    </div>
  );
}

interface MLNodeProps {
  layout: MLNodeLayout;
  state: NodeState;
  source: DataSource;
  pulse: number;
  selected: boolean;
  skipped: boolean;
  skipReason: string | null;
  sublabel?: string;
  reducedMotion: boolean;
  onSelect: (id: MLStageId) => void;
}

const STATE_STYLE: Record<NodeState, string> = {
  idle: "border-line surface-1 text-muted",
  queued: "border-line-strong surface-1 text-ink-dim",
  active: "surface-2 text-ink",
  processing: "surface-2 text-ink",
  completed: "border-ok/40 bg-ok/[0.05] text-ink",
  error: "border-err/60 bg-err/[0.08] text-ink shadow-glow-err",
};

/** One stage box. Memoized: a run applies thousands of events and only a few nodes change each time. */
const MLNode = memo(function MLNode({ layout, state, source, pulse, selected, skipped, skipReason, sublabel, reducedMotion, onSelect }: MLNodeProps) {
  const def = ML_STAGES[layout.id];
  const live = state === "active" || state === "processing";
  const glow = live ? (source === "live" ? "border-live/70 shadow-glow-live" : "border-sim/70 shadow-glow-sim") : "";
  return (
    <button
      type="button"
      data-ml-node={layout.id}
      onClick={() => onSelect(layout.id)}
      aria-pressed={selected}
      aria-label={`${def.label}: ${skipped ? "not used by this algorithm" : state}${sublabel ? `, ${sublabel}` : ""}`}
      title={skipped && skipReason ? skipReason : undefined}
      className={cn(
        "absolute rounded-lg border text-left transition-[border-color,background-color,box-shadow,opacity] duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft/70",
        STATE_STYLE[state],
        glow,
        skipped && "opacity-40 border-dashed",
        selected && "ring-2 ring-accent-soft/70 ring-offset-2 ring-offset-bg",
      )}
      style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, fontSize: `calc(11px * var(--fs))` }}
    >
      <span className="grid size-full grid-cols-[auto_1fr_auto] grid-rows-[auto_auto] content-center items-start gap-x-2 gap-y-[0.25em] px-3">
        <span className="text-[1.2em] inline-flex mt-[0.05em]">
          <StatusIcon state={state} spin={!reducedMotion} />
        </span>
        <span className="mono font-semibold uppercase leading-[1.15] text-[0.82em] tracking-[0.07em] line-clamp-2 break-words">{def.label}</span>
        <span className="mt-[0.1em]">
          <SourceDot source={source} />
        </span>
        <span className="mono col-span-3 text-[0.82em] truncate text-muted">{skipped ? "not used here" : (sublabel ?? def.caption)}</span>
      </span>
      {pulse > 0 && !reducedMotion ? <span key={pulse} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-lg animate-pulse-ring", source === "live" ? "shadow-glow-live" : "shadow-glow-sim")} /> : null}
    </button>
  );
});

const fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : "—");

/** Dynamic one-liner under each node, derived purely from visual state. */
export function sublabelFor(stage: MLStageId, v: MLVisualState | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.step;
  switch (stage) {
    case "ingest":
      return v.dataset ? `${v.dataset.rows.toLocaleString()} rows × ${v.dataset.columns.length}` : undefined;
    case "inspect":
      return v.inspection ? `${v.inspection.columns.filter((c) => c.type === "numeric").length} numeric · ${v.inspection.columns.filter((c) => c.type === "categorical" || c.type === "boolean").length} categorical` : undefined;
    case "identify":
      return v.identified ? `${v.identified.task} · ${v.identified.target}` : undefined;
    case "clean":
      return v.cleaned ? `${v.cleaned.rowsAfter} rows · −${v.cleaned.droppedColumns.length} cols` : undefined;
    case "missing":
      return v.imputed ? (v.imputed.rowsDropped ? `${v.imputed.rowsDropped} rows dropped` : `${v.imputed.reports.reduce((a, r) => a + r.filled, 0)} gaps filled`) : undefined;
    case "encode":
      return v.encoded ? `${v.encoded.featureNames.length} numeric features` : undefined;
    case "scale":
      return v.scaled ? `${v.scaled.reports[0]?.method ?? "none"}` : undefined;
    case "engineer":
      return v.engineered ? (v.engineered.added.length ? `+${v.engineered.added.length} features` : "off") : undefined;
    case "split":
      return v.split ? `${v.split.report.train} / ${v.split.report.validation} / ${v.split.report.test}` : undefined;
    case "selectModel":
      return v.model ? v.model.algorithm.replace(/_/g, " ") : undefined;
    case "init":
      if (v.knn) return `${v.knn.stored} rows stored · K=${v.knn.k}`;
      return v.init ? `${v.init.params.count.toLocaleString()} params · seed ${v.init.seed}` : undefined;
    case "forward":
      if (v.knn) return v.knn.queries.length ? `query ${v.knn.queries.at(-1)!.queryIndex + 1}` : undefined;
      if (v.treeSplits.length) return `${v.treeSplits.at(-1)!.candidatesEvaluated} candidates`;
      return s ? `batch ${s.batch}/${s.batchesPerEpoch} · ${s.batchSize} rows` : undefined;
    case "loss":
      if (v.treeSplits.length) return `impurity ${fmt(v.treeSplits.at(-1)!.impurityBefore)}`;
      return s ? `${s.loss.kind} ${fmt(s.loss.value, 4)}` : undefined;
    case "gradient":
      return s ? `‖∇‖ ${fmt(s.gradient.norm)}${s.gradient.clipped ? " clipped" : ""}` : undefined;
    case "backprop":
      return s ? `${s.backward.length} layer${s.backward.length === 1 ? "" : "s"}` : undefined;
    case "update": {
      const last = v.treeSplits.at(-1);
      if (last) return last.chosen ? `${last.chosen.feature} ≤ ${fmt(last.chosen.threshold, 2)}` : `leaf · ${last.samples} rows`;
      if (v.naiveBayes.length) return `${v.naiveBayes.length} class${v.naiveBayes.length === 1 ? "" : "es"} fitted`;
      return s ? `${s.update.optimizer} · η ${s.update.learningRate}` : undefined;
    }
    case "iterate":
      if (v.trees.length) return `${v.trees.length} tree${v.trees.length === 1 ? "" : "s"} built`;
      if (v.treeSplits.length) return `${v.treeSplits.length} nodes grown`;
      return v.stepsSeen ? `${v.stepsSeen.toLocaleString()} steps` : undefined;
    case "epoch": {
      const e = v.epochs.at(-1);
      return e ? `epoch ${e.epoch} · loss ${fmt(e.trainLoss, 4)}` : undefined;
    }
    case "validate":
      return v.validation ? metricBrief(v.validation.metrics) : undefined;
    case "hyperparams":
      if (v.candidateRunning) return `${v.candidateRunning.parameter} = ${v.candidateRunning.value}…`;
      return v.sweep ? (v.sweep.candidates.length ? `${v.sweep.candidates.length} candidates` : `${v.sweep.checkpoints?.length ?? 0} checkpoints`) : undefined;
    case "selectBest":
      return v.best ? v.best.choice : undefined;
    case "test":
      return v.test ? metricBrief(v.test.metrics) : undefined;
    case "evaluate":
      return v.evaluation ? `${v.evaluation.importance?.values[0]?.feature ?? "no importance"} matters most` : undefined;
    case "save":
      return v.saved ? `${(v.saved.bytes / 1024).toFixed(1)} KB · ${v.completion ? formatMs(v.completion.totalMs) : ""}` : undefined;
    case "infer":
      return v.inference ? `${v.inference.trace.encoded.length} inputs` : undefined;
    case "predict":
      return v.inference ? `→ ${v.inference.trace.label}` : undefined;
  }
}

function metricBrief(m: Metrics): string {
  return m.task === "classification" ? `acc ${(m.accuracy * 100).toFixed(1)}%` : `R² ${fmt(m.r2)}`;
}
