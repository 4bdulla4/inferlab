import type { ParamSnapshot, PredictionTrace } from "@shared/ml";
import { argmax, mean, round, type FittedModel, type TrainContext, type TrainResult } from "./types";

/** Stores the training rows; a prediction is a vote or average over the K nearest by Euclidean distance. */
export class KnnModel implements FittedModel {
  readonly algorithm = "knn" as const;
  constructor(readonly task: "classification" | "regression", readonly classes: string[] | null, readonly featureNames: string[], readonly X: number[][], readonly y: number[], readonly k: number) {}

  neighbours(x: number[]): { index: number; distance: number; target: number }[] {
    const dists = this.X.map((row, i) => {
      let s = 0;
      for (let j = 0; j < row.length; j++) s += (row[j]! - x[j]!) ** 2;
      return { index: i, distance: Math.sqrt(s), target: this.y[i]! };
    });
    dists.sort((a, b) => a.distance - b.distance);
    return dists.slice(0, Math.min(this.k, dists.length));
  }

  combine(nb: { target: number }[]): number {
    if (this.task === "regression") return mean(nb.map((n) => n.target));
    const counts = new Array<number>(this.classes!.length).fill(0);
    for (const n of nb) counts[n.target]! += 1;
    return argmax(counts);
  }

  predict(X: number[][]): number[] {
    return X.map((x) => this.combine(this.neighbours(x)));
  }

  predictProba(X: number[][]): number[][] | undefined {
    if (this.task !== "classification") return undefined;
    return X.map((x) => {
      const nb = this.neighbours(x);
      const counts = new Array<number>(this.classes!.length).fill(0);
      for (const n of nb) counts[n.target]! += 1;
      return counts.map((c) => c / nb.length);
    });
  }

  params(): ParamSnapshot {
    const flat = this.X.flat();
    return { count: flat.length, norm: Math.sqrt(flat.reduce((s, v) => s + v * v, 0)), groups: [{ name: `stored training rows (${this.X.length} × ${this.featureNames.length})`, shape: [this.X.length, this.featureNames.length], values: flat.slice(0, 64).map((v) => round(v)), truncated: flat.length > 64, norm: Math.sqrt(flat.reduce((s, v) => s + v * v, 0)) }] };
  }

  describe() {
    return {};
  }

  trace(x: number[]): Partial<PredictionTrace> {
    const nb = this.neighbours(x).map((n) => ({ ...n, distance: round(n.distance) }));
    return { neighbours: nb, probabilities: this.task === "classification" ? this.predictProba([x])![0]! : null, prediction: this.combine(nb) };
  }

  toJSON() {
    return { algorithm: this.algorithm, task: this.task, classes: this.classes, featureNames: this.featureNames, k: this.k, X: this.X, y: this.y };
  }
}

export async function trainKnn(ctx: TrainContext): Promise<TrainResult> {
  const k = Math.max(1, Math.min(ctx.hp.k, ctx.Xtrain.length));
  const model = new KnnModel(ctx.task, ctx.classes, ctx.featureNames, ctx.Xtrain, ctx.ytrain, k);
  if (!ctx.quiet) ctx.emit({ type: "knn_indexed", at: Date.now(), stored: ctx.Xtrain.length, features: ctx.featureNames.length, k });
  // "Training" is storing the rows; what can be watched is the validation rows finding their neighbours.
  const shown = Math.min(ctx.Xval.length, 40);
  for (let i = 0; i < ctx.Xval.length; i++) {
    const start = Date.now();
    const nb = model.neighbours(ctx.Xval[i]!);
    if (!ctx.quiet && (i < shown || i % ctx.stride === 0)) ctx.emit({ type: "knn_query", at: Date.now(), step: { queryIndex: i, neighbours: nb.map((n) => ({ ...n, distance: round(n.distance) })), prediction: model.combine(nb), target: ctx.yval[i]!, ms: Date.now() - start }, detailed: i < shown });
    if (i % 10 === 9) await ctx.tick();
  }
  return { model, epochs: [], iterations: ctx.Xval.length, lossCurve: [] };
}
