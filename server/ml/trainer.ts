import type { Algorithm, CandidateResult, DecisionSurface, FeatureImportance, Hyperparameters, Metrics, MLConfig, MLConfigInput, MLEvent, MLTask, PredictionTrace, SavedModelInfo } from "@shared/ml";
import { ALGORITHMS, DEFAULT_HYPERPARAMETERS, DEFAULT_ML_CONFIG, ML_LIMITS } from "../../shared/ml";
import { correlation, isMissing, toNumber, type RawTable } from "./data";
import { better, classificationMetrics, headline, regressionMetrics } from "./metrics";
import { initialParams, skippedStages, trainModel, type FittedModel, type TrainContext } from "./models";
import { applyScaler, clean, encode, encodeRow, engineer, fitScaler, identify, impute, scaleReports, split, splitReport, type Encoder, type Imputer, type Scaler } from "./preprocess";
import { Rng } from "./random";

const now = () => Date.now();

/** Everything needed to push a fresh row through the same path the training rows took. */
export interface Preprocessor {
  columns: string[];
  featureNames: string[];
  imputers: Imputer[];
  encoders: Encoder[];
  engineered: { added: string[]; numericMask: boolean[] } | null;
  scaler: Scaler;
  task: MLTask;
  classes: string[] | null;
  target: string;
}

export interface SavedModel {
  info: SavedModelInfo;
  model: FittedModel;
  preprocessor: Preprocessor;
  json: unknown;
}

export interface TrainerDeps {
  runId: string;
  datasetId: string;
  datasetName: string;
  table: RawTable;
  config: MLConfig;
  emit: (e: MLEvent) => void;
  signal: AbortSignal;
}

export interface TrainerOutcome {
  saved: SavedModel | null;
  metrics: Metrics | null;
  iterations: number;
  epochs: number;
  totalMs: number;
}

/** Clamps a partial config from the browser into something the trainer can run. */
export function sanitizeMLConfig(partial: MLConfigInput | undefined): MLConfig {
  const p = partial ?? {};
  const hp = { ...DEFAULT_HYPERPARAMETERS, ...(p.hyperparameters ?? {}) };
  const algorithm = ALGORITHMS.some((a) => a.id === p.algorithm) ? (p.algorithm as Algorithm) : DEFAULT_ML_CONFIG.algorithm;
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const sweepParam = p.sweep && typeof p.sweep === "object" && typeof p.sweep.parameter === "string" && p.sweep.parameter in DEFAULT_HYPERPARAMETERS ? p.sweep.parameter : null;
  const sweepValues = sweepParam && Array.isArray(p.sweep!.values) ? p.sweep!.values.map(Number).filter(Number.isFinite).slice(0, ML_LIMITS.maxSweepValues) : [];
  return {
    algorithm,
    target: typeof p.target === "string" && p.target ? p.target : null,
    excluded: Array.isArray(p.excluded) ? p.excluded.filter((x): x is string => typeof x === "string").slice(0, 64) : [],
    impute: (["median", "mean", "mode", "drop"] as const).includes(p.impute as never) ? p.impute! : "median",
    scaling: (["standard", "minmax", "none"] as const).includes(p.scaling as never) ? p.scaling! : "standard",
    polynomialFeatures: Boolean(p.polynomialFeatures),
    trainFraction: num(p.trainFraction, 0.4, 0.9, 0.7),
    validationFraction: num(p.validationFraction, 0.05, 0.4, 0.15),
    stratify: p.stratify === undefined ? true : Boolean(p.stratify),
    seed: Math.round(num(p.seed, 0, 1e9, 42)),
    hyperparameters: {
      learningRate: num(hp.learningRate, 1e-5, 2, 0.05),
      epochs: Math.round(num(hp.epochs, 1, ML_LIMITS.maxEpochs, 30)),
      batchSize: Math.round(num(hp.batchSize, 1, 512, 16)),
      optimizer: (["sgd", "momentum", "adam"] as const).includes(hp.optimizer) ? hp.optimizer : "adam",
      regularization: (["none", "l2", "l1"] as const).includes(hp.regularization) ? hp.regularization : "none",
      regularizationStrength: num(hp.regularizationStrength, 0, 1, 0.001),
      hiddenLayers: (Array.isArray(hp.hiddenLayers) ? hp.hiddenLayers : [8]).map((w) => Math.round(num(w, 1, ML_LIMITS.maxHiddenWidth, 8))).slice(0, ML_LIMITS.maxHiddenLayers),
      activation: (["relu", "tanh", "sigmoid"] as const).includes(hp.activation) ? hp.activation : "relu",
      maxDepth: Math.round(num(hp.maxDepth, 1, ML_LIMITS.maxDepth, 4)),
      minSamplesLeaf: Math.round(num(hp.minSamplesLeaf, 1, 50, 2)),
      trees: Math.round(num(hp.trees, 1, ML_LIMITS.maxTrees, 12)),
      k: Math.round(num(hp.k, 1, 50, 5)),
      svmC: num(hp.svmC, 0.001, 100, 1),
    },
    sweep: sweepParam && sweepValues.length >= 2 ? { parameter: sweepParam, values: sweepValues } : null,
  };
}

