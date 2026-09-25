import type { DataSource } from "@shared/llm";
import type { Metrics, MLEvent, PredictionTrace } from "@shared/ml";
import type { EventStatus } from "@/types/execution";
import { PACE } from "@/labs/llm/sequencer";
import type { AnyMLEvent, MLEventDataMap, MLEventType, MLLabEvent } from "./events";
import { ML_STAGES, type MLStageId } from "./stages";

/** Base dwell per event type at 1x, before the shared pace multiplier. */
const DURATION: Record<MLEventType, number> = {
  RUN_STARTED: 400,
  DATASET_LOADED: 900,
  INSPECTED: 1300,
  IDENTIFIED: 1200,
  CLEANED: 1000,
  IMPUTED: 1100,
  ENCODED: 1200,
  SCALED: 1100,
  ENGINEERED: 800,
  SPLIT: 1300,
  MODEL_SELECTED: 1100,
  MODEL_INITIALIZED: 1100,
  FORWARD: 420,
  LOSS: 380,
  GRADIENT: 380,
  BACKPROP: 380,
  UPDATE: 420,
  ITERATE: 220,
  TREE_SPLIT: 650,
  TREE_BUILT: 500,
  KNN_INDEXED: 900,
  KNN_QUERY: 380,
  NB_CLASS_FITTED: 900,
  EPOCH_COMPLETED: 700,
  VALIDATED: 1400,
  CANDIDATE_STARTED: 400,
  CANDIDATE_FINISHED: 600,
  HYPERPARAMETERS_EVALUATED: 1300,
  BEST_SELECTED: 1200,
  TESTED: 1400,
  EVALUATED: 1400,
  MODEL_SAVED: 1100,
  RUN_COMPLETED: 500,
  INFERRED: 900,
  PREDICTED: 1200,
  NOTICE: 200,
  EXECUTION_ERROR: 500,
  EXECUTION_STOPPED: 300,
};

/**
 * Turns the server's live stream into the lab's ordered execution log. Nearly
 * everything an ML pipeline reports is a real computation, so nearly every
 * event is "live". The one labelled simplification is a decision surface drawn
 * on two features of a higher-dimensional model, which the server itself marks.
 *
 * A gradient `train_step` becomes six events, one per stage of the loop, so a
 * person watching at 1x sees forward, loss, gradient, backprop and update as
 * separate moments even though the server did them in one go. Each further
 * pass of the loop dwells a little less than the one before it; see loopScale.
 */
export class MLEventSequencer {
  private seq = 0;
  private lastStage: MLStageId = "ingest";
  /** Passes of the loop drawn so far; the dwell decays as it repeats. */
  private loopPasses = 0;

  constructor(private readonly runId: string) {}

  /**
   * How long one pass of the loop dwells, as a multiple of each stage's base
   * duration. The first turn is slow enough to read every stage in it; later
   * turns shorten, because they repeat the same computations and by then the
   * reader is watching the loss fall rather than the individual numbers. The
   * floor keeps even the thousandth pass visible.
   *
   * Loop events are deliberately NOT compressible. The shared player speeds
   * compressible events up when it falls behind a live stream, but a training
   * run's events all land in one burst, so compression would pin itself at its
   * maximum for the whole run and 1x, 2x and 4x would look identical.
   */
  private loopScale(): number {
    this.loopPasses += 1;
    return Math.max(0.22, 3.2 / (1 + (this.loopPasses - 1) * 0.55));
  }

