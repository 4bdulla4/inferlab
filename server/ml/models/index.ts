import type { Algorithm } from "@shared/ml";
import { ALGORITHMS, ML_LIMITS } from "../../../shared/ml";
import { trainRandomForest } from "./forest";
import { GradientModel, trainGradient, type GradientSpec } from "./gradient";
import { Rng } from "../random";
import { trainKnn } from "./knn";
import { trainNaiveBayes } from "./naiveBayes";
import { trainDecisionTree } from "./tree";
import type { ParamSnapshot } from "@shared/ml";
import type { TrainContext, TrainResult } from "./types";

/** Pipeline stages an algorithm never visits, with the reason the graph shows. */
export function skippedStages(algorithm: Algorithm): { stages: string[]; reason: string | null } {
  const family = ALGORITHMS.find((a) => a.id === algorithm)!.family;
  switch (family) {
    case "gradient":
      return { stages: [], reason: null };
    case "tree":
      return { stages: ["gradient", "backprop", "epoch"], reason: "Trees are grown by choosing splits, not by following a gradient; there are no gradients, no backpropagation and no epochs. Each split is one training step." };
    case "instance":
      return { stages: ["loss", "gradient", "backprop", "update", "epoch"], reason: "K-nearest neighbours has no parameters to fit: training stores the rows. What you can watch is each validation row finding its neighbours." };
    case "probabilistic":
      return { stages: ["loss", "gradient", "backprop", "epoch"], reason: "Naive Bayes is fitted in closed form: one pass computes each class's prior, means and variances. No loss is minimised iteratively." };
  }
}

/** The layer plan of a gradient model, shared by initialization and training so both see the same network. */
export function gradientSpec(ctx: TrainContext): GradientSpec | null {
  const hp = ctx.hp;
  switch (ctx.algorithm) {
    case "linear_regression":
      return { algorithm: ctx.algorithm, output: "regression", hidden: [] };
    case "logistic_regression":
      return { algorithm: ctx.algorithm, output: "softmax", hidden: [] };
    case "svm":
      return { algorithm: ctx.algorithm, output: "hinge", hidden: [], l2Override: 1 / Math.max(1e-6, hp.svmC * ctx.Xtrain.length) };
    case "neural_network": {
      const hidden = hp.hiddenLayers.slice(0, ML_LIMITS.maxHiddenLayers).map((w) => Math.max(1, Math.min(ML_LIMITS.maxHiddenWidth, Math.round(w))));
      return { algorithm: ctx.algorithm, output: ctx.task === "regression" ? "regression" : "softmax", hidden: hidden.length ? hidden : [8] };
    }
    default:
      return null;
  }
}

/**
 * The parameters a gradient model starts from. Built with the run's seed exactly
 * as training will build them, so the initialization stage shows the real
 * starting weights rather than a placeholder. Other families start empty.
 */
export function initialParams(ctx: TrainContext): ParamSnapshot {
  const spec = gradientSpec(ctx);
  if (!spec) return { count: 0, norm: 0, groups: [] };
  const d = ctx.Xtrain[0]!.length;
  const outSize = spec.output === "regression" ? 1 : ctx.classes!.length;
  return new GradientModel(spec.algorithm, ctx.task, spec.output, ctx.classes, [d, ...spec.hidden, outSize], ctx.hp.activation, new Rng(ctx.seed), ctx.featureNames).params();
}

export async function trainModel(ctx: TrainContext): Promise<TrainResult> {
  const spec = gradientSpec(ctx);
  if (spec) return trainGradient(ctx, spec);
  switch (ctx.algorithm) {
    case "decision_tree":
      return trainDecisionTree(ctx);
    case "random_forest":
      return trainRandomForest(ctx);
    case "knn":
      return trainKnn(ctx);
    case "naive_bayes":
      return trainNaiveBayes(ctx);
    default:
      throw new Error(`Unknown algorithm ${ctx.algorithm as string}`);
  }
}

export type { TrainContext, TrainResult, FittedModel } from "./types";