/**
 * Runs the whole pipeline once: preprocessing with a report per stage, training
 * with a step per computation, validation, an optional sweep, testing,
 * evaluation and saving. Emits as it goes; nothing is emitted before it happened.
 */
export async function runTraining(deps: TrainerDeps): Promise<TrainerOutcome> {
  const { config, emit, signal, table } = deps;
  const startedAt = now();
  const tick = () =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      setImmediate(resolve);
    });

  emit({ type: "run_started", at: now(), runId: deps.runId, config, dataset: { id: deps.datasetId, name: deps.datasetName, rows: table.rows.length, columns: table.columns.length } });

  /* ── data ── */
  const t0 = now();
  const id = identify(table, config);
  emit({ type: "dataset_loaded", at: now(), dataset: { id: deps.datasetId, name: deps.datasetName, origin: "upload", format: "csv", rows: table.rows.length, columns: id.columns, sampleRows: table.rows.slice(0, 12), bytes: 0, addedAt: startedAt, note: "" }, ms: now() - t0 });
  const tIdx = table.columns.indexOf(id.target);
  const targetNumeric = table.rows.map((r) => toNumber(r[tIdx] ?? "") ?? (id.classes ? id.classes.indexOf(r[tIdx] ?? "") : 0));
  const correlations = id.features
    .map((f) => {
      const col = id.columns.find((c) => c.name === f)!;
      if (col.type !== "numeric" && col.type !== "boolean") return null;
      const fi = table.columns.indexOf(f);
      const pairs = table.rows.map((r, i) => [toNumber(r[fi] ?? "") ?? (col.type === "boolean" ? (/^(true|yes|y|t|1)$/i.test(r[fi] ?? "") ? 1 : 0) : NaN), targetNumeric[i]!] as const).filter(([a]) => !Number.isNaN(a));
      return { feature: f, correlation: Math.round(correlation(pairs.map((p) => p[0]), pairs.map((p) => p[1])) * 1000) / 1000 };
    })
    .filter((x): x is { feature: string; correlation: number } => x !== null);
  emit({ type: "inspected", at: now(), columns: id.columns, targetCorrelations: correlations.length ? correlations : null });
  await tick();
  emit({ type: "identified", at: now(), features: id.features, target: id.target, task: id.task, classes: id.classes, reason: id.reason });

  const cleaned = clean(table, id);
  emit({ type: "cleaned", at: now(), rowsBefore: cleaned.rowsBefore, rowsAfter: cleaned.table.rows.length, droppedRows: cleaned.droppedRows, droppedColumns: cleaned.droppedColumns });
  if (cleaned.table.rows.length < 10) throw new Error(`Only ${cleaned.table.rows.length} usable rows remain after cleaning; at least 10 are needed.`);

  const imputed = impute(cleaned.table, id, config.impute);
  emit({ type: "imputed", at: now(), reports: imputed.reports, rowsDropped: imputed.rowsDropped });
  await tick();

  const encoded = encode(imputed.table, id);
  emit({ type: "encoded", at: now(), reports: encoded.reports, featureNames: encoded.featureNames, targetEncoding: encoded.targetEncoding });

  // Subsample very large tables so training stays interactive; the notice says so.
  let X = encoded.X;
  let y = encoded.y;
  let subsampled: { from: number; to: number } | null = null;
  if (X.length > ML_LIMITS.maxTrainRows) {
    const rng = new Rng(config.seed);
    const keep = rng.shuffle(Array.from({ length: X.length }, (_, i) => i)).slice(0, ML_LIMITS.maxTrainRows);
    subsampled = { from: X.length, to: keep.length };
    X = keep.map((i) => X[i]!);
    y = keep.map((i) => y[i]!);
    emit({ type: "notice", at: now(), level: "warn", message: `${subsampled.from.toLocaleString()} rows were subsampled to ${subsampled.to.toLocaleString()} so training stays responsive.` });
  }

  const sp = split(y, config, id.task);
  const scaler = fitScaler(sp.train.map((i) => X[i]!), config.scaling);
  emit({ type: "scaled", at: now(), reports: scaleReports(scaler, encoded.featureNames), fittedOn: "train" });
  let Xs = X.map((r) => applyScaler(r, scaler));
  let featureNames = encoded.featureNames;
  let engineered: Preprocessor["engineered"] = null;
  if (config.polynomialFeatures) {
    const numericMask = encoded.encoders.flatMap((e) => e.produced.map(() => e.method === "passthrough"));
    const eng = engineer(featureNames, numericMask);
    Xs = Xs.map(eng.expand);
    featureNames = eng.names;
    engineered = { added: eng.added, numericMask };
    emit({ type: "engineered", at: now(), added: eng.added, method: "squares of every numeric feature and pairwise products of the first three, computed after scaling", featureNames });
  } else emit({ type: "engineered", at: now(), added: [], method: "off: the features are used as encoded and scaled", featureNames });
  emit({ type: "split", at: now(), report: splitReport(sp, Xs, y, config, id.classes), subsampled });
  await tick();

  const Xtrain = sp.train.map((i) => Xs[i]!);
  const ytrain = sp.train.map((i) => y[i]!);
  const Xval = sp.validation.map((i) => Xs[i]!);
  const yval = sp.validation.map((i) => y[i]!);
  const Xtest = sp.test.map((i) => Xs[i]!);
  const ytest = sp.test.map((i) => y[i]!);

  /* ── model ── */
  const algo = ALGORITHMS.find((a) => a.id === config.algorithm)!;
  if (!algo.tasks.includes(id.task)) throw new Error(`${algo.name} handles ${algo.tasks.join(" and ")}, but this target makes a ${id.task} problem. Pick another algorithm or another target.`);
  const skipped = skippedStages(config.algorithm);
  emit({ type: "model_selected", at: now(), algorithm: config.algorithm, task: id.task, hyperparameters: config.hyperparameters, family: algo.family, skippedStages: skipped.stages, skipReason: skipped.reason });

  const stepsTotal = algo.family === "gradient" ? config.hyperparameters.epochs * Math.ceil(Xtrain.length / Math.max(1, Math.min(config.hyperparameters.batchSize, Xtrain.length))) : 1;
  const stride = Math.max(1, Math.ceil(stepsTotal / ML_LIMITS.maxDetailedSteps));
  if (stride > 1) emit({ type: "notice", at: now(), level: "info", message: `${stepsTotal.toLocaleString()} training steps will run; every ${stride}th is drawn in detail so playback stays watchable. Every step is still computed.` });

  // Gradient descent on a target in the hundreds or thousands would need thousands of
  // steps just to move the bias, so the target is standardized for training and
  // predictions are mapped back. Metrics are always in the original units.
  const targetScale = algo.family === "gradient" && id.task === "regression" ? fitTargetScale(ytrain) : null;
  if (targetScale) emit({ type: "notice", at: now(), level: "info", message: `The target "${id.target}" was standardized for gradient training (mean ${round(targetScale.mean, 3)}, std ${round(targetScale.std, 3)}). Step losses and step predictions are in those units; every metric is in the original units.` });
  const scaleY = (ys: number[]) => (targetScale ? ys.map((v) => (v - targetScale.mean) / targetScale.std) : ys);
  const context = (hp: Hyperparameters, quiet: boolean): TrainContext => ({ algorithm: config.algorithm, task: id.task, classes: id.classes, featureNames, Xtrain, ytrain: scaleY(ytrain), Xval, yval: scaleY(yval), hp, seed: config.seed, emit, quiet, signal, tick, stride });
  const trainMain = async (ctx: TrainContext) => {
    const r = await trainMainRaw(ctx, emit, id.task, id.classes, config);
    return targetScale ? { ...r, model: new TargetScaledModel(r.model, targetScale.mean, targetScale.std) } : r;
  };

  const main = await trainMain(context(config.hyperparameters, false));
  let chosen = main;
  let chosenLabel = "the configuration you set";

  /* ── validation & sweep ── */
  const valMetrics = evaluateModel(main.model, Xval, yval, id.task, id.classes);
  emit({ type: "validated", at: now(), metrics: valMetrics, predictionsSample: sample(main.model, Xval, yval, sp.validation, 8) });
  const hl = headline(valMetrics);
  const candidates: CandidateResult[] = [];
  if (config.sweep) {
    const param = config.sweep.parameter;
    const baseValue = config.hyperparameters[param];
    const values = [...new Set([typeof baseValue === "number" ? baseValue : 0, ...config.sweep.values])].slice(0, ML_LIMITS.maxSweepValues + 1);
    const results: { value: number; result: Awaited<ReturnType<typeof trainMain>>; metric: number; ms: number }[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      const isBase = value === baseValue;
      const t = now();
      emit({ type: "candidate_started", at: now(), candidate: { index: i, parameter: param, value } });
      const result = isBase ? main : await trainMain(context({ ...config.hyperparameters, [param]: value } as Hyperparameters, true));
      const metric = headline(evaluateModel(result.model, Xval, yval, id.task, id.classes)).value;
      results.push({ value, result, metric, ms: now() - t });
      const cr: CandidateResult = { index: i, parameter: param, value, validationMetric: { name: hl.name, value: round(metric) }, trainLoss: result.epochs.at(-1)?.trainLoss ?? null, ms: now() - t, best: false };
      candidates.push(cr);
      emit({ type: "candidate_finished", at: now(), result: cr });
      await tick();
    }
    let bestIdx = 0;
    for (let i = 1; i < results.length; i++) if (better(results[i]!.metric, results[bestIdx]!.metric, hl.higherIsBetter)) bestIdx = i;
    candidates[bestIdx]!.best = true;
    chosen = results[bestIdx]!.result;
    chosenLabel = `${param} = ${results[bestIdx]!.value}`;
  }
  const checkpoints = main.epochs.length ? main.epochs.map((e) => ({ epoch: e.epoch, validationMetric: e.validationMetric?.value ?? 0 })) : null;
  emit({ type: "hyperparameters_evaluated", at: now(), candidates, checkpoints, metricName: hl.name, higherIsBetter: hl.higherIsBetter });
  const bestEpoch = main.epochs.filter((e) => e.bestSoFar).at(-1)?.epoch;
  emit({
    type: "best_selected",
    at: now(),
    choice: chosenLabel,
    reason: config.sweep ? `Of ${candidates.length} candidates trained on the same split, ${chosenLabel} scored best on validation ${hl.name} (${hl.higherIsBetter ? "higher" : "lower"} is better).` : bestEpoch !== undefined && main.epochs.length > 1 ? `No sweep was configured. Within the run, the parameters from epoch ${bestEpoch} had the best validation ${hl.name} and were kept (checkpoint selection).` : "No sweep was configured and the algorithm trains in one pass, so the fitted model is used as is.",
    retrained: false,
  });

  /* ── test & evaluate ── */
  const testMetrics = evaluateModel(chosen.model, Xtest, ytest, id.task, id.classes);
  emit({ type: "tested", at: now(), metrics: testMetrics, predictions: sample(chosen.model, Xtest, ytest, sp.test, 60) });
  const importance = featureImportance(chosen.model, Xval, yval, featureNames, id.task, id.classes, config.seed);
  const surface = decisionSurface(chosen.model, Xs, y, sp, featureNames, importance);
  emit({ type: "evaluated", at: now(), importance, surface, lossCurve: chosen.lossCurve });
  await tick();

  /* ── save ── */
  const preprocessor: Preprocessor = { columns: cleaned.table.columns, featureNames, imputers: imputed.imputers, encoders: encoded.encoders, engineered, scaler, task: id.task, classes: id.classes, target: id.target };
  const json = { model: chosen.model.toJSON(), preprocessor };
  const bytes = Buffer.byteLength(JSON.stringify(json));
  const modelId = `model-${deps.runId}`;
  const desc = chosen.model.describe();
  const info: SavedModelInfo = {
    modelId,
    runId: deps.runId,
    algorithm: config.algorithm,
    task: id.task,
    datasetName: deps.datasetName,
    features: featureNames,
    target: id.target,
    classes: id.classes,
    inputs: id.features.map((name) => {
      const col = id.columns.find((c) => c.name === name)!;
      const enc = encoded.encoders.find((e) => e.column === name);
      // A median can land on a float artifact (36.495000000000005); the form
      // prefills this value, so round it to something a person would type.
      return { name, type: col.type, categories: enc?.categories, example: col.type === "numeric" ? round(col.stats?.median ?? 0, 4) : col.examples[0] ?? "" };
    }),
    metrics: testMetrics,
    savedAt: now(),
  };
  emit({ type: "model_saved", at: now(), modelId, bytes, params: chosen.model.params(), tree: desc.tree ?? null, forest: desc.forest ?? null, architecture: desc.architecture ?? null });
  const totalMs = now() - startedAt;
  emit({ type: "run_completed", at: now(), totalMs, iterations: chosen.iterations, epochs: chosen.epochs.length });
  return { saved: { info, model: chosen.model, preprocessor, json }, metrics: testMetrics, iterations: chosen.iterations, epochs: chosen.epochs.length, totalMs };
}

