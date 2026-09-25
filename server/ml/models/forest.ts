import type { ParamSnapshot, PredictionTrace } from "@shared/ml";
import { classificationMetrics, regressionMetrics } from "../metrics";
import { Rng } from "../random";
import { DecisionTreeModel, growTree } from "./tree";
import { argmax, mean, round, type FittedModel, type TrainContext, type TrainResult } from "./types";

/** Bagged trees on bootstrapped rows with a random feature subset per split; the trees vote. */
export class RandomForestModel implements FittedModel {
  readonly algorithm = "random_forest" as const;
  trees: DecisionTreeModel[] = [];
  constructor(readonly task: "classification" | "regression", readonly classes: string[] | null, readonly featureNames: string[]) {}

  votes(x: number[]): number[] {
    return this.trees.map((t) => t.predictOne(x).value);
  }

  predict(X: number[][]): number[] {
    return X.map((x) => this.combine(this.votes(x)));
  }

  combine(votes: number[]): number {
    if (this.task === "regression") return mean(votes);
    const counts = new Array<number>(this.classes!.length).fill(0);
    for (const v of votes) counts[v]! += 1;
    return argmax(counts);
  }

  predictProba(X: number[][]): number[][] | undefined {
    if (this.task !== "classification") return undefined;
    return X.map((x) => {
      const counts = new Array<number>(this.classes!.length).fill(0);
      for (const v of this.votes(x)) counts[v]! += 1;
      return counts.map((c) => c / this.trees.length);
    });
  }

  params(): ParamSnapshot {
    const thresholds = this.trees.flatMap((t) => t.nodes.filter((n) => n.feature !== undefined).map((n) => n.threshold!));
    return { count: thresholds.length + this.trees.reduce((s, t) => s + t.nodes.filter((n) => n.feature === undefined).length, 0), norm: Math.sqrt(thresholds.reduce((s, v) => s + v * v, 0)), groups: [{ name: `thresholds across ${this.trees.length} trees`, shape: [thresholds.length], values: thresholds.slice(0, 64).map((v) => round(v)), truncated: thresholds.length > 64, norm: Math.sqrt(thresholds.reduce((s, v) => s + v * v, 0)) }] };
  }

  describe() {
    return { tree: this.trees[0]?.nodes ?? null, forest: { trees: this.trees.length, nodes: this.trees.reduce((s, t) => s + t.nodes.length, 0) } };
  }

  importance(featureNames: string[]) {
    const acc = new Map<string, number>();
    for (const t of this.trees) for (const v of t.importance(featureNames)!.values) acc.set(v.feature, (acc.get(v.feature) ?? 0) + v.importance / this.trees.length);
    return { method: "impurity decrease" as const, values: featureNames.map((feature) => ({ feature, importance: round(acc.get(feature) ?? 0) })).sort((a, b) => b.importance - a.importance) };
  }

  trace(x: number[]): Partial<PredictionTrace> {
    const path = this.trees.slice(0, 3).flatMap((t, ti) => t.predictOne(x).path.map((p) => ({ ...p, treeIndex: ti })));
    const votes = this.votes(x);
    const prediction = this.combine(votes);
    const probabilities = this.task === "classification" ? this.predictProba([x])![0]! : null;
    return { path, probabilities, prediction };
  }

  toJSON() {
    return { algorithm: this.algorithm, task: this.task, classes: this.classes, featureNames: this.featureNames, trees: this.trees.map((t) => t.nodes) };
  }
}

export async function trainRandomForest(ctx: TrainContext): Promise<TrainResult> {
  const rng = new Rng(ctx.seed);
  const model = new RandomForestModel(ctx.task, ctx.classes, ctx.featureNames);
  const n = ctx.Xtrain.length;
  const d = ctx.Xtrain[0]!.length;
  const featuresPerSplit = Math.max(1, ctx.task === "classification" ? Math.round(Math.sqrt(d)) : Math.round(d / 3));
  // Out-of-bag: rows a tree never saw score that tree, giving a free validation estimate.
  const oobVotes: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < ctx.hp.trees; t++) {
    const start = Date.now();
    const bag = Array.from({ length: n }, () => rng.int(n));
    const inBag = new Set(bag);
    const tree = await growTree(ctx, bag, { maxDepth: ctx.hp.maxDepth, minSamplesLeaf: ctx.hp.minSamplesLeaf, featuresPerSplit, rng, treeIndex: t, emitSplits: !ctx.quiet && t === 0, maxCandidates: 16 });
    model.trees.push(tree);
    for (let i = 0; i < n; i++) if (!inBag.has(i)) oobVotes[i]!.push(tree.predictOne(ctx.Xtrain[i]!).value);
    const scored = oobVotes.map((v, i) => (v.length ? { pred: model.combine(v), y: ctx.ytrain[i]! } : null)).filter((x): x is { pred: number; y: number } => x !== null);
    const oob = scored.length ? (ctx.task === "classification" ? classificationMetrics(scored.map((s) => s.pred), scored.map((s) => s.y), ctx.classes!, null).accuracy : regressionMetrics(scored.map((s) => s.pred), scored.map((s) => s.y)).rmse) : null;
    if (!ctx.quiet) ctx.emit({ type: "tree_built", at: Date.now(), treeIndex: t, nodes: tree.nodes.length, depth: Math.max(...tree.nodes.map((x) => x.depth)), leaves: tree.nodes.filter((x) => x.feature === undefined).length, oobScore: oob === null ? null : round(oob), ms: Date.now() - start, tree: t === 0 ? tree.nodes : null });
    await ctx.tick();
  }
  return { model, epochs: [], iterations: model.trees.length, lossCurve: [] };
}
