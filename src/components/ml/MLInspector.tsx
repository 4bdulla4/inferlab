import { Pause, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { DataSource } from "@shared/llm";
import type { Metrics } from "@shared/ml";
import type { NodeState } from "@/types/execution";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { ML_STAGES, type MLStageId } from "@/labs/ml/stages";
import type { MLRunState, MLVisualState } from "@/labs/ml/state";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { useMLStore } from "@/store/mlStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { Badge } from "@/components/ui/Badge";
import { BarList, classColor, ConfusionMatrix, Curves, DecisionSurfaceView, Histogram, LineChart, MetricCards, NetworkDiagram, PredictionTable, ProbabilityBars, SplitBars, TreeView, WeightStrips } from "./MLVisuals";

const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : "—");

/** What the inspector and the visualization are both looking at right now. */
export function useInspectedMLStage(run: MLRunState | undefined) {
  const selected = useMLStore((s) => s.selectedStage);
  const selectStage = useMLStore((s) => s.selectStage);
  const visual = run?.visual;
  const stage: MLStageId | null = selected ?? visual?.currentStage ?? null;
  const def = stage ? ML_STAGES[stage] : null;
  const state: NodeState = stage ? (visual?.nodes[stage] ?? "idle") : "idle";
  const source: DataSource = stage ? (visual?.nodeSources[stage] ?? ML_STAGES[stage].defaultSource) : "live";
  const toggleFollow = useCallback(() => {
    if (selected) selectStage(null);
    else if (stage) selectStage(stage);
  }, [selected, stage, selectStage]);
  return { stage, def, state, source, pinned: Boolean(selected), toggleFollow, visual };
}

function FollowToggle({ pinned, onToggle, disabled }: { pinned: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pinned}
      title={pinned ? "Resume following the run" : "Hold this stage still so it stops changing"}
      className={cn("mono inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] uppercase tracking-[0.1em] disabled:opacity-40 disabled:cursor-not-allowed", pinned ? "border-accent/50 bg-accent/10 text-accent-soft hover:border-accent" : "border-line text-ink-dim hover:border-line-strong hover:text-ink")}
    >
      {pinned ? <PlayCircle className="size-3" aria-hidden="true" /> : <Pause className="size-3" aria-hidden="true" />}
      {pinned ? "follow" : "hold"}
    </button>
  );
}

