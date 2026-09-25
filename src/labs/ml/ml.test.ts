import { describe, expect, it } from "vitest";
import type { MLEvent, TrainStep } from "@shared/ml";
import { DEFAULT_ML_CONFIG, ML_LIMITS } from "@shared/ml";
import { ML_CONNECTIONS, ML_NODES, ML_NODE_ORDER } from "./layout";
import { applyMLEvent } from "./reducer";
import { MLEventSequencer } from "./sequencer";
import { ML_STAGE_IDS } from "./stages";
import { createMLVisualState, type MLVisualState } from "./state";

const step = (iteration: number, epoch: number, loss: number): TrainStep => ({
  iteration,
  epoch,
  batch: iteration,
  batchesPerEpoch: 4,
  batchSize: 16,
  forward: { indices: [0, 1], predictions: [[0.3, 0.7]], targets: [1] },
  loss: { value: loss, dataTerm: loss, regularizationTerm: 0, kind: "cross-entropy" },
  gradient: { norm: 0.5, groups: [{ name: "weights W", norm: 0.5, values: [0.1], truncated: false }], clipped: false },
  backward: [{ layer: "weights", gradNorm: 0.5, deltaNorm: 0.2 }],
  update: { optimizer: "adam", learningRate: 0.05, stepNorm: 0.01, params: { count: 15, norm: 1, groups: [{ name: "weights W", shape: [4, 3], values: [0.1, 0.2], truncated: false, norm: 1 }] } },
  ms: 2,
});

const metrics = { task: "classification" as const, accuracy: 0.9, precisionMacro: 0.9, recallMacro: 0.9, f1Macro: 0.9, logLoss: 0.3, confusion: { classes: ["a", "b"], matrix: [[5, 1], [0, 4]] }, roc: null, pr: null, n: 10 };

function script(): MLEvent[] {
  const t = 1000;
  return [
    { type: "run_started", at: t, runId: "r", config: DEFAULT_ML_CONFIG, dataset: { id: "d", name: "flowers", rows: 100, columns: 5 } },
    { type: "dataset_loaded", at: t + 1, dataset: { id: "d", name: "flowers", origin: "sample", format: "csv", rows: 100, columns: [], sampleRows: [], bytes: 10, addedAt: t, note: "" }, ms: 1 },
    { type: "inspected", at: t + 2, columns: [], targetCorrelations: null },
    { type: "identified", at: t + 3, features: ["a", "b"], target: "y", task: "classification", classes: ["a", "b"], reason: "r" },
    { type: "cleaned", at: t + 4, rowsBefore: 100, rowsAfter: 98, droppedRows: { emptyTarget: 1, duplicates: 1 }, droppedColumns: [] },
    { type: "imputed", at: t + 5, reports: [], rowsDropped: 0 },
    { type: "encoded", at: t + 6, reports: [], featureNames: ["a", "b"], targetEncoding: { method: "label", classes: ["a", "b"] } },
    { type: "scaled", at: t + 7, reports: [{ feature: "a", method: "standard", mean: 0, std: 1 }], fittedOn: "train" },
    { type: "engineered", at: t + 8, added: [], method: "off", featureNames: ["a", "b"] },
    { type: "split", at: t + 9, report: { train: 70, validation: 14, test: 14, stratified: true, seed: 42, samples: [] }, subsampled: null },
    { type: "model_selected", at: t + 10, algorithm: "logistic_regression", task: "classification", hyperparameters: DEFAULT_ML_CONFIG.hyperparameters, family: "gradient", skippedStages: [], skipReason: null },
    { type: "model_initialized", at: t + 11, params: { count: 15, norm: 0.4, groups: [] }, architecture: null, seed: 42, note: "n" },
    { type: "train_step", at: t + 20, step: step(1, 1, 1.2), detailed: true, stride: 1 },
    { type: "train_step", at: t + 30, step: step(2, 1, 0.9), detailed: true, stride: 1 },
    { type: "epoch_completed", at: t + 40, report: { epoch: 1, trainLoss: 1.05, validationLoss: 0.8, validationMetric: { name: "accuracy", value: 0.8 }, ms: 20, bestSoFar: true } },
    { type: "validated", at: t + 50, metrics, predictionsSample: [] },
    { type: "hyperparameters_evaluated", at: t + 51, candidates: [], checkpoints: [{ epoch: 1, validationMetric: 0.8 }], metricName: "accuracy", higherIsBetter: true },
    { type: "best_selected", at: t + 52, choice: "the configuration you set", reason: "r", retrained: false },
    { type: "tested", at: t + 53, metrics, predictions: [] },
    { type: "evaluated", at: t + 54, importance: { method: "coefficients", source: "live", note: "", values: [{ feature: "a", importance: 0.7 }] }, surface: { xFeature: "a", yFeature: "b", xs: [0], ys: [0], values: [0], source: "live", note: "exact", points: [] }, lossCurve: [{ epoch: 1, train: 1.05, validation: 0.8 }] },
    { type: "model_saved", at: t + 55, modelId: "m", bytes: 100, params: { count: 15, norm: 1, groups: [] }, tree: null, forest: null, architecture: null },
    { type: "run_completed", at: t + 56, totalMs: 56, iterations: 2, epochs: 1 },
  ];
}