async function trainMainRaw(ctx: TrainContext, emit: TrainerDeps["emit"], task: MLTask, classes: string[] | null, config: MLConfig) {
  if (!ctx.quiet) {
    const seedNote = ALGORITHMS.find((a) => a.id === ctx.algorithm)!.family === "gradient" ? `Weights drawn from a scaled normal distribution with seed ${config.seed}; biases start at zero.` : ctx.algorithm === "knn" ? "Nothing to initialize: the model is the training set." : ctx.algorithm === "naive_bayes" ? "Nothing to initialize: statistics are computed in one pass." : `An empty root node holding all ${ctx.Xtrain.length} training rows.`;
    // Gradient models start from real seeded weights; the other families start empty.
    const params = initialParams(ctx);
    emit({ type: "model_initialized", at: now(), params, architecture: ctx.algorithm === "neural_network" ? { layers: [{ name: "input", units: ctx.featureNames.length, activation: "linear" }, ...ctx.hp.hiddenLayers.map((u, i) => ({ name: `hidden ${i + 1}`, units: u, activation: ctx.hp.activation })), { name: "output", units: task === "regression" ? 1 : classes!.length, activation: task === "regression" ? ("linear" as const) : ("softmax" as const) }], paramCount: params.count } : null, seed: config.seed, note: seedNote });
  }
  return trainModel(ctx);
}

