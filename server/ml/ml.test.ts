import { describe, expect, it } from "vitest";
import type { MLConfigInput, MLEvent } from "../../shared/ml";
import { DEFAULT_ML_CONFIG, ML_LIMITS } from "../../shared/ml";
import { inferColumnType, parseCsv, parseJsonTable, summarizeColumn, toNumber } from "./data";
import { classificationMetrics, regressionMetrics, roc } from "./metrics";
import { applyScaler, clean, encode, fitScaler, identify, impute, split } from "./preprocess";
import { SAMPLES } from "./samples";
import { predictWithTrace, runTraining, sanitizeMLConfig } from "./trainer";

const flowers = SAMPLES.find((s) => s.id === "flowers")!.build();
const houses = SAMPLES.find((s) => s.id === "houses")!.build();
const churn = SAMPLES.find((s) => s.id === "churn")!.build();

describe("parsing and inference", () => {
  it("parses quoted CSV with a sniffed delimiter", () => {
    const t = parseCsv('a;b;"c d"\n1;"x;y";3\n2;"he said ""hi""";4\n');
    expect(t.columns).toEqual(["a", "b", "c d"]);
    expect(t.rows).toEqual([["1", "x;y", "3"], ["2", 'he said "hi"', "4"]]);
  });
  it("parses JSON arrays of objects, filling gaps", () => {
    const t = parseJsonTable('[{"x":1,"y":"a"},{"x":2}]');
    expect(t.columns).toEqual(["x", "y"]);
    expect(t.rows).toEqual([["1", "a"], ["2", ""]]);
  });
  it("infers column types from values", () => {
    expect(inferColumnType("age", ["1", "2.5", "", "4"])).toBe("numeric");
    expect(inferColumnType("plan", Array.from({ length: 50 }, (_, i) => ["a", "b", "c"][i % 3]!))).toBe("categorical");
    expect(inferColumnType("ok", ["yes", "no", "yes"])).toBe("boolean");
    expect(inferColumnType("customer_id", Array.from({ length: 30 }, (_, i) => `C${i}`))).toBe("id");
    expect(inferColumnType("k", ["5", "5", "5"])).toBe("constant");
    expect(toNumber("1,200")).toBe(1200);
    expect(toNumber("12%")).toBe(12);
    expect(toNumber("abc")).toBeNull();
  });
  it("summarizes numeric columns with stats and a histogram", () => {
    const s = summarizeColumn("v", ["1", "2", "3", "4", "", "100"]);
    expect(s.missing).toBe(1);
    expect(s.stats?.min).toBe(1);
    expect(s.stats?.median).toBe(3);
    expect("bins" in s.histogram!).toBe(true);
  });
});

describe("preprocessing", () => {
  it("identifies the task, drops ids and encodes categories", () => {
    const id = identify(churn, { ...DEFAULT_ML_CONFIG, target: null });
    expect(id.target).toBe("churned");
    expect(id.task).toBe("classification");
    expect(id.classes).toEqual(["no", "yes"]);
    expect(id.features).not.toContain("customer_id");
    const c = clean(churn, id);
    expect(c.droppedColumns.map((d) => d.name)).toContain("customer_id");
    const imp = impute(c.table, id, "median");
    expect(imp.reports.find((r) => r.column === "monthly_charge")!.filled).toBeGreaterThan(0);
    expect(imp.table.rows.every((r) => r[imp.table.columns.indexOf("monthly_charge")] !== "")).toBe(true);
    const enc = encode(imp.table, id);
    expect(enc.featureNames).toContain("plan=premium");
    expect(enc.featureNames).toContain("autopay");
    expect(enc.X[0]!.length).toBe(enc.featureNames.length);
    expect(new Set(enc.y)).toEqual(new Set([0, 1]));
  });
  it("chooses regression for a numeric target with many values", () => {
    const id = identify(houses, { ...DEFAULT_ML_CONFIG, target: "price" });
    expect(id.task).toBe("regression");
  });
  it("splits deterministically and stratifies", () => {
    const y = Array.from({ length: 120 }, (_, i) => i % 3);
    const a = split(y, { ...DEFAULT_ML_CONFIG, seed: 1 }, "classification");
    const b = split(y, { ...DEFAULT_ML_CONFIG, seed: 1 }, "classification");
    expect(a).toEqual(b);
    expect(a.train.length + a.validation.length + a.test.length).toBe(120);
    for (const c of [0, 1, 2]) expect(a.train.filter((i) => y[i] === c).length).toBe(28);
  });
  it("fits the scaler on train rows only and applies it", () => {
    const s = fitScaler([[0, 10], [2, 30]], "standard");
    expect(s.means).toEqual([1, 20]);
    expect(applyScaler([1, 20], s)).toEqual([0, 0]);
    const mm = fitScaler([[0, 10], [2, 30]], "minmax");
    expect(applyScaler([2, 10], mm)).toEqual([1, 0]);
  });
});