function play(events: MLEvent[]): { state: MLVisualState; log: ReturnType<MLEventSequencer["fromServer"]> } {
  const seq = new MLEventSequencer("run");
  const log = events.flatMap((e) => seq.fromServer(e));
  let state = createMLVisualState();
  for (const e of log) state = applyMLEvent(state, e);
  return { state, log };
}

describe("ML sequencer", () => {
  it("expands a training step into the six loop stages, slower the first time", () => {
    const { log } = play(script());
    const loop = log.filter((e) => ["FORWARD", "LOSS", "GRADIENT", "BACKPROP", "UPDATE", "ITERATE"].includes(e.type));
    expect(loop.slice(0, 6).map((e) => e.stage)).toEqual(["forward", "loss", "gradient", "backprop", "update", "iterate"]);
    expect(loop.length).toBe(12);
    expect(loop[0]!.duration).toBeGreaterThan(loop[6]!.duration);
    expect(log.every((e) => e.source === "live")).toBe(true);
  });

  it("never marks loop events compressible, so the speed control is obeyed", () => {
    // The player speeds compressible events up when it lags a live stream. A
    // training run arrives in one burst, so compressing would pin playback at
    // its fastest and make 1x indistinguishable from 4x.
    const seq = new MLEventSequencer("run");
    const log = [...script(), { type: "tree_split", at: 9, step: { treeIndex: 0, nodeId: 0, depth: 0, samples: 8, impurityBefore: 0.5, candidatesEvaluated: 2, chosen: { feature: "a", threshold: 1, impurityAfter: 0.1, gain: 0.4, left: 4, right: 4, leftId: 1, rightId: 2 }, leaf: null, ms: 1 } } as MLEvent].flatMap((e) => seq.fromServer(e));
    expect(log.some((e) => e.compressible)).toBe(false);
  });

  it("shortens each pass of the loop but keeps the last one watchable", () => {
    const seq = new MLEventSequencer("run");
    const forwardOf = (iteration: number) => seq.fromServer({ type: "train_step", at: iteration, step: step(iteration, 1, 1), detailed: true, stride: 1 }).find((e) => e.type === "FORWARD")!.duration;
    const first = forwardOf(1);
    const second = forwardOf(2);
    for (let i = 3; i <= 40; i++) forwardOf(i);
    const fortieth = forwardOf(41);
    expect(second).toBeLessThan(first);
    expect(fortieth).toBeLessThan(second);
    // Even deep into a long run a stage stays on screen long enough to register.
    expect(fortieth).toBeGreaterThan(100);
    // The whole drawn loop has to be sittable through: the budget's worth of
    // passes at 1x should land in the low minutes, not the tens of minutes.
    const seq2 = new MLEventSequencer("budget");
    let total = 0;
    for (let i = 1; i <= ML_LIMITS.maxDetailedSteps; i++) for (const e of seq2.fromServer({ type: "train_step", at: i, step: step(i, 1, 1), detailed: true, stride: 1 })) total += e.duration;
    expect(total).toBeLessThan(150_000);
    expect(total).toBeGreaterThan(30_000);
  });

  it("marks the evaluation stage as a simulation when the surface is a 2-D slice", () => {
    const seq = new MLEventSequencer("run");
    const ev = script().find((e) => e.type === "evaluated") as Extract<MLEvent, { type: "evaluated" }>;
    const sliced = seq.fromServer({ ...ev, surface: { ...ev.surface!, source: "simulation", note: "sliced" } })[0]!;
    expect(sliced.source).toBe("simulation");
    expect(seq.fromServer(ev)[0]!.source).toBe("live");
  });

  it("maps tree splits onto forward, loss and update, with leaves closing on update", () => {
    const seq = new MLEventSequencer("run");
    const split = seq.fromServer({ type: "tree_split", at: 1, step: { treeIndex: 0, nodeId: 0, depth: 0, samples: 100, impurityBefore: 0.66, candidatesEvaluated: 40, chosen: { feature: "a", threshold: 1.5, impurityAfter: 0.3, gain: 0.36, left: 50, right: 50, leftId: 1, rightId: 2 }, leaf: null, ms: 1 } });
    expect(split.map((e) => [e.type, e.stage])).toEqual([["FORWARD", "forward"], ["LOSS", "loss"], ["UPDATE", "update"], ["TREE_SPLIT", "iterate"]]);
    const leaf = seq.fromServer({ type: "tree_split", at: 2, step: { treeIndex: 0, nodeId: 1, depth: 1, samples: 50, impurityBefore: 0, candidatesEvaluated: 0, chosen: null, leaf: { value: 1 }, ms: 1 } });
    expect(leaf.map((e) => e.stage)).toEqual(["update"]);
  });
});