function StageHeader({ label, state, source, reducedMotion }: { label: string; state: NodeState; source: DataSource; reducedMotion: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[16px] inline-flex">
        <StatusIcon state={state} spin={!reducedMotion} />
      </span>
      <h3 className="mono text-[13px] font-semibold tracking-[0.14em] uppercase text-ink">{label}</h3>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted">{NODE_STATE_LABEL[state]}</span>
        <SourceBadge source={source} compact />
      </span>
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 mono text-[11px]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted whitespace-nowrap">{k}</dt>
          <dd className="text-ink-dim min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Explanation, data source and the facts of the stage in view. */
export function MLInspectorPanel({ run, className }: { run: MLRunState | undefined; className?: string }) {
  const mode = useUIStore((s) => s.mode);
  const reducedMotion = useReducedMotion();
  const { stage, def, state, source, pinned, toggleFollow, visual } = useInspectedMLStage(run);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pinned) bodyRef.current?.scrollTo({ top: 0 });
  }, [pinned, stage]);
  const skipped = Boolean(stage && visual?.skipped.includes(stage));

  return (
    <GlassPanel bodyRef={bodyRef} title="Inspector" subtitle={pinned ? "held still" : stage ? "following execution" : undefined} actions={<FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!stage} />} className={className} bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll content-start">
      {!def || !stage ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Click any stage in the diagram or the timeline to inspect it. While a run plays the inspector follows the active stage.</p>
      ) : (
        <>
          <StageHeader label={def.label} state={state} source={source} reducedMotion={reducedMotion} />
          <p className="text-[12.5px] leading-relaxed text-ink-dim">{mode === "beginner" ? def.beginner : def.advanced}</p>
          {skipped && visual?.skipReason ? (
            <p className="flex items-start gap-2 text-[11.5px] leading-snug text-muted">
              <Badge tone="warn" className="shrink-0 mt-px">
                not used
              </Badge>
              {visual.skipReason}
            </p>
          ) : null}
          <p className="text-[11px] leading-snug text-muted border-l-2 border-line pl-2.5">{def.sourceNote}</p>
          {visual ? <Facts rows={factsFor(stage, visual)} /> : null}
          {visual?.notices.length && (stage === visual.currentStage || pinned) ? (
            <ul className="grid gap-1">
              {visual.notices.slice(-3).map((n, i) => (
                <li key={i} className={cn("text-[11px] leading-snug", n.level === "warn" ? "text-warn" : "text-muted")}>
                  {n.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </GlassPanel>
  );
}

function factsFor(stage: MLStageId, v: MLVisualState): [string, ReactNode][] {
  const s = v.step;
  switch (stage) {
    case "ingest":
      return v.dataset ? [["file", v.dataset.name], ["format", v.dataset.format.toUpperCase()], ["rows", v.dataset.rows.toLocaleString()], ["columns", v.dataset.columns.length], ["size", `${(v.dataset.bytes / 1024).toFixed(1)} KB`], ["origin", v.dataset.origin === "sample" ? `sample${v.dataset.synthetic ? " · synthetic, generated for the lab" : ""}` : "your upload"]] : [];
    case "inspect":
      return v.inspection ? [["columns", v.inspection.columns.map((c) => `${c.name} (${c.type})`).join(", ")], ["missing cells", v.inspection.columns.reduce((a, c) => a + c.missing, 0)]] : [];
    case "identify":
      return v.identified ? [["task", v.identified.task], ["target", v.identified.target], ["classes", v.identified.classes?.join(", ")], ["features", `${v.identified.features.length}: ${v.identified.features.join(", ")}`], ["why", v.identified.reason]] : [];
    case "clean":
      return v.cleaned ? [["rows", `${v.cleaned.rowsBefore} → ${v.cleaned.rowsAfter}`], ["empty target", v.cleaned.droppedRows.emptyTarget], ["duplicates", v.cleaned.droppedRows.duplicates], ["columns dropped", v.cleaned.droppedColumns.length ? v.cleaned.droppedColumns.map((c) => `${c.name} (${c.reason})`).join("; ") : "none"]] : [];
    case "missing":
      return v.imputed ? (v.imputed.rowsDropped ? [["strategy", "drop rows"], ["rows dropped", v.imputed.rowsDropped]] : v.imputed.reports.length ? v.imputed.reports.map((r) => [r.column, `${r.filled} filled with ${r.strategy}${r.value !== undefined ? ` = ${typeof r.value === "number" ? fmt(r.value, 3) : r.value}` : ""}`] as [string, ReactNode]) : [["gaps", "none in any feature"]]) : [];
    case "encode":
      return v.encoded ? [...v.encoded.reports.filter((r) => r.method !== "passthrough").map((r) => [r.column, `${r.method}${r.categories ? ` → ${r.producedColumns.length} columns` : ""}`] as [string, ReactNode]), ["target", v.encoded.targetEncoding.method === "label" ? `labels → 0…${(v.encoded.targetEncoding.classes?.length ?? 1) - 1}` : "numeric, as is"], ["model inputs", v.encoded.featureNames.length]] : [];
    case "scale":
      return v.scaled ? [["method", v.scaled.reports[0]?.method ?? "none"], ["fitted on", "training rows only"], ...v.scaled.reports.slice(0, 8).map((r) => [r.feature, r.method === "standard" ? `μ ${fmt(r.mean ?? 0, 3)} · σ ${fmt(r.std ?? 0, 3)}` : r.method === "minmax" ? `min ${fmt(r.min ?? 0, 3)} · max ${fmt(r.max ?? 0, 3)}` : "unchanged"] as [string, ReactNode])] : [];
    case "engineer":
      return v.engineered ? [["method", v.engineered.method], ["added", v.engineered.added.length ? v.engineered.added.join(", ") : "nothing"], ["features now", v.engineered.featureNames.length]] : [];
    case "split":
      return v.split ? [["train", v.split.report.train], ["validation", v.split.report.validation], ["test", v.split.report.test], ["subsampled", v.split.subsampled ? `${v.split.subsampled.from} → ${v.split.subsampled.to} training rows` : undefined]] : [];
    case "selectModel":
      return v.model ? [["algorithm", v.model.algorithm.replace(/_/g, " ")], ["family", v.model.family], ["task", v.model.task], ...hyperFacts(v)] : [];
    case "init":
      if (v.knn) return [["stored rows", v.knn.stored], ["features", v.knn.features], ["K", v.knn.k], ["parameters", "none — KNN keeps the rows themselves"]];
      return v.init ? [["seed", v.init.seed], ["parameters", v.init.params.count.toLocaleString()], ["‖θ‖ at start", fmt(v.init.params.norm)], ["layers", v.init.architecture?.layers.map((l) => `${l.name} ${l.units} ${l.activation}`).join(" → ")], ["note", v.init.note]] : [];
    case "forward":
      if (v.knn?.queries.length) {
        const q = v.knn.queries.at(-1)!;
        return [["query", `validation row ${q.queryIndex + 1}`], ["neighbours", q.neighbours.length], ["nearest distance", fmt(q.neighbours[0]?.distance ?? 0)], ["took", formatMs(q.ms)]];
      }
      if (v.treeSplits.length) {
        const t = v.treeSplits.at(-1)!;
        return [["tree", t.treeIndex + 1], ["node", t.nodeId], ["depth", t.depth], ["rows at node", t.samples], ["candidate splits", t.candidatesEvaluated]];
      }
      return s ? [["iteration", s.iteration], ["epoch", s.epoch], ["batch", `${s.batch} of ${s.batchesPerEpoch}`], ["rows in batch", s.batchSize], ["shown", `first ${s.forward.targets.length} rows`], ["took", formatMs(s.ms)]] : [];
    case "loss":
      if (v.treeSplits.length) {
        const t = v.treeSplits.at(-1)!;
        return [["impurity before", fmt(t.impurityBefore)], ["after best split", t.chosen ? fmt(t.chosen.impurityAfter) : "—"], ["gain", t.chosen ? fmt(t.chosen.gain) : "—"]];
      }
      return s ? [["kind", s.loss.kind], ["loss", fmt(s.loss.value, 5)], ["data term", fmt(s.loss.dataTerm, 5)], ["regularization", s.loss.regularizationTerm ? fmt(s.loss.regularizationTerm, 5) : "0 (off)"]] : [];
    case "gradient":
      return s ? [["‖∇‖ total", fmt(s.gradient.norm)], ["clipped", s.gradient.clipped ? "yes, to norm 10" : "no"], ...s.gradient.groups.map((g) => [g.name, `‖∇‖ ${fmt(g.norm)}`] as [string, ReactNode])] : [];
    case "backprop":
      return s ? s.backward.map((b) => [b.layer, `‖δ‖ ${fmt(b.deltaNorm)} · ‖∇‖ ${fmt(b.gradNorm)}`] as [string, ReactNode]) : [];
    case "update": {
      const t = v.treeSplits.at(-1);
      if (t) return t.chosen ? [["split", `${t.chosen.feature} ≤ ${fmt(t.chosen.threshold, 3)}`], ["left · right", `${t.chosen.left} · ${t.chosen.right} rows`]] : [["leaf value", t.leaf ? fmt(t.leaf.value, 3) : "—"], ["class counts", t.leaf?.classCounts?.join(" / ")]];
      if (v.naiveBayes.length) {
        const n = v.naiveBayes.at(-1)!;
        return [["class", n.className], ["prior", fmt(n.prior)], ["rows", n.samples], ["Gaussians", n.featureStats.length]];
      }
      return s ? [["optimizer", s.update.optimizer], ["learning rate", s.update.learningRate], ["‖Δθ‖ this step", fmt(s.update.stepNorm, 5)], ["‖θ‖ after", fmt(s.update.params.norm)]] : [];
    }
    case "iterate":
      return [["steps drawn", v.stepsSeen.toLocaleString()], ["stride", v.stride > 1 ? `every ${v.stride}th step is drawn; all are computed` : "every step drawn"], ["trees built", v.trees.length || undefined]];
    case "epoch": {
      const e = v.epochs.at(-1);
      return e ? [["epoch", e.epoch], ["train loss", fmt(e.trainLoss, 5)], ["validation loss", e.validationLoss === null ? "—" : fmt(e.validationLoss, 5)], [e.validationMetric?.name ?? "metric", e.validationMetric ? fmt(e.validationMetric.value) : "—"], ["best so far", e.bestSoFar ? "yes · parameters kept" : "no"], ["took", formatMs(e.ms)]] : [];
    }
    case "validate":
      return v.validation ? metricFacts(v.validation.metrics) : [];
    case "hyperparams":
      if (v.candidateRunning) return [["training", `${v.candidateRunning.parameter} = ${v.candidateRunning.value}`]];
      return v.sweep ? [["compared on", v.sweep.metricName], ["direction", v.sweep.higherIsBetter ? "higher is better" : "lower is better"], ["candidates", v.sweep.candidates.length || undefined], ["checkpoints", v.sweep.checkpoints?.length]] : [];
    case "selectBest":
      return v.best ? [["chosen", v.best.choice], ["why", v.best.reason], ["retrained", v.best.retrained ? "yes" : "no · the fitted candidate is used as is"]] : [];
    case "test":
      return v.test ? metricFacts(v.test.metrics) : [];
    case "evaluate":
      return v.evaluation ? [["importance", v.evaluation.importance ? `${v.evaluation.importance.method} · ${v.evaluation.importance.note}` : "none"], ["surface", v.evaluation.surface ? `${v.evaluation.surface.xFeature} × ${v.evaluation.surface.yFeature} · ${v.evaluation.surface.source === "live" ? "exact" : "2-D slice (simulation)"}` : "none"]] : [];
    case "save":
      return v.saved ? [["model id", v.saved.modelId], ["size", `${(v.saved.bytes / 1024).toFixed(1)} KB`], ["parameters", v.saved.params.count.toLocaleString()], ["tree nodes", v.saved.tree?.length], ["forest", v.saved.forest ? `${v.saved.forest.trees} trees · ${v.saved.forest.nodes} nodes` : undefined], ["total time", v.completion ? formatMs(v.completion.totalMs) : undefined]] : [];
    case "infer":
      return v.inference ? [["input", Object.entries(v.inference.input).map(([k, val]) => `${k} = ${String(val)}`).join(" · ")], ["encoded", `${v.inference.trace.encoded.length} numbers`], ["scaled", v.inference.trace.scaled.map((x) => fmt(x, 3)).join(", ")]] : [];
    case "predict":
      return v.inference ? [["prediction", v.inference.trace.label], ["confidence", v.inference.trace.probabilities ? `${(Math.max(...v.inference.trace.probabilities) * 100).toFixed(1)}%` : "n/a for this model"], ["took", formatMs(v.inference.trace.ms)]] : [];
  }
}

function hyperFacts(v: MLVisualState): [string, ReactNode][] {
  const m = v.model;
  if (!m) return [];
  const h = m.hyperparameters;
  switch (m.family) {
    case "gradient":
      return [["learning rate", h.learningRate], ["epochs", h.epochs], ["batch", h.batchSize], ["optimizer", h.optimizer], ["regularization", h.regularization === "none" ? "none" : `${h.regularization} · λ ${h.regularizationStrength}`], ...(m.algorithm === "neural_network" ? ([["hidden layers", h.hiddenLayers.join(" → ")], ["activation", h.activation]] as [string, ReactNode][]) : []), ...(m.algorithm === "svm" ? ([["C", h.svmC]] as [string, ReactNode][]) : [])];
    case "tree":
      return [["max depth", h.maxDepth], ["min rows per leaf", h.minSamplesLeaf], ...(m.algorithm === "random_forest" ? ([["trees", h.trees]] as [string, ReactNode][]) : [])];
    case "instance":
      return [["K", h.k]];
    case "probabilistic":
      return [["assumption", "features independent given the class"]];
  }
}

function metricFacts(m: Metrics): [string, ReactNode][] {
  return m.task === "classification" ? [["accuracy", `${(m.accuracy * 100).toFixed(2)}%`], ["precision (macro)", fmt(m.precisionMacro)], ["recall (macro)", fmt(m.recallMacro)], ["F1 (macro)", fmt(m.f1Macro)], ["log loss", m.logLoss === null ? "—" : fmt(m.logLoss)], ["rows", m.n]] : [["RMSE", fmt(m.rmse)], ["MAE", fmt(m.mae)], ["R²", fmt(m.r2)], ["rows", m.n]];
}

/** The picture of the stage in view: rows, curves, weights, trees, neighbours, metrics, surfaces. */
export function MLVisualizationPanel({ run, className }: { run: MLRunState | undefined; className?: string }) {
  const { stage, def, visual, source } = useInspectedMLStage(run);
  const focusColumn = useMLStore((s) => s.focusColumn);
  const setFocusColumn = useMLStore((s) => s.setFocusColumn);
  return (
    <GlassPanel title="Visualization" subtitle={def?.label} actions={stage ? <SourceBadge source={source} compact /> : null} className={className} bodyClassName="p-4 overflow-y-auto panel-scroll">
      {!stage || !visual ? <p className="text-[12.5px] leading-relaxed text-muted">The stage in view is drawn here: rows and distributions, the loss falling, weights and gradients, trees growing, neighbours voting, metrics, and a labelled decision surface.</p> : <StageVisual stage={stage} v={visual} focusColumn={focusColumn} setFocusColumn={setFocusColumn} />}
    </GlassPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mono text-[11px] text-muted">{text}</p>;
}

function StageVisual({ stage, v, focusColumn, setFocusColumn }: { stage: MLStageId; v: MLVisualState; focusColumn: string | null; setFocusColumn: (c: string | null) => void }) {
  const classes = v.identified?.classes ?? null;
  const s = v.step;
  switch (stage) {
    case "ingest":
      return v.dataset ? <RowsTable columns={v.dataset.columns.map((c) => c.name)} rows={v.dataset.sampleRows} /> : <Empty text="waiting for rows…" />;
    case "inspect": {
      const cols = v.inspection?.columns ?? v.dataset?.columns ?? [];
      if (!cols.length) return <Empty text="inspecting…" />;
      const focus = cols.find((c) => c.name === focusColumn) ?? cols[0]!;
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-1">
            {cols.map((c) => (
              <button key={c.name} type="button" onClick={() => setFocusColumn(c.name)} className={cn("mono rounded-md border px-2 h-6 text-[10.5px]", focus.name === c.name ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-muted hover:border-line-strong")}>
                {c.name} <span className="text-faint">· {c.type}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Histogram column={focus} />
            <Facts rows={[["type", focus.type], ["missing", focus.missing], ["unique", focus.unique], ...(focus.stats ? ([["min · max", `${fmt(focus.stats.min, 2)} · ${fmt(focus.stats.max, 2)}`], ["mean", fmt(focus.stats.mean, 3)], ["std", fmt(focus.stats.std, 3)], ["median", fmt(focus.stats.median, 3)]] as [string, ReactNode][]) : []), ["examples", focus.examples.join(", ")]]} />
          </div>
          {v.inspection?.targetCorrelations?.length ? (
            <div className="grid gap-1">
              <p className="label-caps">correlation with the target</p>
              <BarList signed items={v.inspection.targetCorrelations.map((c) => ({ label: c.feature, value: c.correlation, text: c.correlation.toFixed(3) }))} max={1} />
            </div>
          ) : null}
        </div>
      );
    }
    case "identify":
      return v.identified ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1.5">
            {v.identified.features.map((f) => (
              <Badge key={f} tone="live">
                {f}
              </Badge>
            ))}
            <span className="mono text-[11px] text-muted self-center">→</span>
            <Badge tone="warn">{v.identified.target}</Badge>
          </div>
          {classes ? (
            <ul className="flex flex-wrap gap-1.5 mono text-[10.5px]">
              {classes.map((c, i) => (
                <li key={c} className="rounded-md border border-line px-2 h-6 inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: classColor(i) }} /> {c} <span className="text-faint">= {i}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="a numeric target: this is regression" />
          )}
        </div>
      ) : (
        <Empty text="deciding the target…" />
      );
    case "clean":
      return v.cleaned ? <BarList items={[{ label: "rows before", value: v.cleaned.rowsBefore, color: "var(--color-line-strong)", text: String(v.cleaned.rowsBefore) }, { label: "rows after", value: v.cleaned.rowsAfter, text: String(v.cleaned.rowsAfter) }, { label: "empty target", value: v.cleaned.droppedRows.emptyTarget, color: "var(--color-err)", text: String(v.cleaned.droppedRows.emptyTarget) }, { label: "duplicates", value: v.cleaned.droppedRows.duplicates, color: "var(--color-err)", text: String(v.cleaned.droppedRows.duplicates) }]} /> : <Empty text="cleaning…" />;
    case "missing":
      return v.imputed ? (v.imputed.reports.length ? <BarList items={v.imputed.reports.map((r) => ({ label: r.column, value: r.filled, text: `${r.filled} × ${r.value !== undefined ? (typeof r.value === "number" ? fmt(r.value, 2) : r.value) : r.strategy}`, color: "var(--color-warn)" }))} /> : <Empty text="no gaps to fill" />) : <Empty text="looking for gaps…" />;
    case "encode":
      return v.encoded ? (
        <div className="grid gap-2">
          {v.encoded.reports.filter((r) => r.method === "one-hot").map((r) => (
            <div key={r.column} className="grid gap-1">
              <p className="mono text-[10.5px] text-ink-dim">
                {r.column} <span className="text-faint">→ one column per category</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {r.producedColumns.map((c) => (
                  <span key={c} className="mono text-[10px] rounded border border-line px-1.5 h-5 inline-flex items-center text-muted">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="mono text-[10.5px] text-muted">
            model inputs: <span className="text-ink">{v.encoded.featureNames.join(", ")}</span>
          </p>
        </div>
      ) : (
        <Empty text="encoding…" />
      );
    case "scale":
      return v.scaled?.reports.length ? <BarList items={v.scaled.reports.map((r) => ({ label: r.feature, value: r.method === "standard" ? (r.std ?? 0) : r.method === "minmax" ? (r.max ?? 0) - (r.min ?? 0) : 0, text: r.method === "standard" ? `σ ${fmt(r.std ?? 0, 3)}` : r.method === "minmax" ? `range ${fmt((r.max ?? 0) - (r.min ?? 0), 3)}` : "—" }))} /> : <Empty text={v.scaled ? "scaling is off" : "scaling…"} />;
    case "engineer":
      return v.engineered ? (
        <div className="flex flex-wrap gap-1">
          {v.engineered.featureNames.map((f) => (
            <Badge key={f} tone={v.engineered!.added.includes(f) ? "sim" : "neutral"}>
              {f}
            </Badge>
          ))}
          {!v.engineered.added.length ? <span className="mono text-[10.5px] text-muted self-center">no features added (off in settings)</span> : null}
        </div>
      ) : (
        <Empty text="…" />
      );
    case "split":
      return v.split ? (
        <div className="grid gap-3">
          <SplitBars report={v.split.report} />
          {v.split.report.samples.length ? (
            <div className="grid gap-1">
              <p className="label-caps">a few preprocessed rows</p>
              <table className="w-full mono text-[10px]">
                <tbody>
                  {v.split.report.samples.slice(0, 9).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className={cn("py-0.5 pr-2", r.split === "train" ? "text-live" : r.split === "validation" ? "text-warn" : "text-accent-soft")}>{r.split}</td>
                      <td className="py-0.5 text-ink-dim truncate max-w-[280px]">[{r.features.map((x) => fmt(x, 2)).join(", ")}]</td>
                      <td className="py-0.5 pl-2 text-ink">→ {classes ? classes[r.target] : fmt(r.target, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <Empty text="dealing rows…" />
      );
    case "selectModel":
      return v.model ? (
        <div className="grid gap-2">
          <p className="text-[12px] text-ink-dim leading-relaxed">{ML_STAGES.selectModel.caption}: <span className="text-ink">{v.model.algorithm.replace(/_/g, " ")}</span> for {v.model.task}.</p>
          {v.skipped.length ? (
            <p className="text-[11px] text-muted leading-snug">
              Stages not used by this family: {v.skipped.map((id) => ML_STAGES[id].label).join(", ")}. {v.skipReason}
            </p>
          ) : null}
        </div>
      ) : (
        <Empty text="choosing…" />
      );
    case "init":
      if (v.init?.architecture) return <NetworkDiagram architecture={v.init.architecture} params={v.init.params} />;
      if (v.init?.params.groups.length) return <WeightStrips params={v.init.params} />;
      if (v.knn) return <Empty text={`${v.knn.stored} training rows stored in memory, nothing fitted — KNN is a lazy learner.`} />;
      return <Empty text={v.init?.note ?? "initializing…"} />;
    case "forward":
      if (v.knn?.queries.length) return <KnnView v={v} classes={classes} />;
      if (v.treeSplits.length || v.tree) return <TreeProgress v={v} classes={classes} />;
      if (v.naiveBayes.length) return <NaiveBayesView v={v} />;
      if (!s) return <Empty text="the first batch is on its way…" />;
      return (
        <div className="grid gap-3">
          {v.init?.architecture ? <NetworkDiagram architecture={v.init.architecture} params={s.update.params} activations={s.forward.activations} /> : null}
          <ForwardTable step={s} classes={classes} />
        </div>
      );
    case "loss":
      if (v.treeSplits.length) return <TreeProgress v={v} classes={classes} />;
      return v.lossTrace.length ? <LineChart series={[{ name: `${s?.loss.kind ?? "loss"} per step`, color: "var(--color-live)", points: v.lossTrace.map((p) => ({ x: p.iteration, y: p.loss })) }]} xLabel="iteration" yLabel="loss" /> : <Empty text="the first loss arrives after the first forward pass" />;
    case "gradient":
      return s ? <BarList items={s.gradient.groups.map((g) => ({ label: g.name, value: g.norm, color: "var(--color-warn)" }))} /> : <Empty text="no gradient yet" />;
    case "backprop":
      return s?.backward.length ? (
        <div className="grid gap-2">
          <p className="label-caps">error signal per layer, output first</p>
          <BarList items={s.backward.map((b) => ({ label: b.layer, value: b.deltaNorm, text: `‖δ‖ ${fmt(b.deltaNorm, 3)} · ‖∇‖ ${fmt(b.gradNorm, 3)}`, color: "var(--color-sim)" }))} />
        </div>
      ) : (
        <Empty text="nothing to propagate yet" />
      );
    case "update": {
      if (v.treeSplits.length || v.tree) return <TreeProgress v={v} classes={classes} />;
      if (v.naiveBayes.length) return <NaiveBayesView v={v} />;
      const params = s?.update.params ?? v.params;
      return params?.groups.length ? <WeightStrips params={params} gradient={s?.gradient} /> : <Empty text="no parameters yet" />;
    }
    case "iterate":
      if (v.knn?.queries.length) return <KnnView v={v} classes={classes} />;
      if (v.trees.length) return <BarList items={v.trees.map((t) => ({ label: `tree ${t.treeIndex + 1}`, value: t.oobScore ?? t.nodes, text: t.oobScore !== null ? `OOB ${fmt(t.oobScore, 3)} · ${t.nodes} nodes` : `${t.nodes} nodes · depth ${t.depth}` }))} />;
      if (v.treeSplits.length) return <TreeProgress v={v} classes={classes} />;
      return v.lossTrace.length ? <LineChart series={[{ name: "loss per step", color: "var(--color-live)", points: v.lossTrace.map((p) => ({ x: p.iteration, y: p.loss })) }]} xLabel="iteration" yLabel="loss" /> : <Empty text="…" />;
    case "epoch":
      return v.epochs.length ? <EpochChart v={v} /> : <Empty text="the first epoch has not finished" />;
    case "validate":
      return v.validation ? <MetricsView metrics={v.validation.metrics} rows={v.validation.predictionsSample} classes={classes} /> : <Empty text="scoring the validation rows…" />;
    case "hyperparams":
      if (v.candidates.length || v.sweep?.candidates.length) {
        const cs = v.sweep?.candidates.length ? v.sweep.candidates : v.candidates;
        return <BarList items={cs.map((c) => ({ label: `${c.parameter} = ${c.value}`, value: c.validationMetric.value, text: `${c.validationMetric.name} ${fmt(c.validationMetric.value, 3)}${c.best ? " ★" : ""}`, highlight: c.best, color: c.best ? "var(--color-ok)" : undefined }))} />;
      }
      if (v.sweep?.checkpoints?.length) return <LineChart series={[{ name: v.sweep.metricName, color: "var(--color-warn)", points: v.sweep.checkpoints.map((c) => ({ x: c.epoch, y: c.validationMetric })) }]} xLabel="epoch" yLabel={v.sweep.metricName} />;
      if (v.candidateRunning) return <Empty text={`training candidate ${v.candidateRunning.parameter} = ${v.candidateRunning.value}…`} />;
      return <Empty text="no sweep set: this run's epochs are compared as checkpoints" />;
    case "selectBest":
      return v.best ? <p className="text-[12.5px] leading-relaxed text-ink-dim">{v.best.reason}</p> : <Empty text="…" />;
    case "test":
      return v.test ? <MetricsView metrics={v.test.metrics} rows={v.test.predictions} classes={classes} /> : <Empty text="the sealed test rows are scored once, at the end" />;
    case "evaluate":
      return v.evaluation ? (
        <div className="grid gap-4">
          {v.evaluation.importance ? (
            <div className="grid gap-1">
              <p className="label-caps flex items-center gap-2">
                feature importance · {v.evaluation.importance.method} <SourceBadge source={v.evaluation.importance.source} compact />
              </p>
              <BarList items={v.evaluation.importance.values.map((x) => ({ label: x.feature, value: x.importance, color: "var(--color-ok)" }))} />
            </div>
          ) : null}
          {v.evaluation.surface ? <DecisionSurfaceView surface={v.evaluation.surface} classes={classes} /> : null}
          {v.evaluation.lossCurve.length > 1 ? <LineChart height={130} series={[{ name: "train", color: "var(--color-live)", points: v.evaluation.lossCurve.map((p) => ({ x: p.epoch, y: p.train })) }, { name: "validation", color: "var(--color-warn)", dashed: true, points: v.evaluation.lossCurve.filter((p) => p.validation !== null).map((p) => ({ x: p.epoch, y: p.validation! })) }]} xLabel="epoch" yLabel="loss" /> : null}
        </div>
      ) : (
        <Empty text="evaluating…" />
      );
    case "save":
      if (v.saved?.architecture) return <NetworkDiagram architecture={v.saved.architecture} params={v.saved.params} />;
      if (v.saved?.tree) return <TreeView nodes={v.saved.tree} classes={classes} />;
      if (v.saved?.params.groups.length) return <WeightStrips params={v.saved.params} />;
      return <Empty text={v.saved ? "saved: the stored rows and preprocessing recipe" : "saving…"} />;
    case "infer":
      return v.inference ? (
        <div className="grid gap-2">
          <p className="label-caps">encoded → scaled</p>
          <table className="w-full mono text-[10.5px]">
            <tbody>
              {v.inference.trace.encoded.map((e, i) => (
                <tr key={e.feature} className="border-t border-line">
                  <td className="py-0.5 text-ink-dim">{e.feature}</td>
                  <td className="py-0.5 text-muted">{fmt(e.value, 3)}</td>
                  <td className="py-0.5 text-faint">→</td>
                  <td className="py-0.5 text-ink">{fmt(v.inference!.trace.scaled[i] ?? 0, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty text="type a new row in the result panel to see it transformed" />
      );
    case "predict":
      return v.inference ? <PredictionTrace v={v} classes={classes} /> : <Empty text="no prediction yet" />;
  }
}

function RowsTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-auto panel-scroll max-h-[300px] rounded-lg border border-line">
      <table className="mono text-[10.5px] min-w-full">
        <thead className="sticky top-0 surface-2">
          <tr>
            {columns.map((c) => (
              <th key={c} className="text-left font-normal text-muted px-2 py-1 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((cell, j) => (
                <td key={j} className={cn("px-2 py-0.5 whitespace-nowrap", cell === "" ? "text-err/70 italic" : "text-ink-dim")}>
                  {cell === "" ? "missing" : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForwardTable({ step, classes }: { step: NonNullable<MLVisualState["step"]>; classes: string[] | null }) {
  return (
    <div className="grid gap-1">
      <p className="label-caps">first rows of the batch · prediction vs truth</p>
      <table className="w-full mono text-[10.5px]">
        <tbody>
          {step.forward.targets.map((t, i) => {
            const p = step.forward.predictions[i] ?? [];
            const pred = classes ? p.indexOf(Math.max(...p)) : (p[0] ?? 0);
            return (
              <tr key={i} className="border-t border-line">
                <td className="py-0.5 text-faint">#{step.forward.indices[i]}</td>
                <td className="py-0.5 text-ink-dim">{classes ? (p.length > 1 ? p.map((x) => fmt(x, 2)).join(" · ") : fmt(p[0] ?? 0, 3)) : fmt(p[0] ?? 0, 3)}</td>
                <td className="py-0.5 text-ink">→ {classes ? classes[pred] : ""}</td>
                <td className={cn("py-0.5", classes ? (pred === t ? "text-ok" : "text-err") : "text-muted")}>{classes ? `truth ${classes[t]}` : `truth ${fmt(t, 3)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TreeProgress({ v, classes }: { v: MLVisualState; classes: string[] | null }) {
  const last = v.treeSplits.at(-1);
  return (
    <div className="grid gap-3">
      {v.tree ? <TreeView nodes={v.tree} classes={classes} /> : null}
      {last ? (
        <div className="grid gap-1">
          <p className="label-caps">
            latest node · tree {last.treeIndex + 1} · node {last.nodeId} · depth {last.depth}
          </p>
          <BarList
            items={[
              { label: "impurity before", value: last.impurityBefore, color: "var(--color-err)" },
              ...(last.chosen ? [{ label: `after ${last.chosen.feature} ≤ ${fmt(last.chosen.threshold, 2)}`, value: last.chosen.impurityAfter, color: "var(--color-ok)" }] : []),
            ]}
          />
          <p className="mono text-[10px] text-muted">{last.chosen ? `${last.candidatesEvaluated} candidate thresholds scored · best gain ${fmt(last.chosen.gain)} · ${last.chosen.left} | ${last.chosen.right} rows` : `leaf · ${last.samples} rows · value ${last.leaf ? fmt(last.leaf.value, 3) : "—"}`}</p>
        </div>
      ) : null}
      {v.treeSplits.length ? <SplitLog v={v} /> : null}
    </div>
  );
}

function SplitLog({ v }: { v: MLVisualState }) {
  return (
    <ol className="grid gap-0.5 mono text-[10px] max-h-40 overflow-y-auto panel-scroll">
      {v.treeSplits.slice(-30).map((t) => (
        <li key={`${t.treeIndex}-${t.nodeId}`} className="flex gap-2 text-muted">
          <span className="text-faint w-16 shrink-0">n{t.nodeId} d{t.depth}</span>
          <span className="truncate text-ink-dim">{t.chosen ? `${t.chosen.feature} ≤ ${fmt(t.chosen.threshold, 3)} · gain ${fmt(t.chosen.gain, 3)}` : `leaf · ${t.samples} rows`}</span>
        </li>
      ))}
    </ol>
  );
}

function KnnView({ v, classes }: { v: MLVisualState; classes: string[] | null }) {
  const q = v.knn?.queries.at(-1);
  if (!q) return <Empty text="…" />;
  const max = Math.max(1e-9, ...q.neighbours.map((n) => n.distance));
  return (
    <div className="grid gap-2">
      <p className="label-caps">
        validation row {q.queryIndex + 1} · its {q.neighbours.length} nearest training rows
      </p>
      <BarList max={max} items={q.neighbours.map((n) => ({ label: `row ${n.index}`, value: n.distance, text: `d ${fmt(n.distance, 3)} · ${classes ? classes[n.target] : fmt(n.target, 2)}`, color: classes ? classColor(n.target) : undefined }))} />
      <p className={cn("mono text-[11px]", classes ? (q.prediction === q.target ? "text-ok" : "text-err") : "text-ink-dim")}>
        {classes ? `vote → ${classes[q.prediction]} · truth ${classes[q.target]}` : `mean → ${fmt(q.prediction, 3)} · truth ${fmt(q.target, 3)}`}
      </p>
    </div>
  );
}

function NaiveBayesView({ v }: { v: MLVisualState }) {
  return (
    <div className="grid gap-3">
      {v.naiveBayes.map((c) => (
        <div key={c.className} className="grid gap-1">
          <p className="mono text-[10.5px]" style={{ color: classColor(c.classIndex) }}>
            {c.className} · prior {fmt(c.prior, 3)} · {c.samples} rows
          </p>
          <div className="grid gap-0.5 mono text-[10px]">
            {c.featureStats.slice(0, 10).map((f) => (
              <div key={f.feature} className="grid grid-cols-[minmax(0,120px)_1fr_1fr] gap-2 text-muted">
                <span className="truncate text-ink-dim">{f.feature}</span>
                <span>μ {fmt(f.mean, 3)}</span>
                <span>σ² {fmt(f.variance, 3)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EpochChart({ v }: { v: MLVisualState }) {
  const best = v.epochs.filter((e) => e.bestSoFar).at(-1);
  const metricName = v.epochs[0]?.validationMetric?.name;
  return (
    <div className="grid gap-3">
      <LineChart series={[{ name: "train loss", color: "var(--color-live)", points: v.epochs.map((e) => ({ x: e.epoch, y: e.trainLoss })) }, { name: "validation loss", color: "var(--color-warn)", dashed: true, points: v.epochs.filter((e) => e.validationLoss !== null).map((e) => ({ x: e.epoch, y: e.validationLoss! })) }]} xLabel="epoch" yLabel="loss" marker={best ? { x: best.epoch, label: `best ep ${best.epoch}` } : null} />
      {metricName ? <LineChart height={120} series={[{ name: `validation ${metricName}`, color: "var(--color-ok)", points: v.epochs.filter((e) => e.validationMetric).map((e) => ({ x: e.epoch, y: e.validationMetric!.value })) }]} xLabel="epoch" yLabel={metricName} /> : null}
    </div>
  );
}

function MetricsView({ metrics, rows, classes }: { metrics: Metrics; rows: NonNullable<MLVisualState["test"]>["predictions"]; classes: string[] | null }) {
  return (
    <div className="grid gap-3">
      <MetricCards metrics={metrics} />
      {metrics.task === "classification" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <ConfusionMatrix confusion={metrics.confusion} />
          <Curves metrics={metrics} />
        </div>
      ) : null}
      <PredictionTable rows={rows} classes={classes} />
    </div>
  );
}

function PredictionTrace({ v, classes }: { v: MLVisualState; classes: string[] | null }) {
  const t = v.inference!.trace;
  return (
    <div className="grid gap-3">
      <p className="text-[15px] text-ink">
        → <span className="font-semibold">{t.label}</span>
        {t.probabilities ? <span className="mono text-[11px] text-muted ml-2">{(Math.max(...t.probabilities) * 100).toFixed(1)}% confident</span> : null}
      </p>
      {t.probabilities && classes ? <ProbabilityBars probabilities={t.probabilities} classes={classes} /> : null}
      {t.layers && v.saved?.architecture ? <NetworkDiagram architecture={v.saved.architecture} params={v.saved.params} activations={t.layers.map((l) => ({ layer: l.name, values: l.values }))} /> : null}
      {t.layers && !v.saved?.architecture ? <BarList signed items={t.layers.flatMap((l) => l.values.map((x, i) => ({ label: `${l.name}${l.values.length > 1 ? ` ${i}` : ""}`, value: x })))} /> : null}
      {t.path && v.saved?.tree ? <TreeView nodes={v.saved.tree} classes={classes} path={t.path.filter((p) => p.treeIndex === 0).map((p) => p.nodeId)} /> : null}
      {t.path && !v.saved?.tree ? (
        <ol className="grid gap-0.5 mono text-[10.5px] text-muted max-h-40 overflow-y-auto panel-scroll">
          {t.path.slice(0, 40).map((p, i) => (
            <li key={i}>
              tree {p.treeIndex + 1} · node {p.nodeId}: {p.feature ? `${p.feature} ≤ ${fmt(p.threshold ?? 0, 3)} → ${p.went}` : `leaf ${classes ? classes[p.value] : fmt(p.value, 3)}`}
            </li>
          ))}
        </ol>
      ) : null}
      {t.neighbours ? <BarList items={t.neighbours.map((n) => ({ label: `row ${n.index}`, value: n.distance, text: `d ${fmt(n.distance, 3)} · ${classes ? classes[n.target] : fmt(n.target, 2)}`, color: classes ? classColor(n.target) : undefined }))} /> : null}
      {t.classScores ? <BarList signed items={t.classScores.map((c, i) => ({ label: c.className, value: c.logScore, text: fmt(c.logScore, 2), color: classColor(i) }))} /> : null}
    </div>
  );
}