export function evaluateModel(model: FittedModel, X: number[][], y: number[], task: MLTask, classes: string[] | null): Metrics {
  if (task === "regression") return regressionMetrics(model.predict(X), y);
  const proba = model.predictProba?.(X) ?? null;
  const scores = proba ? null : model.scores?.(X) ?? null;
  return classificationMetrics(model.predict(X), y, classes!, proba, scores);
}

function sample(model: FittedModel, X: number[][], y: number[], indices: number[], n: number) {
  const pred = model.predict(X.slice(0, n));
  const proba = model.predictProba?.(X.slice(0, n));
  return pred.map((p, i) => ({ index: indices[i]!, predicted: round(p), target: y[i]!, probabilities: proba?.[i]?.map((v) => round(v)) }));
}

/** Native importance when the algorithm has one; otherwise permutation importance measured on validation rows. */
export function featureImportance(model: FittedModel, Xval: number[][], yval: number[], featureNames: string[], task: MLTask, classes: string[] | null, seed: number): FeatureImportance | null {
  const native = model.importance?.(featureNames);
  if (native) return { ...native, source: "live", note: native.method === "coefficients" ? "Mean absolute weight per feature, on the scaled inputs, normalised to sum to 1. Real fitted coefficients." : "Total impurity decrease credited to each feature across the splits that used it, normalised. Real split statistics." };
  if (Xval.length < 5) return null;
  const rng = new Rng(seed);
  const base = headline(evaluateModel(model, Xval, yval, task, classes));
  const values = featureNames.map((feature, j) => {
    const perm = rng.shuffle(Xval.map((r) => r[j]!));
    const Xp = Xval.map((r, i) => {
      const c = r.slice();
      c[j] = perm[i]!;
      return c;
    });
    const m = headline(evaluateModel(model, Xp, yval, task, classes)).value;
    return { feature, importance: base.higherIsBetter ? base.value - m : m - base.value };
  });
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v.importance)));
  return { method: "permutation", source: "live", note: `Drop in validation ${base.name} when each feature's values are shuffled, scaled to the largest drop. Real re-predictions on the validation rows.`, values: values.map((v) => ({ feature: v.feature, importance: round(v.importance / max) })).sort((a, b) => b.importance - a.importance) };
}