describe("metrics", () => {
  it("computes classification metrics, confusion and AUC", () => {
    const m = classificationMetrics([0, 1, 1, 0], [0, 1, 0, 0], ["a", "b"], [[0.9, 0.1], [0.2, 0.8], [0.4, 0.6], [0.7, 0.3]]);
    expect(m.accuracy).toBe(0.75);
    expect(m.confusion.matrix).toEqual([[2, 1], [0, 1]]);
    expect(m.roc![1]!.auc).toBeCloseTo(1, 5);
    expect(m.logLoss).toBeGreaterThan(0);
  });
  it("computes regression metrics", () => {
    const m = regressionMetrics([1, 2, 3], [1, 2, 4]);
    expect(m.mae).toBeCloseTo(1 / 3);
    expect(m.r2).toBeGreaterThan(0.7);
  });
  it("ROC of a perfect ranker is 1 and of a reversed one is 0", () => {
    expect(roc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]).auc).toBe(1);
    expect(roc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]).auc).toBe(0);
  });
});

/* ─────────────────────────────── training ─────────────────────────────── */

async function train(datasetId: "flowers" | "houses" | "churn", config: MLConfigInput) {
  const table = datasetId === "flowers" ? flowers : datasetId === "houses" ? houses : churn;
  const events: MLEvent[] = [];
  const outcome = await runTraining({ runId: `t-${datasetId}`, datasetId, datasetName: datasetId, table, config: sanitizeMLConfig(config), emit: (e) => events.push(e), signal: new AbortController().signal });
  // Notices are asides (a striding warning, a subsampling note) that can land
  // between any two stages, so stage-order assertions ignore them.
  return { events, outcome, types: events.filter((e) => e.type !== "notice").map((e) => e.type), allTypes: events.map((e) => e.type) };
}

const ORDER = ["run_started", "dataset_loaded", "inspected", "identified", "cleaned", "imputed", "encoded", "scaled", "engineered", "split", "model_selected", "model_initialized"];