  fromServer(ev: MLEvent): AnyMLEvent[] {
    switch (ev.type) {
      case "run_started":
        return [this.make("RUN_STARTED", "ingest", "started", "live", { config: ev.config, dataset: ev.dataset }, `${ev.dataset.name} · ${ev.dataset.rows} rows`, ev.at)];
      case "dataset_loaded":
        return [this.make("DATASET_LOADED", "ingest", "completed", "live", { dataset: ev.dataset, ms: ev.ms }, `${ev.dataset.rows} rows × ${ev.dataset.columns.length} columns loaded`, ev.at)];
      case "inspected":
        return [this.make("INSPECTED", "inspect", "completed", "live", { columns: ev.columns, targetCorrelations: ev.targetCorrelations }, `${ev.columns.length} columns inspected · ${ev.columns.reduce((s, c) => s + c.missing, 0)} missing cells`, ev.at)];
      case "identified":
        return [this.make("IDENTIFIED", "identify", "completed", "live", { features: ev.features, target: ev.target, task: ev.task, classes: ev.classes, reason: ev.reason }, `${ev.task} · target "${ev.target}" · ${ev.features.length} features`, ev.at)];
      case "cleaned":
        return [this.make("CLEANED", "clean", "completed", "live", { rowsBefore: ev.rowsBefore, rowsAfter: ev.rowsAfter, droppedRows: ev.droppedRows, droppedColumns: ev.droppedColumns }, `${ev.rowsAfter} rows kept · ${ev.droppedColumns.length} columns dropped`, ev.at)];
      case "imputed": {
        const filled = ev.reports.reduce((s, r) => s + r.filled, 0);
        return [this.make("IMPUTED", "missing", "completed", "live", { reports: ev.reports, rowsDropped: ev.rowsDropped }, ev.rowsDropped ? `${ev.rowsDropped} rows with gaps dropped` : filled ? `${filled} gaps filled in ${ev.reports.length} column${ev.reports.length === 1 ? "" : "s"}` : "no missing values", ev.at)];
      }
      case "encoded":
        return [this.make("ENCODED", "encode", "completed", "live", { reports: ev.reports, featureNames: ev.featureNames, targetEncoding: ev.targetEncoding }, `${ev.featureNames.length} numeric features`, ev.at)];
      case "scaled":
        return [this.make("SCALED", "scale", "completed", "live", { reports: ev.reports }, `${ev.reports[0]?.method ?? "no"} scaling · fitted on train`, ev.at)];
      case "engineered":
        return [this.make("ENGINEERED", "engineer", "completed", "live", { added: ev.added, method: ev.method, featureNames: ev.featureNames }, ev.added.length ? `${ev.added.length} features added` : "no engineered features", ev.at)];
      case "split":
        return [this.make("SPLIT", "split", "completed", "live", { report: ev.report, subsampled: ev.subsampled }, `${ev.report.train} / ${ev.report.validation} / ${ev.report.test} rows`, ev.at)];
      case "model_selected":
        return [this.make("MODEL_SELECTED", "selectModel", "completed", "live", { algorithm: ev.algorithm, task: ev.task, hyperparameters: ev.hyperparameters, family: ev.family, skippedStages: ev.skippedStages, skipReason: ev.skipReason }, `${ev.algorithm.replace(/_/g, " ")} · ${ev.task}`, ev.at)];
      case "model_initialized":
        return [this.make("MODEL_INITIALIZED", "init", "completed", "live", { params: ev.params, architecture: ev.architecture, seed: ev.seed, note: ev.note }, ev.architecture ? `${ev.architecture.layers.map((l) => l.units).join(" → ")} network · seed ${ev.seed}` : `initialized · seed ${ev.seed}`, ev.at)];
      case "train_step": {
        const s = ev.step;
        const scale = this.loopScale();
        const tag = `it ${s.iteration} · ep ${s.epoch}`;
        return [
          this.make("FORWARD", "forward", "completed", "live", { step: s }, `${tag} · forward on ${s.batchSize} rows`, ev.at, DURATION.FORWARD * scale),
          this.make("LOSS", "loss", "completed", "live", { step: s }, `${tag} · loss ${s.loss.value.toFixed(4)}`, ev.at, DURATION.LOSS * scale),
          this.make("GRADIENT", "gradient", "completed", "live", { step: s }, `${tag} · ‖∇‖ ${s.gradient.norm.toFixed(4)}${s.gradient.clipped ? " (clipped)" : ""}`, ev.at, DURATION.GRADIENT * scale),
          this.make("BACKPROP", "backprop", "completed", "live", { step: s }, `${tag} · ${s.backward.length} layer${s.backward.length === 1 ? "" : "s"} back`, ev.at, DURATION.BACKPROP * scale),
          this.make("UPDATE", "update", "completed", "live", { step: s }, `${tag} · ${s.update.optimizer} step ‖Δ‖ ${s.update.stepNorm.toFixed(4)}`, ev.at, DURATION.UPDATE * scale),
          this.make("ITERATE", "iterate", "completed", "live", { step: s, detailed: ev.detailed, stride: ev.stride }, `iteration ${s.iteration} of epoch ${s.epoch}`, ev.at, DURATION.ITERATE * scale),
        ];
      }
      case "tree_split": {
        const s = ev.step;
        const scale = this.loopScale();
        const out: AnyMLEvent[] = [];
        if (s.chosen) {
          out.push(this.make("FORWARD", "forward", "completed", "live", { step: asTrainStep(s) }, `node ${s.nodeId} · ${s.candidatesEvaluated} candidate splits scored`, ev.at, DURATION.FORWARD * scale));
          out.push(this.make("LOSS", "loss", "completed", "live", { step: asTrainStep(s) }, `node ${s.nodeId} · impurity ${s.impurityBefore.toFixed(3)} → ${s.chosen.impurityAfter.toFixed(3)}`, ev.at, DURATION.LOSS * scale));
          out.push(this.make("UPDATE", "update", "completed", "live", { step: asTrainStep(s) }, `split on ${s.chosen.feature} ≤ ${s.chosen.threshold}`, ev.at, DURATION.UPDATE * scale));
        }
        out.push(this.make("TREE_SPLIT", s.chosen ? "iterate" : "update", "completed", "live", { step: s }, s.chosen ? `node ${s.nodeId} → two children (${s.chosen.left} | ${s.chosen.right})` : `node ${s.nodeId} → leaf (${s.samples} rows)`, ev.at, DURATION.TREE_SPLIT * scale));
        return out;
      }
      case "tree_built":
        return [this.make("TREE_BUILT", "iterate", "completed", "live", { treeIndex: ev.treeIndex, nodes: ev.nodes, depth: ev.depth, leaves: ev.leaves, oobScore: ev.oobScore, ms: ev.ms, tree: ev.tree }, `tree ${ev.treeIndex + 1} · ${ev.nodes} nodes · depth ${ev.depth}${ev.oobScore !== null ? ` · OOB ${ev.oobScore.toFixed(3)}` : ""}`, ev.at, undefined, ev.treeIndex > 0)];
      case "knn_indexed":
        return [this.make("KNN_INDEXED", "init", "completed", "live", { stored: ev.stored, features: ev.features, k: ev.k }, `${ev.stored} rows stored · K = ${ev.k}`, ev.at)];
      case "knn_query": {
        const s = ev.step;
        const scale = this.loopScale();
        return [
          this.make("FORWARD", "forward", "completed", "live", { step: asTrainStep(s) }, `query ${s.queryIndex + 1} · ${s.neighbours.length} neighbours found`, ev.at, DURATION.KNN_QUERY * scale),
          this.make("KNN_QUERY", "iterate", "completed", "live", { step: s, detailed: ev.detailed }, `query ${s.queryIndex + 1} → ${s.prediction}${s.prediction === s.target ? " ✓" : ` (was ${s.target})`}`, ev.at, DURATION.ITERATE * scale),
        ];
      }
      case "nb_class_fitted":
        return [
          this.make("FORWARD", "forward", "completed", "live", { step: asTrainStep(ev.step) }, `class "${ev.step.className}" · ${ev.step.samples} rows`, ev.at, DURATION.FORWARD * 2),
          this.make("NB_CLASS_FITTED", "update", "completed", "live", { step: ev.step }, `prior ${ev.step.prior.toFixed(3)} · ${ev.step.featureStats.length} feature Gaussians`, ev.at),
        ];
      case "epoch_completed":
        return [this.make("EPOCH_COMPLETED", "epoch", "completed", "live", { report: ev.report }, `epoch ${ev.report.epoch} · train ${ev.report.trainLoss.toFixed(4)}${ev.report.validationMetric ? ` · val ${ev.report.validationMetric.name} ${ev.report.validationMetric.value.toFixed(3)}` : ""}${ev.report.bestSoFar ? " ★" : ""}`, ev.at)];
      case "validated":
        return [this.make("VALIDATED", "validate", "completed", "live", { metrics: ev.metrics, predictionsSample: ev.predictionsSample }, metricLabel(ev.metrics), ev.at)];
      case "candidate_started":
        return [this.make("CANDIDATE_STARTED", "hyperparams", "progress", "live", { candidate: ev.candidate }, `training ${ev.candidate.parameter} = ${ev.candidate.value}`, ev.at)];
      case "candidate_finished":
        return [this.make("CANDIDATE_FINISHED", "hyperparams", "progress", "live", { result: ev.result }, `${ev.result.parameter} = ${ev.result.value} → ${ev.result.validationMetric.name} ${ev.result.validationMetric.value.toFixed(3)}`, ev.at)];
      case "hyperparameters_evaluated":
        return [this.make("HYPERPARAMETERS_EVALUATED", "hyperparams", "completed", "live", { candidates: ev.candidates, checkpoints: ev.checkpoints, metricName: ev.metricName, higherIsBetter: ev.higherIsBetter }, ev.candidates.length ? `${ev.candidates.length} candidates compared on ${ev.metricName}` : ev.checkpoints ? `${ev.checkpoints.length} epochs compared as checkpoints` : "single configuration", ev.at)];
      case "best_selected":
        return [this.make("BEST_SELECTED", "selectBest", "completed", "live", { choice: ev.choice, reason: ev.reason, retrained: ev.retrained }, ev.choice, ev.at)];
      case "tested":
        return [this.make("TESTED", "test", "completed", "live", { metrics: ev.metrics, predictions: ev.predictions }, `test · ${metricLabel(ev.metrics)}`, ev.at)];
      case "evaluated":
        return [this.make("EVALUATED", "evaluate", "completed", ev.surface?.source === "simulation" ? "simulation" : "live", { importance: ev.importance, surface: ev.surface, lossCurve: ev.lossCurve }, `${ev.importance ? `${ev.importance.method} importance` : "no importance"}${ev.surface ? ` · ${ev.surface.source === "live" ? "exact" : "2-D slice of the"} decision surface` : ""}`, ev.at)];
      case "model_saved":
        return [this.make("MODEL_SAVED", "save", "completed", "live", { modelId: ev.modelId, bytes: ev.bytes, params: ev.params, tree: ev.tree, forest: ev.forest, architecture: ev.architecture }, `${ev.params.count.toLocaleString()} parameters · ${(ev.bytes / 1024).toFixed(1)} KB`, ev.at)];
      case "run_completed":
        return [this.make("RUN_COMPLETED", "save", "info", "live", { totalMs: ev.totalMs, iterations: ev.iterations, epochs: ev.epochs }, `Run completed in ${(ev.totalMs / 1000).toFixed(1)} s`, ev.at)];
      case "notice":
        return [this.make("NOTICE", this.lastStage, "info", "live", { level: ev.level, message: ev.message }, ev.message, ev.at)];
      case "error":
        return [this.make("EXECUTION_ERROR", this.lastStage, "error", "live", { message: ev.message, retryable: ev.retryable }, "Error", ev.at)];
    }
  }