/** Predictions over a grid of the two most important features, other features held at 0 (their scaled mean). */
export function decisionSurface(model: FittedModel, Xs: number[][], y: number[], sp: { train: number[]; validation: number[]; test: number[] }, featureNames: string[], importance: FeatureImportance | null): DecisionSurface | null {
  const d = featureNames.length;
  if (d < 2) return null;
  const order = importance ? importance.values.map((v) => featureNames.indexOf(v.feature)).filter((i) => i >= 0) : [];
  const xi = order[0] ?? 0;
  const yi = order[1] ?? (xi === 0 ? 1 : 0);
  const col = (i: number) => Xs.map((r) => r[i]!);
  const pad = (v: number[]) => {
    const mn = Math.min(...v);
    const mx = Math.max(...v);
    const p = (mx - mn || 1) * 0.08;
    return [mn - p, mx + p];
  };
  const [x0, x1] = pad(col(xi)) as [number, number];
  const [y0, y1] = pad(col(yi)) as [number, number];
  const N = 36;
  const xs = Array.from({ length: N }, (_, i) => round(x0 + ((x1 - x0) * i) / (N - 1)));
  const ys = Array.from({ length: N }, (_, i) => round(y0 + ((y1 - y0) * i) / (N - 1)));
  const grid: number[][] = [];
  for (const yv of ys) for (const xv of xs) {
    const row = new Array<number>(d).fill(0);
    row[xi] = xv;
    row[yi] = yv;
    grid.push(row);
  }
  const values = model.predict(grid).map((v) => round(v));
  const pred = model.predict(Xs);
  const mark = (idx: number[], split: "train" | "validation" | "test") => idx.slice(0, 120).map((i) => ({ x: round(Xs[i]![xi]!), y: round(Xs[i]![yi]!), target: y[i]!, predicted: round(pred[i]!), split }));
  const exact = d === 2;
  return {
    xFeature: featureNames[xi]!,
    yFeature: featureNames[yi]!,
    xs,
    ys,
    values,
    source: exact ? "live" : "simulation",
    note: exact ? "Exact: the model has exactly these two features, so every grid point is a real prediction in the model's own input space." : `Simplified: the model has ${d} features. The grid varies only ${featureNames[xi]} and ${featureNames[yi]} and holds the other ${d - 2} at their mean, so this is a 2-D slice through a ${d}-D decision function, not the whole picture. The plotted points are real rows and real predictions.`,
    points: [...mark(sp.train, "train"), ...mark(sp.validation, "validation"), ...mark(sp.test, "test")],
  };
}