describe("training pipeline", () => {
  it("logistic regression learns the flowers and emits every stage in order", async () => {
    const { events, outcome, types } = await train("flowers", { algorithm: "logistic_regression", hyperparameters: { epochs: 25, learningRate: 0.1 } });
    expect(types.slice(0, ORDER.length)).toEqual(ORDER);
    for (const t of ["train_step", "epoch_completed", "validated", "hyperparameters_evaluated", "best_selected", "tested", "evaluated", "model_saved", "run_completed"]) expect(types).toContain(t);
    const tested = events.find((e) => e.type === "tested") as Extract<MLEvent, { type: "tested" }>;
    expect(tested.metrics.task).toBe("classification");
    expect((tested.metrics as { accuracy: number }).accuracy).toBeGreaterThan(0.85);
    const steps = events.filter((e) => e.type === "train_step") as Extract<MLEvent, { type: "train_step" }>[];
    // 25 epochs of 8 batches is 200 steps, more than the drawing budget, so the
    // run strides and says so. Every step still runs; only the drawn ones are sent.
    expect(steps.length).toBeLessThanOrEqual(ML_LIMITS.maxDetailedSteps + 1);
    expect(steps.at(-1)!.step.iteration).toBeGreaterThan(steps.length);
    expect(events.some((e) => e.type === "notice" && /every \d+.. is drawn/.test(e.message))).toBe(true);
    expect(steps[0]!.step.iteration).toBe(1);
    expect(steps.at(-1)!.step.loss.value).toBeLessThan(steps[0]!.step.loss.value);
    expect(steps[0]!.step.gradient.norm).toBeGreaterThan(0);
    expect(steps[0]!.step.update.params.count).toBe(4 * 3 + 3);
    const evaluated = events.find((e) => e.type === "evaluated") as Extract<MLEvent, { type: "evaluated" }>;
    expect(evaluated.importance?.method).toBe("coefficients");
    expect(evaluated.surface?.source).toBe("simulation");
    expect(evaluated.surface?.note).toMatch(/4 features/);
    expect(outcome.saved?.info.classes).toEqual(["setosa", "versicolor", "virginica"]);
  }, 30_000);

  it("linear regression fits the house prices", async () => {
    const { events } = await train("houses", { algorithm: "linear_regression", hyperparameters: { epochs: 60, learningRate: 0.05, batchSize: 32 } });
    const tested = events.find((e) => e.type === "tested") as Extract<MLEvent, { type: "tested" }>;
    expect(tested.metrics.task).toBe("regression");
    expect((tested.metrics as { r2: number }).r2).toBeGreaterThan(0.8);
    const imputed = events.find((e) => e.type === "imputed") as Extract<MLEvent, { type: "imputed" }>;
    expect(imputed.reports.find((r) => r.column === "age_years")!.filled).toBeGreaterThan(0);
    const encoded = events.find((e) => e.type === "encoded") as Extract<MLEvent, { type: "encoded" }>;
    expect(encoded.featureNames).toContain("neighbourhood=riverside");
  }, 30_000);

  it("a neural network reports layers, activations and backward norms", async () => {
    const { events } = await train("flowers", { algorithm: "neural_network", hyperparameters: { epochs: 20, learningRate: 0.02, hiddenLayers: [6], batchSize: 16 } });
    const init = events.find((e) => e.type === "model_initialized") as Extract<MLEvent, { type: "model_initialized" }>;
    expect(init.architecture?.layers.map((l) => l.units)).toEqual([4, 6, 3]);
    // The initialization stage shows the real seeded starting weights, not a placeholder.
    expect(init.params.count).toBe(4 * 6 + 6 + 6 * 3 + 3);
    expect(init.architecture?.paramCount).toBe(init.params.count);
    expect(init.params.groups.map((g) => g.name)).toEqual(["hidden 1 W", "hidden 1 b", "output W", "output b"]);
    expect(init.params.norm).toBeGreaterThan(0);
    const step = (events.find((e) => e.type === "train_step") as Extract<MLEvent, { type: "train_step" }>).step;
    expect(step.forward.activations?.map((a) => a.layer)).toEqual(["hidden 1", "output"]);
    expect(step.backward.map((b) => b.layer)).toEqual(["hidden 1", "output"]);
    expect(step.update.params.count).toBe(4 * 6 + 6 + 6 * 3 + 3);
    const tested = events.find((e) => e.type === "tested") as Extract<MLEvent, { type: "tested" }>;
    expect((tested.metrics as { accuracy: number }).accuracy).toBeGreaterThan(0.8);
    const evaluated = events.find((e) => e.type === "evaluated") as Extract<MLEvent, { type: "evaluated" }>;
    expect(evaluated.importance?.method).toBe("permutation");
  }, 30_000);

  it("a decision tree emits one split per node and skips gradient stages", async () => {
    const { events } = await train("flowers", { algorithm: "decision_tree", hyperparameters: { maxDepth: 3 } });
    const selected = events.find((e) => e.type === "model_selected") as Extract<MLEvent, { type: "model_selected" }>;
    expect(selected.skippedStages).toEqual(["gradient", "backprop", "epoch"]);
    const splits = events.filter((e) => e.type === "tree_split") as Extract<MLEvent, { type: "tree_split" }>[];
    const savedTree = (events.find((e) => e.type === "model_saved") as Extract<MLEvent, { type: "model_saved" }>).tree!;
    for (const sp of splits) {
      if (!sp.step.chosen) continue;
      expect(savedTree.find((n) => n.id === sp.step.nodeId)).toMatchObject({ left: sp.step.chosen.leftId, right: sp.step.chosen.rightId });
      expect(savedTree.find((n) => n.id === sp.step.chosen!.leftId)?.samples).toBe(sp.step.chosen.left);
    }
    const built = events.find((e) => e.type === "tree_built") as Extract<MLEvent, { type: "tree_built" }>;
    expect(splits.length).toBe(built.nodes);
    expect(splits[0]!.step.chosen).not.toBeNull();
    expect(splits[0]!.step.chosen!.gain).toBeGreaterThan(0);
    expect(Math.max(...built.tree!.map((n) => n.depth))).toBeLessThanOrEqual(3);
    const tested = events.find((e) => e.type === "tested") as Extract<MLEvent, { type: "tested" }>;
    expect((tested.metrics as { accuracy: number }).accuracy).toBeGreaterThan(0.85);
  }, 30_000);

  it("random forest, knn, naive bayes and svm all train and test on churn", async () => {
    for (const algorithm of ["random_forest", "knn", "naive_bayes", "svm"] as const) {
      const { events, types } = await train("churn", { algorithm, hyperparameters: { trees: 5, maxDepth: 4, k: 7, epochs: 15 } });
      expect(types).toContain("tested");
      const tested = events.find((e) => e.type === "tested") as Extract<MLEvent, { type: "tested" }>;
      expect((tested.metrics as { accuracy: number }).accuracy).toBeGreaterThan(0.6);
      if (algorithm === "random_forest") expect(events.filter((e) => e.type === "tree_built")).toHaveLength(5);
      if (algorithm === "knn") expect(types).toContain("knn_query");
      if (algorithm === "naive_bayes") expect(events.filter((e) => e.type === "nb_class_fitted")).toHaveLength(2);
      if (algorithm === "svm") expect((tested.metrics as { roc: unknown }).roc).not.toBeNull();
    }
  }, 60_000);

  it("a sweep trains every candidate and picks the best on validation", async () => {
    const { events } = await train("flowers", { algorithm: "knn", sweep: { parameter: "k", values: [1, 3, 9] }, hyperparameters: { k: 5 } });
    const evaluated = events.find((e) => e.type === "hyperparameters_evaluated") as Extract<MLEvent, { type: "hyperparameters_evaluated" }>;
    expect(evaluated.candidates.map((c) => c.value)).toEqual([5, 1, 3, 9]);
    expect(evaluated.candidates.filter((c) => c.best)).toHaveLength(1);
    const best = events.find((e) => e.type === "best_selected") as Extract<MLEvent, { type: "best_selected" }>;
    expect(best.choice).toMatch(/^k = /);
  }, 30_000);

  it("prefills the prediction form with values a person would type", async () => {
    const { outcome } = await train("churn", { algorithm: "decision_tree", hyperparameters: { maxDepth: 3 } });
    for (const input of outcome.saved!.info.inputs) {
      if (input.type !== "numeric") continue;
      // No 36.495000000000005 in a form field.
      expect(String(input.example)).toMatch(/^-?\d+(\.\d{1,4})?$/);
    }
  }, 30_000);

  it("predicts a raw row through the saved preprocessing with a trace", async () => {
    const { outcome } = await train("houses", { algorithm: "decision_tree", hyperparameters: { maxDepth: 4 } });
    const trace = predictWithTrace(outcome.saved!, { size_m2: 120, rooms: 3, age_years: "", distance_km: 4, neighbourhood: "riverside" });
    expect(trace.task).toBe("regression");
    expect(trace.encoded.find((e) => e.feature === "neighbourhood=riverside")!.value).toBe(1);
    expect(trace.path!.length).toBeGreaterThan(1);
    expect(trace.prediction).toBeGreaterThan(100);
  }, 30_000);

  it("refuses an algorithm that cannot do the task", async () => {
    await expect(train("houses", { algorithm: "logistic_regression" })).rejects.toThrow(/classification/);
  });

  it("clamps a config from the browser", () => {
    const c = sanitizeMLConfig({ algorithm: "nope" as never, trainFraction: 5, hyperparameters: { epochs: 9999, hiddenLayers: [1000, 2, 3, 4, 5, 6] }, sweep: { parameter: "k", values: [1, 2, 3, 4, 5, 6, 7] } });
    expect(c.algorithm).toBe("logistic_regression");
    expect(c.trainFraction).toBe(0.9);
    expect(c.hyperparameters.epochs).toBe(200);
    expect(c.hyperparameters.hiddenLayers).toEqual([64, 2, 3, 4]);
    expect(c.sweep?.values).toHaveLength(4);
  });
});