describe("ML reducer", () => {
  it("lights every visited stage and records the facts of each", () => {
    const { state } = play(script());
    for (const id of ["ingest", "inspect", "identify", "clean", "missing", "encode", "scale", "engineer", "split", "selectModel", "init", "forward", "loss", "gradient", "backprop", "update", "iterate", "epoch", "validate", "hyperparams", "selectBest", "test", "evaluate", "save"] as const) expect(state.nodes[id]).toBe("completed");
    expect(state.nodes.infer).toBe("idle");
    expect(state.nodes.predict).toBe("idle");
    expect(state.identified?.task).toBe("classification");
    expect(state.stepsSeen).toBe(2);
    expect(state.lossTrace.map((l) => l.loss)).toEqual([1.2, 0.9]);
    expect(state.params?.count).toBe(15);
    expect(state.epochs).toHaveLength(1);
    expect(state.test?.metrics.task).toBe("classification");
    expect(state.evaluation?.importance?.values[0]?.feature).toBe("a");
    expect(state.completion?.iterations).toBe(2);
    expect(state.currentStage).toBe("save");
  });

  it("folds repeated loop passes into one timeline row per stage", () => {
    const { state } = play(script());
    const forwardRows = state.timeline.filter((t) => t.stage === "forward");
    expect(forwardRows).toHaveLength(1);
    expect(forwardRows[0]!.count).toBe(2);
    expect(forwardRows[0]!.label).toMatch(/it 2/);
  });

  it("dims stages the algorithm never visits instead of queueing them", () => {
    const events = script().map((e) => (e.type === "model_selected" ? { ...e, algorithm: "decision_tree" as const, family: "tree" as const, skippedStages: ["gradient", "backprop", "epoch"], skipReason: "trees" } : e)).filter((e) => e.type !== "train_step" && e.type !== "epoch_completed");
    const { state } = play(events);
    expect(state.skipped).toEqual(["gradient", "backprop", "epoch"]);
    expect(state.nodes.gradient).toBe("idle");
    expect(state.nodes.backprop).toBe("idle");
  });

  it("grows the tree node by node from the splits, then takes the server's final tree", () => {
    const seq = new MLEventSequencer("run");
    let s = createMLVisualState();
    const apply = (e: MLEvent) => {
      for (const x of seq.fromServer(e)) s = applyMLEvent(s, x);
    };
    apply({ type: "tree_split", at: 1, step: { treeIndex: 0, nodeId: 0, depth: 0, samples: 100, impurityBefore: 0.66, candidatesEvaluated: 40, chosen: { feature: "a", threshold: 1.5, impurityAfter: 0.3, gain: 0.36, left: 40, right: 60, leftId: 1, rightId: 2 }, leaf: null, ms: 1 } });
    expect(s.tree?.map((n) => n.id)).toEqual([0, 1, 2]);
    expect(s.tree?.[0]).toMatchObject({ feature: "a", threshold: 1.5, left: 1, right: 2, samples: 100 });
    expect(s.tree?.[1]).toMatchObject({ depth: 1, samples: 40 });
    apply({ type: "tree_split", at: 2, step: { treeIndex: 0, nodeId: 1, depth: 1, samples: 40, impurityBefore: 0, candidatesEvaluated: 0, chosen: null, leaf: { value: 1, classCounts: [0, 40] }, ms: 1 } });
    expect(s.tree?.[1]).toMatchObject({ value: 1, classCounts: [0, 40], impurity: 0 });
    // A second tree's splits (a forest) never disturb the drawn tree.
    apply({ type: "tree_split", at: 3, step: { treeIndex: 1, nodeId: 0, depth: 0, samples: 100, impurityBefore: 0.5, candidatesEvaluated: 3, chosen: { feature: "b", threshold: 0, impurityAfter: 0.1, gain: 0.4, left: 50, right: 50, leftId: 1, rightId: 2 }, leaf: null, ms: 1 } });
    expect(s.tree?.[0]?.feature).toBe("a");
    const final = [{ id: 0, depth: 0, samples: 100, impurity: 0.66, feature: "a", threshold: 1.5, left: 1, right: 2 }, { id: 1, depth: 1, samples: 40, impurity: 0, value: 1 }, { id: 2, depth: 1, samples: 60, impurity: 0.2, value: 0 }];
    apply({ type: "model_saved", at: 4, modelId: "m", bytes: 1, params: { count: 0, norm: 0, groups: [] }, tree: final, forest: null, architecture: null });
    expect(s.tree).toEqual(final);
  });

  it("appends a prediction as two more stages", () => {
    const { state } = play(script());
    const seq = new MLEventSequencer("run");
    let s = state;
    for (const e of seq.fromPrediction({ a: 1, b: 2 }, { modelId: "m", algorithm: "logistic_regression", task: "classification", encoded: [{ feature: "a", value: 1 }], scaled: [0.5], probabilities: [0.2, 0.8], prediction: 1, label: "b", ms: 1 })) s = applyMLEvent(s, e);
    expect(s.nodes.infer).toBe("completed");
    expect(s.nodes.predict).toBe("completed");
    expect(s.inference?.trace.label).toBe("b");
  });
});

describe("ML layout", () => {
  it("places every stage once with connections that reference real nodes", () => {
    expect(ML_NODES.map((n) => n.id).sort()).toEqual([...ML_STAGE_IDS].sort());
    expect(ML_NODE_ORDER).toHaveLength(ML_STAGE_IDS.length);
    const ids = new Set(ML_NODES.map((n) => n.id));
    for (const c of ML_CONNECTIONS) {
      expect(ids.has(c.from)).toBe(true);
      expect(ids.has(c.to)).toBe(true);
    }
    expect(ML_CONNECTIONS.some((c) => c.kind === "loop" && c.from === "iterate" && c.to === "forward")).toBe(true);
    for (const a of ML_NODES) for (const b of ML_NODES) if (a !== b && a.band === b.band) expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
  });
});
