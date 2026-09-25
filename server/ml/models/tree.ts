import type { Algorithm, ParamSnapshot, PredictionTrace, TreeNode } from "@shared/ml";
import { Rng } from "../random";
import { argmax, mean, round, type FittedModel, type TrainContext, type TrainResult } from "./types";

/**
 * CART: at each node, every candidate threshold on every (allowed) feature is
 * scored by the impurity of the two groups it would make; the best split wins
 * and the node grows two children until depth, size or purity stops it.
 */

export interface TreeOptions {
  maxDepth: number;
  minSamplesLeaf: number;
  /** Features considered per node (forests use a random subset). */
  featuresPerSplit: number | null;
  rng: Rng;
  treeIndex: number;
  /** Emit a tree_split event per node. */
  emitSplits: boolean;
  /** Candidate thresholds per feature are capped to this many quantiles. */
  maxCandidates: number;
}

export class DecisionTreeModel implements FittedModel {
  readonly algorithm: Algorithm;
  nodes: TreeNode[] = [];
  constructor(readonly task: "classification" | "regression", readonly classes: string[] | null, readonly featureNames: string[], algorithm: Algorithm = "decision_tree") {
    this.algorithm = algorithm;
  }

  predictOne(x: number[]): { value: number; counts?: number[]; path: NonNullable<PredictionTrace["path"]> } {
    const path: NonNullable<PredictionTrace["path"]> = [];
    let node = this.nodes[0]!;
    while (node.feature !== undefined) {
      const fi = this.featureNames.indexOf(node.feature);
      const goLeft = x[fi]! <= node.threshold!;
      path.push({ treeIndex: 0, nodeId: node.id, feature: node.feature, threshold: node.threshold, value: node.value ?? 0, went: goLeft ? "left" : "right" });
      node = this.nodes[goLeft ? node.left! : node.right!]!;
    }
    path.push({ treeIndex: 0, nodeId: node.id, value: node.value ?? 0 });
    return { value: node.value ?? 0, counts: node.classCounts, path };
  }

  predict(X: number[][]): number[] {
    return X.map((x) => this.predictOne(x).value);
  }

  predictProba(X: number[][]): number[][] | undefined {
    if (this.task !== "classification") return undefined;
    return X.map((x) => {
      const c = this.predictOne(x).counts ?? [];
      const total = c.reduce((a, b) => a + b, 0) || 1;
      return c.map((v) => v / total);
    });
  }

  params(): ParamSnapshot {
    const internal = this.nodes.filter((n) => n.feature !== undefined);
    const thresholds = internal.map((n) => n.threshold!);
    const leaves = this.nodes.filter((n) => n.feature === undefined).map((n) => n.value ?? 0);
    const all = [...thresholds, ...leaves];
    return { count: all.length, norm: Math.sqrt(all.reduce((s, v) => s + v * v, 0)), groups: [{ name: "split thresholds", shape: [thresholds.length], values: thresholds.slice(0, 64).map((v) => round(v)), truncated: thresholds.length > 64, norm: Math.sqrt(thresholds.reduce((s, v) => s + v * v, 0)) }, { name: "leaf values", shape: [leaves.length], values: leaves.slice(0, 64).map((v) => round(v)), truncated: leaves.length > 64, norm: Math.sqrt(leaves.reduce((s, v) => s + v * v, 0)) }] };
  }

  describe() {
    return { tree: this.nodes };
  }

  importance(featureNames: string[]) {
    const total = new Map<string, number>();
    const root = this.nodes[0]?.samples ?? 1;
    for (const n of this.nodes) {
      if (n.feature === undefined) continue;
      const l = this.nodes[n.left!]!;
      const r = this.nodes[n.right!]!;
      const gain = n.impurity * n.samples - l.impurity * l.samples - r.impurity * r.samples;
      total.set(n.feature, (total.get(n.feature) ?? 0) + gain / root);
    }
    const sum = [...total.values()].reduce((a, b) => a + b, 0) || 1;
    return { method: "impurity decrease" as const, values: featureNames.map((feature) => ({ feature, importance: round((total.get(feature) ?? 0) / sum) })).sort((a, b) => b.importance - a.importance) };
  }

  trace(x: number[]): Partial<PredictionTrace> {
    const r = this.predictOne(x);
    const probabilities = r.counts ? r.counts.map((v) => v / (r.counts!.reduce((a, b) => a + b, 0) || 1)) : null;
    return { path: r.path, probabilities, prediction: r.value };
  }

  toJSON() {
    return { algorithm: this.algorithm, task: this.task, classes: this.classes, featureNames: this.featureNames, nodes: this.nodes };
  }
}

export function impurity(indices: number[], y: number[], task: "classification" | "regression", nClasses: number): { value: number; counts?: number[]; mean?: number } {
  if (task === "classification") {
    const counts = new Array<number>(nClasses).fill(0);
    for (const i of indices) counts[y[i]!]! += 1;
    const n = indices.length || 1;
    let g = 1;
    for (const c of counts) g -= (c / n) ** 2;
    return { value: g, counts };
  }
  const m = mean(indices.map((i) => y[i]!));
  let v = 0;
  for (const i of indices) v += (y[i]! - m) ** 2;
  return { value: indices.length ? v / indices.length : 0, mean: m };
}