  /** A prediction made after training: the input goes through preprocessing, then the model answers. */
  fromPrediction(input: Record<string, string | number | boolean | null>, trace: PredictionTrace): AnyMLEvent[] {
    return [
      this.make("INFERRED", "infer", "completed", "live", { input, trace }, `${trace.encoded.length} inputs encoded and scaled`, Date.now()),
      this.make("PREDICTED", "predict", "completed", "live", { trace }, `→ ${trace.label}${trace.probabilities ? ` · ${(Math.max(...trace.probabilities) * 100).toFixed(0)}%` : ""} · ${trace.ms} ms`, Date.now()),
    ];
  }

  stopped(): AnyMLEvent[] {
    return [this.make("EXECUTION_STOPPED", this.lastStage, "info", "live", {}, "Stopped", Date.now())];
  }

  failed(message: string): AnyMLEvent[] {
    return [this.make("EXECUTION_ERROR", this.lastStage, "error", "live", { message, retryable: false }, "Error", Date.now())];
  }

  private make<T extends MLEventType>(type: T, stage: MLStageId, status: EventStatus, source: DataSource, data: MLEventDataMap[T], label: string, timestamp = Date.now(), duration = DURATION[type], compressible = false): MLLabEvent<T> {
    if (status !== "info") this.lastStage = stage;
    const seq = this.seq++;
    return { id: `${this.runId}:${seq}`, seq, type, timestamp, stage, status, source, duration: Math.round(duration * PACE), compressible, label: label || ML_STAGES[stage].label, data };
  }
}