/** Pushes a raw input through imputation, encoding, engineering and scaling, then asks the model. */
export function predictWithTrace(saved: SavedModel, input: Record<string, string | number | boolean | null>): PredictionTrace {
  const start = now();
  const pre = saved.preprocessor;
  const row = pre.columns.map((c) => {
    if (c === pre.target) return "";
    const v = input[c];
    let s = v === null || v === undefined ? "" : String(v);
    if (isMissing(s)) {
      const imp = pre.imputers.find((i) => i.column === c);
      if (imp && imp.fill !== null) s = String(imp.fill);
    }
    return s;
  });
  const encodedVec = encodeRow(row, pre.columns, pre.encoders);
  const baseNames = pre.encoders.flatMap((e) => e.produced);
  let scaled = applyScaler(encodedVec, pre.scaler);
  if (pre.engineered) scaled = engineer(baseNames, pre.engineered.numericMask).expand(scaled);
  const t = saved.model.trace(scaled);
  const prediction = t.prediction ?? 0;
  const label = pre.task === "classification" ? pre.classes![Math.round(prediction)] ?? String(prediction) : String(round(prediction));
  return { modelId: saved.info.modelId, algorithm: saved.info.algorithm, task: pre.task, encoded: baseNames.map((feature, i) => ({ feature, value: round(encodedVec[i]!) })), scaled: scaled.map((v) => round(v)), layers: t.layers, path: t.path, neighbours: t.neighbours, classScores: t.classScores, probabilities: t.probabilities ?? null, prediction: round(prediction), label, ms: now() - start };
}

function round(v: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function fitTargetScale(y: number[]): { mean: number; std: number } {
  const mean = y.reduce((s, v) => s + v, 0) / Math.max(1, y.length);
  const std = Math.sqrt(y.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, y.length)) || 1;
  return { mean, std };
}

/** A regression model trained on a standardized target, answering in the original units. */
class TargetScaledModel implements FittedModel {
  readonly algorithm: Algorithm;
  readonly task: MLTask;
  constructor(private readonly inner: FittedModel, private readonly mean: number, private readonly std: number) {
    this.algorithm = inner.algorithm;
    this.task = inner.task;
  }
  predict(X: number[][]): number[] {
    return this.inner.predict(X).map((v) => v * this.std + this.mean);
  }
  params() {
    return this.inner.params();
  }
  describe() {
    return this.inner.describe();
  }
  importance(featureNames: string[]) {
    return this.inner.importance?.(featureNames) ?? null;
  }
  trace(x: number[]): Partial<PredictionTrace> {
    const t = this.inner.trace(x);
    return { ...t, prediction: (t.prediction ?? 0) * this.std + this.mean };
  }
  toJSON() {
    return { ...(this.inner.toJSON() as object), targetScale: { mean: this.mean, std: this.std } };
  }
}