/** Grows one tree on the given row indices, emitting a step per node. */
export async function growTree(ctx: TrainContext, indices: number[], opts: TreeOptions, X: number[][] = ctx.Xtrain, y: number[] = ctx.ytrain): Promise<DecisionTreeModel> {
  const model = new DecisionTreeModel(ctx.task, ctx.classes, ctx.featureNames, opts.treeIndex > 0 ? "random_forest" : "decision_tree");
  const nClasses = ctx.classes?.length ?? 0;
  const d = X[0]!.length;
  const stack: { idx: number[]; depth: number; nodeId: number }[] = [];
  const root = impurity(indices, y, ctx.task, nClasses);
  model.nodes.push({ id: 0, depth: 0, samples: indices.length, impurity: root.value });
  stack.push({ idx: indices, depth: 0, nodeId: 0 });
  let visited = 0;
  while (stack.length) {
    const { idx, depth, nodeId } = stack.shift()!;
    const start = Date.now();
    const node = model.nodes[nodeId]!;
    const here = impurity(idx, y, ctx.task, nClasses);
    const leafValue = ctx.task === "classification" ? argmax(here.counts!) : here.mean!;
    const makeLeaf = () => {
      node.value = round(leafValue);
      node.classCounts = here.counts;
      if (opts.emitSplits) ctx.emit({ type: "tree_split", at: Date.now(), step: { treeIndex: opts.treeIndex, nodeId, depth, samples: idx.length, impurityBefore: round(here.value), candidatesEvaluated: 0, chosen: null, leaf: { value: node.value!, classCounts: here.counts }, ms: Date.now() - start } });
    };
    if (depth >= opts.maxDepth || idx.length < 2 * opts.minSamplesLeaf || here.value === 0) {
      makeLeaf();
      continue;
    }
    // Which features this node may split on.
    let features = Array.from({ length: d }, (_, j) => j);
    if (opts.featuresPerSplit && opts.featuresPerSplit < d) features = opts.rng.shuffle(features).slice(0, opts.featuresPerSplit);
    let best: { j: number; t: number; imp: number; left: number[]; right: number[] } | null = null;
    let candidates = 0;
    for (const j of features) {
      const sorted = idx.map((i) => X[i]![j]!).sort((a, b) => a - b);
      const uniq = sorted.filter((v, k) => k === 0 || v !== sorted[k - 1]);
      let thresholds: number[] = [];
      for (let k = 0; k < uniq.length - 1; k++) thresholds.push((uniq[k]! + uniq[k + 1]!) / 2);
      if (thresholds.length > opts.maxCandidates) {
        const stride = thresholds.length / opts.maxCandidates;
        thresholds = Array.from({ length: opts.maxCandidates }, (_, k) => thresholds[Math.floor(k * stride)]!);
      }
      for (const t of thresholds) {
        candidates += 1;
        const left: number[] = [];
        const right: number[] = [];
        for (const i of idx) (X[i]![j]! <= t ? left : right).push(i);
        if (left.length < opts.minSamplesLeaf || right.length < opts.minSamplesLeaf) continue;
        const imp = (impurity(left, y, ctx.task, nClasses).value * left.length + impurity(right, y, ctx.task, nClasses).value * right.length) / idx.length;
        if (!best || imp < best.imp) best = { j, t, imp, left, right };
      }
    }
    visited += 1;
    if (visited % 8 === 0) await ctx.tick();
    if (!best || best.imp >= here.value - 1e-12) {
      makeLeaf();
      continue;
    }
    node.feature = ctx.featureNames[best.j]!;
    node.threshold = round(best.t);
    node.value = round(leafValue);
    node.classCounts = here.counts;
    const leftId = model.nodes.length;
    model.nodes.push({ id: leftId, depth: depth + 1, samples: best.left.length, impurity: round(impurity(best.left, y, ctx.task, nClasses).value) });
    const rightId = model.nodes.length;
    model.nodes.push({ id: rightId, depth: depth + 1, samples: best.right.length, impurity: round(impurity(best.right, y, ctx.task, nClasses).value) });
    node.left = leftId;
    node.right = rightId;
    if (opts.emitSplits) ctx.emit({ type: "tree_split", at: Date.now(), step: { treeIndex: opts.treeIndex, nodeId, depth, samples: idx.length, impurityBefore: round(here.value), candidatesEvaluated: candidates, chosen: { feature: node.feature, threshold: node.threshold, impurityAfter: round(best.imp), gain: round(here.value - best.imp), left: best.left.length, right: best.right.length, leftId, rightId }, leaf: null, ms: Date.now() - start } });
    stack.push({ idx: best.left, depth: depth + 1, nodeId: leftId }, { idx: best.right, depth: depth + 1, nodeId: rightId });
  }
  return model;
}

export async function trainDecisionTree(ctx: TrainContext): Promise<TrainResult> {
  const rng = new Rng(ctx.seed);
  const indices = Array.from({ length: ctx.Xtrain.length }, (_, i) => i);
  const model = await growTree(ctx, indices, { maxDepth: ctx.hp.maxDepth, minSamplesLeaf: ctx.hp.minSamplesLeaf, featuresPerSplit: null, rng, treeIndex: 0, emitSplits: !ctx.quiet, maxCandidates: 32 });
  const leaves = model.nodes.filter((n) => n.feature === undefined).length;
  const depth = Math.max(...model.nodes.map((n) => n.depth));
  if (!ctx.quiet) ctx.emit({ type: "tree_built", at: Date.now(), treeIndex: 0, nodes: model.nodes.length, depth, leaves, oobScore: null, ms: 0, tree: model.nodes });
  return { model, epochs: [], iterations: model.nodes.length, lossCurve: [] };
}