function metricLabel(m: Metrics): string {
  return m.task === "classification" ? `accuracy ${(m.accuracy * 100).toFixed(1)}% · F1 ${m.f1Macro.toFixed(3)}` : `RMSE ${m.rmse.toFixed(3)} · R² ${m.r2.toFixed(3)}`;
}

/**
 * Tree splits, neighbour searches and Naive Bayes fits reuse the loop's forward
 * and loss stages. The FORWARD/LOSS/UPDATE data slots expect a TrainStep, so a
 * minimal one is built from what the algorithm actually reported; the reducer
 * reads the algorithm-specific event that follows for the real detail.
 */
interface StepLike {
  ms?: number;
  nodeId?: number;
  queryIndex?: number;
  classIndex?: number;
  samples?: number;
  impurityBefore?: number;
}

function asTrainStep(s: StepLike): MLEventDataMap["FORWARD"]["step"] {
  const iteration = typeof s.nodeId === "number" ? s.nodeId + 1 : typeof s.queryIndex === "number" ? s.queryIndex + 1 : typeof s.classIndex === "number" ? s.classIndex + 1 : 0;
  const loss = typeof s.impurityBefore === "number" ? s.impurityBefore : 0;
  return {
    iteration,
    epoch: 1,
    batch: iteration,
    batchesPerEpoch: 0,
    batchSize: typeof s.samples === "number" ? s.samples : 1,
    forward: { indices: [], predictions: [], targets: [] },
    loss: { value: loss, dataTerm: loss, regularizationTerm: 0, kind: typeof s.impurityBefore === "number" ? "impurity" : "none" },
    gradient: { norm: 0, groups: [], clipped: false },
    backward: [],
    update: { optimizer: "sgd", learningRate: 0, stepNorm: 0, params: { count: 0, norm: 0, groups: [] } },
    ms: s.ms ?? 0,
  };
}
