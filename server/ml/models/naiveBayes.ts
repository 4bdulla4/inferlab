import type { ParamSnapshot, PredictionTrace } from "@shared/ml";
import { argmax, round, softmax, type FittedModel, type TrainContext, type TrainResult } from "./types";

/** Gaussian Naive Bayes: per class, a prior and a mean/variance per feature; features treated as independent. */
export class NaiveBayesModel implements FittedModel {
  readonly algorithm = "naive_bayes" as const;
  readonly task = "classification" as const;
  priors: number[] = [];
  means: number[][] = [];
  variances: number[][] = [];
  constructor(readonly classes: string[], readonly featureNames: string[]) {}

  logScores(x: number[]): number[] {
    return this.classes.map((_, c) => {
      let s = Math.log(this.priors[c]!);
      for (let j = 0; j < x.length; j++) {
        const v = this.variances[c]![j]!;
        const m = this.means[c]![j]!;
        s += -0.5 * Math.log(2 * Math.PI * v) - ((x[j]! - m) ** 2) / (2 * v);
      }
      return s;
    });
  }

  predict(X: number[][]): number[] {
    return X.map((x) => argmax(this.logScores(x)));
  }

  predictProba(X: number[][]): number[][] {
    return X.map((x) => softmax(this.logScores(x)));
  }

  params(): ParamSnapshot {
    const means = this.means.flat();
    const vars = this.variances.flat();
    const norm = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    return { count: this.priors.length + means.length + vars.length, norm: Math.sqrt(norm(this.priors) ** 2 + norm(means) ** 2 + norm(vars) ** 2), groups: [{ name: "class priors", shape: [this.priors.length], values: this.priors.map((v) => round(v)), truncated: false, norm: norm(this.priors) }, { name: "means (class × feature)", shape: [this.classes.length, this.featureNames.length], values: means.slice(0, 64).map((v) => round(v)), truncated: means.length > 64, norm: norm(means) }, { name: "variances (class × feature)", shape: [this.classes.length, this.featureNames.length], values: vars.slice(0, 64).map((v) => round(v)), truncated: vars.length > 64, norm: norm(vars) }] };
  }

  describe() {
    return {};
  }

  trace(x: number[]): Partial<PredictionTrace> {
    const scores = this.logScores(x);
    return { classScores: this.classes.map((className, c) => ({ className, logScore: round(scores[c]!) })), probabilities: softmax(scores).map((v) => round(v)), prediction: argmax(scores) };
  }

  toJSON() {
    return { algorithm: this.algorithm, task: this.task, classes: this.classes, featureNames: this.featureNames, priors: this.priors, means: this.means, variances: this.variances };
  }
}

export async function trainNaiveBayes(ctx: TrainContext): Promise<TrainResult> {
  const classes = ctx.classes!;
  const model = new NaiveBayesModel(classes, ctx.featureNames);
  const d = ctx.Xtrain[0]!.length;
  const n = ctx.Xtrain.length;
  // Variance smoothing keeps a constant feature from producing an infinite density.
  const eps = 1e-3;
  for (let c = 0; c < classes.length; c++) {
    const rows = ctx.Xtrain.filter((_, i) => ctx.ytrain[i] === c);
    const prior = Math.max(1e-9, rows.length / n);
    const means = new Array<number>(d).fill(0);
    const vars = new Array<number>(d).fill(0);
    for (const r of rows) for (let j = 0; j < d; j++) means[j]! += r[j]! / Math.max(1, rows.length);
    for (const r of rows) for (let j = 0; j < d; j++) vars[j]! += (r[j]! - means[j]!) ** 2 / Math.max(1, rows.length);
    for (let j = 0; j < d; j++) vars[j]! += eps;
    model.priors.push(prior);
    model.means.push(means);
    model.variances.push(vars);
    if (!ctx.quiet) ctx.emit({ type: "nb_class_fitted", at: Date.now(), step: { classIndex: c, className: classes[c]!, prior: round(prior), featureStats: ctx.featureNames.map((feature, j) => ({ feature, mean: round(means[j]!), variance: round(vars[j]!) })), samples: rows.length } });
    await ctx.tick();
  }
  return { model, epochs: [], iterations: classes.length, lossCurve: [] };
}
