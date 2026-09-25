import type { Algorithm, EpochReport, Hyperparameters, MLEvent, MLTask, NetworkArchitecture, ParamSnapshot, PredictionTrace, TreeNode } from "@shared/ml";

export interface TrainContext {
  algorithm: Algorithm;
  task: MLTask;
  classes: string[] | null;
  featureNames: string[];
  Xtrain: number[][];
  ytrain: number[];
  Xval: number[][];
  yval: number[];
  hp: Hyperparameters;
  seed: number;
  emit: (e: MLEvent) => void;
  /** Candidate runs in a sweep train for real but do not draw their steps. */
  quiet: boolean;
  signal: AbortSignal;
  /** Yields to the event loop so events flush and STOP is honoured; throws when aborted. */
  tick: () => Promise<void>;
  /** Detailed step events are emitted every `stride` steps. */
  stride: number;
}

export interface FittedModel {
  algorithm: Algorithm;
  task: MLTask;
  predict(X: number[][]): number[];
  /** Class probabilities, rows × classes. */
  predictProba?(X: number[][]): number[][] | undefined;
  /** Ranking scores when there are no probabilities (SVM), for ROC curves. */
  scores?(X: number[][]): number[][];
  params(): ParamSnapshot;
  describe(): { architecture?: NetworkArchitecture | null; tree?: TreeNode[] | null; forest?: { trees: number; nodes: number } | null };
  /** Native feature importance, when the algorithm has one. */
  importance?(featureNames: string[]): { method: "coefficients" | "impurity decrease"; values: { feature: string; importance: number }[] } | null;
  trace(x: number[]): Partial<PredictionTrace>;
  toJSON(): unknown;
}

export interface TrainResult {
  model: FittedModel;
  epochs: EpochReport[];
  iterations: number;
  lossCurve: { epoch: number; train: number; validation: number | null }[];
}

export const SNAPSHOT_VALUES = 64;

export function snapshotGroups(groups: { name: string; shape: number[]; values: ArrayLike<number> }[]): ParamSnapshot {
  let count = 0;
  let sq = 0;
  const out = groups.map((g) => {
    let gsq = 0;
    for (let i = 0; i < g.values.length; i++) gsq += g.values[i]! * g.values[i]!;
    count += g.values.length;
    sq += gsq;
    return { name: g.name, shape: g.shape, values: Array.from({ length: Math.min(SNAPSHOT_VALUES, g.values.length) }, (_, i) => round(g.values[i]!)), truncated: g.values.length > SNAPSHOT_VALUES, norm: Math.sqrt(gsq) };
  });
  return { count, norm: Math.sqrt(sq), groups: out };
}

export function round(v: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function argmax(v: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i]! > v[best]!) best = i;
  return best;
}

export function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
