import type { Activation, Algorithm, EpochReport, GradientSnapshot, Hyperparameters, NetworkArchitecture, ParamSnapshot, PredictionTrace, TrainStep } from "@shared/ml";
import { better, classificationMetrics, headline, regressionMetrics } from "../metrics";
import { Rng } from "../random";
import { argmax, mean, round, snapshotGroups, softmax, SNAPSHOT_VALUES, type FittedModel, type TrainContext, type TrainResult } from "./types";

/**
 * Mini-batch gradient descent shared by every model that learns by following a
 * gradient. A model supplies a forward pass and a backward pass over flat
 * parameter groups; this file supplies batching, the optimizer, regularization,
 * gradient clipping, per-epoch validation with checkpointing, and the events
 * that describe each step exactly as it happened.
 */

export interface Layer {
  name: string;
  W: Float64Array; // in × out, row-major
  b: Float64Array; // out
  inSize: number;
  outSize: number;
  activation: Activation | "linear" | "softmax";
}

export interface ForwardCache {
  /** Inputs to each layer, then the final output. */
  inputs: number[][][];
  /** Pre-activation values per layer. */
  z: number[][][];
  outputs: number[][];
}

export type OutputKind = "regression" | "softmax" | "hinge";

const CLIP_NORM = 10;

export class GradientModel implements FittedModel {
  readonly layers: Layer[];
  constructor(
    readonly algorithm: Algorithm,
    readonly task: "classification" | "regression",
    readonly output: OutputKind,
    readonly classes: string[] | null,
    sizes: number[],
    activation: Activation,
    rng: Rng,
    readonly featureNames: string[],
  ) {
    this.layers = [];
    for (let i = 0; i < sizes.length - 1; i++) {
      const inSize = sizes[i]!;
      const outSize = sizes[i + 1]!;
      const last = i === sizes.length - 2;
      // He/Xavier-style scale so the first forward pass is neither dead nor saturated.
      const scale = last || activation !== "relu" ? Math.sqrt(1 / inSize) : Math.sqrt(2 / inSize);
      const W = new Float64Array(inSize * outSize);
      for (let k = 0; k < W.length; k++) W[k] = rng.normal() * scale;
      this.layers.push({ name: sizes.length === 2 ? "weights" : last ? "output" : `hidden ${i + 1}`, W, b: new Float64Array(outSize), inSize, outSize, activation: last ? (output === "softmax" ? "softmax" : "linear") : activation });
    }
  }

  forward(X: number[][]): ForwardCache {
    const inputs: number[][][] = [];
    const z: number[][][] = [];
    let cur = X;
    for (const L of this.layers) {
      inputs.push(cur);
      const pre = cur.map((x) => {
        const out = new Array<number>(L.outSize);
        for (let o = 0; o < L.outSize; o++) {
          let s = L.b[o]!;
          for (let i = 0; i < L.inSize; i++) s += x[i]! * L.W[i * L.outSize + o]!;
          out[o] = s;
        }
        return out;
      });
      z.push(pre);
      cur = pre.map((row) => activate(row, L.activation));
    }
    return { inputs, z, outputs: cur };
  }

  predict(X: number[][]): number[] {
    const out = this.forward(X).outputs;
    return this.output === "regression" ? out.map((o) => o[0]!) : out.map(argmax);
  }

  predictProba(X: number[][]): number[][] | undefined {
    if (this.output !== "softmax") return undefined;
    return this.forward(X).outputs;
  }

  scores(X: number[][]): number[][] {
    return this.forward(X).outputs;
  }

  params(): ParamSnapshot {
    return snapshotGroups(this.layers.flatMap((L) => [{ name: `${L.name} W`, shape: [L.inSize, L.outSize], values: L.W }, { name: `${L.name} b`, shape: [L.outSize], values: L.b }]));
  }

  describe() {
    const architecture: NetworkArchitecture | null = this.layers.length > 1 ? { layers: [{ name: "input", units: this.layers[0]!.inSize, activation: "linear" }, ...this.layers.map((L) => ({ name: L.name, units: L.outSize, activation: L.activation }))], paramCount: this.layers.reduce((n, L) => n + L.W.length + L.b.length, 0) } : null;
    return { architecture };
  }

  importance(featureNames: string[]) {
    if (this.layers.length !== 1) return null;
    const L = this.layers[0]!;
    const values = featureNames.map((feature, i) => {
      let s = 0;
      for (let o = 0; o < L.outSize; o++) s += Math.abs(L.W[i * L.outSize + o]!);
      return { feature, importance: s / L.outSize };
    });
    const total = values.reduce((s, v) => s + v.importance, 0) || 1;
    return { method: "coefficients" as const, values: values.map((v) => ({ ...v, importance: round(v.importance / total) })).sort((a, b) => b.importance - a.importance) };
  }

  trace(x: number[]): Partial<PredictionTrace> {
    const cache = this.forward([x]);
    const layers = this.layers.map((L, i) => ({ name: L.name, values: cache.z[i]![0]!.slice(0, SNAPSHOT_VALUES).map((v) => round(v)), truncated: L.outSize > SNAPSHOT_VALUES }));
    const out = cache.outputs[0]!;
    if (this.output === "regression") return { layers, probabilities: null, prediction: out[0]! };
    if (this.output === "softmax") return { layers, probabilities: out.map((v) => round(v)), prediction: argmax(out) };
    return { layers, probabilities: null, prediction: argmax(out) };
  }

  toJSON() {
    return { algorithm: this.algorithm, task: this.task, output: this.output, classes: this.classes, featureNames: this.featureNames, layers: this.layers.map((L) => ({ name: L.name, inSize: L.inSize, outSize: L.outSize, activation: L.activation, W: Array.from(L.W), b: Array.from(L.b) })) };
  }
}

export function activate(row: number[], a: Layer["activation"]): number[] {
  switch (a) {
    case "relu":
      return row.map((v) => (v > 0 ? v : 0));
    case "tanh":
      return row.map(Math.tanh);
    case "sigmoid":
      return row.map((v) => 1 / (1 + Math.exp(-v)));
    case "softmax":
      return softmax(row);
    default:
      return row;
  }
}

function activationGrad(z: number, a: Activation): number {
  switch (a) {
    case "relu":
      return z > 0 ? 1 : 0;
    case "tanh": {
      const t = Math.tanh(z);
      return 1 - t * t;
    }
    case "sigmoid": {
      const s = 1 / (1 + Math.exp(-z));
      return s * (1 - s);
    }
  }
}

/* ────────────────────────────── optimizer ───────────────────────────── */

class Optimizer {
  private m: Float64Array[];
  private v: Float64Array[];
  private t = 0;
  constructor(private readonly kind: Hyperparameters["optimizer"], sizes: number[]) {
    this.m = sizes.map((n) => new Float64Array(n));
    this.v = sizes.map((n) => new Float64Array(n));
  }
  /** Applies one update; returns the L2 norm of the parameter change. */
  step(params: Float64Array[], grads: Float64Array[], lr: number): number {
    this.t += 1;
    let sq = 0;
    for (let g = 0; g < params.length; g++) {
      const p = params[g]!;
      const grad = grads[g]!;
      const m = this.m[g]!;
      const v = this.v[g]!;
      for (let i = 0; i < p.length; i++) {
        let delta: number;
        if (this.kind === "sgd") delta = -lr * grad[i]!;
        else if (this.kind === "momentum") {
          m[i] = 0.9 * m[i]! + grad[i]!;
          delta = -lr * m[i]!;
        } else {
          m[i] = 0.9 * m[i]! + 0.1 * grad[i]!;
          v[i] = 0.999 * v[i]! + 0.001 * grad[i]! * grad[i]!;
          const mhat = m[i]! / (1 - 0.9 ** this.t);
          const vhat = v[i]! / (1 - 0.999 ** this.t);
          delta = (-lr * mhat) / (Math.sqrt(vhat) + 1e-8);
        }
        p[i] = p[i]! + delta;
        sq += delta * delta;
      }
    }
    return Math.sqrt(sq);
  }
}

/* ─────────────────────────────── training ───────────────────────────── */

export interface GradientSpec {
  algorithm: Algorithm;
  output: OutputKind;
  hidden: number[];
  /** Overrides the config's regularization for SVM, whose C plays that role. */
  l2Override?: number;
}

export async function trainGradient(ctx: TrainContext, spec: GradientSpec): Promise<TrainResult> {
  const { hp, Xtrain, ytrain, Xval, yval, task, classes } = ctx;
  const d = Xtrain[0]!.length;
  const outSize = spec.output === "regression" ? 1 : classes!.length;
  const rng = new Rng(ctx.seed);
  const model = new GradientModel(spec.algorithm, task, spec.output, classes, [d, ...spec.hidden, outSize], hp.activation, rng, ctx.featureNames);
  const paramArrays = model.layers.flatMap((L) => [L.W, L.b]);
  const opt = new Optimizer(hp.optimizer, paramArrays.map((p) => p.length));
  const lr = hp.learningRate;
  const l2 = spec.l2Override ?? (hp.regularization === "l2" ? hp.regularizationStrength : 0);
  const l1 = spec.l2Override === undefined && hp.regularization === "l1" ? hp.regularizationStrength : 0;
  const batchSize = Math.max(1, Math.min(hp.batchSize, Xtrain.length));
  const batchesPerEpoch = Math.ceil(Xtrain.length / batchSize);
  const epochs: EpochReport[] = [];
  const lossCurve: TrainResult["lossCurve"] = [];
  const hl = task === "classification" ? { name: "accuracy", higherIsBetter: true } : { name: "rmse", higherIsBetter: false };
  let best: { metric: number; params: Float64Array[]; epoch: number } | null = null;
  let iteration = 0;
  const order = Array.from({ length: Xtrain.length }, (_, i) => i);

  for (let epoch = 1; epoch <= hp.epochs; epoch++) {
    const epochStart = Date.now();
    const shuffled = rng.shuffle(order);
    let epochLoss = 0;
    for (let b = 0; b < batchesPerEpoch; b++) {
      const stepStart = Date.now();
      const idx = shuffled.slice(b * batchSize, (b + 1) * batchSize);
      const X = idx.map((i) => Xtrain[i]!);
      const y = idx.map((i) => ytrain[i]!);
      const cache = model.forward(X);
      const { loss, dataTerm, grads, backward } = backprop(model, cache, y, spec.output, l2, l1, classes?.length ?? 1);
      // Clip by global norm so one wild batch cannot blow the parameters up.
      let gsq = 0;
      for (const g of grads) for (let i = 0; i < g.length; i++) gsq += g[i]! * g[i]!;
      const gnorm = Math.sqrt(gsq);
      const clipped = gnorm > CLIP_NORM;
      if (clipped) for (const g of grads) for (let i = 0; i < g.length; i++) g[i] = (g[i]! * CLIP_NORM) / gnorm;
      const gradientSnapshot: GradientSnapshot = { norm: clipped ? CLIP_NORM : gnorm, groups: model.layers.flatMap((L, li) => [{ name: `${L.name} W`, norm: normOf(grads[li * 2]!), values: Array.from(grads[li * 2]!.slice(0, SNAPSHOT_VALUES)).map((v) => round(v, 6)), truncated: grads[li * 2]!.length > SNAPSHOT_VALUES }, { name: `${L.name} b`, norm: normOf(grads[li * 2 + 1]!), values: Array.from(grads[li * 2 + 1]!.slice(0, SNAPSHOT_VALUES)).map((v) => round(v, 6)), truncated: false }]), clipped };
      const stepNorm = opt.step(paramArrays, grads, lr);
      iteration += 1;
      epochLoss += loss;
      if (!ctx.quiet && (iteration % ctx.stride === 0 || iteration === 1)) {
        const shown = Math.min(6, X.length);
        const step: TrainStep = {
          iteration,
          epoch,
          batch: b + 1,
          batchesPerEpoch,
          batchSize: X.length,
          forward: {
            indices: idx.slice(0, shown),
            predictions: cache.outputs.slice(0, shown).map((o) => o.map((v) => round(v))),
            targets: y.slice(0, shown),
            activations: model.layers.length > 1 ? model.layers.map((L, li) => ({ layer: L.name, values: activate(cache.z[li]![0]!, L.activation).slice(0, SNAPSHOT_VALUES).map((v) => round(v)), truncated: L.outSize > SNAPSHOT_VALUES })) : undefined,
          },
          loss: { value: round(loss, 6), dataTerm: round(dataTerm, 6), regularizationTerm: round(loss - dataTerm, 6), kind: spec.output === "regression" ? "mean squared error" : spec.output === "softmax" ? "cross-entropy" : "hinge" },
          gradient: gradientSnapshot,
          backward,
          update: { optimizer: hp.optimizer, learningRate: lr, stepNorm: round(stepNorm, 6), params: model.params() },
          ms: Date.now() - stepStart,
        };
        ctx.emit({ type: "train_step", at: Date.now(), step, detailed: ctx.stride === 1, stride: ctx.stride });
      }
      if (b % 4 === 3) await ctx.tick();
    }
    await ctx.tick();
    const trainLoss = epochLoss / batchesPerEpoch;
    const val = evaluate(model, Xval, yval, spec.output, classes);
    const isBest = !best || better(val.metric, best.metric, hl.higherIsBetter);
    if (isBest) best = { metric: val.metric, params: paramArrays.map((p) => Float64Array.from(p)), epoch };
    const report: EpochReport = { epoch, trainLoss: round(trainLoss, 6), validationLoss: val.loss === null ? null : round(val.loss, 6), validationMetric: { name: hl.name, value: round(val.metric, 6) }, ms: Date.now() - epochStart, bestSoFar: isBest };
    epochs.push(report);
    lossCurve.push({ epoch, train: report.trainLoss, validation: report.validationLoss });
    if (!ctx.quiet) ctx.emit({ type: "epoch_completed", at: Date.now(), report });
    if (!Number.isFinite(trainLoss)) {
      ctx.emit({ type: "notice", at: Date.now(), level: "warn", message: `The loss became ${trainLoss} at epoch ${epoch}; the learning rate is probably too high. Training stopped and the best earlier parameters were kept.` });
      break;
    }
  }
  // Checkpoint selection: the parameters from the best validation epoch are the model.
  if (best && best.epoch !== epochs.length) for (let g = 0; g < paramArrays.length; g++) paramArrays[g]!.set(best.params[g]!);
  return { model, epochs, iterations: iteration, lossCurve };
}

function normOf(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s);
}

/** Loss for the batch and the gradient of every parameter, by backpropagation through the layers. */
function backprop(model: GradientModel, cache: ForwardCache, y: number[], output: OutputKind, l2: number, l1: number, nClasses: number) {
  const n = y.length;
  const layers = model.layers;
  const out = cache.outputs;
  let dataTerm = 0;
  // dL/dz for the output layer.
  let delta: number[][];
  if (output === "regression") {
    delta = out.map((o, i) => {
      const e = o[0]! - y[i]!;
      dataTerm += e * e;
      return [(2 * e) / n];
    });
    dataTerm /= n;
  } else if (output === "softmax") {
    delta = out.map((p, i) => {
      dataTerm -= Math.log(Math.max(1e-12, p[y[i]!]!));
      return p.map((v, c) => (v - (c === y[i] ? 1 : 0)) / n);
    });
    dataTerm /= n;
  } else {
    // One-vs-rest hinge: target +1 for the true class, -1 otherwise.
    delta = out.map((s, i) =>
      s.map((v, c) => {
        const t = c === y[i] ? 1 : -1;
        const margin = 1 - t * v;
        if (margin > 0) dataTerm += margin;
        return margin > 0 ? -t / n : 0;
      }),
    );
    dataTerm /= n * Math.max(1, nClasses);
  }
  const grads: Float64Array[] = [];
  const backward: TrainStep["backward"] = [];
  for (let li = layers.length - 1; li >= 0; li--) {
    const L = layers[li]!;
    const inputs = cache.inputs[li]!;
    const gW = new Float64Array(L.W.length);
    const gb = new Float64Array(L.b.length);
    for (let r = 0; r < n; r++) {
      const x = inputs[r]!;
      const dz = delta[r]!;
      for (let o = 0; o < L.outSize; o++) {
        gb[o] = gb[o]! + dz[o]!;
        for (let i = 0; i < L.inSize; i++) gW[i * L.outSize + o] = gW[i * L.outSize + o]! + x[i]! * dz[o]!;
      }
    }
    for (let k = 0; k < L.W.length; k++) gW[k] = gW[k]! + l2 * L.W[k]! + l1 * Math.sign(L.W[k]!);
    let deltaNorm = 0;
    for (const dz of delta) for (const v of dz) deltaNorm += v * v;
    backward.unshift({ layer: L.name, gradNorm: round(Math.sqrt(normOf(gW) ** 2 + normOf(gb) ** 2), 6), deltaNorm: round(Math.sqrt(deltaNorm), 6) });
    grads.unshift(gW, gb);
    if (li > 0) {
      const prev = layers[li - 1]!;
      const zPrev = cache.z[li - 1]!;
      delta = delta.map((dz, r) => {
        const dx = new Array<number>(L.inSize).fill(0);
        for (let i = 0; i < L.inSize; i++) {
          let s = 0;
          for (let o = 0; o < L.outSize; o++) s += L.W[i * L.outSize + o]! * dz[o]!;
          dx[i] = s * (prev.activation === "linear" || prev.activation === "softmax" ? 1 : activationGrad(zPrev[r]![i]!, prev.activation));
        }
        return dx;
      });
    }
  }
  let reg = 0;
  for (const L of layers) for (let k = 0; k < L.W.length; k++) reg += (l2 / 2) * L.W[k]! * L.W[k]! + l1 * Math.abs(L.W[k]!);
  return { loss: dataTerm + reg, dataTerm, grads, backward };
}

/** Validation loss and headline metric for the current parameters. */
export function evaluate(model: GradientModel, X: number[][], y: number[], output: OutputKind, classes: string[] | null): { loss: number | null; metric: number } {
  if (X.length === 0) return { loss: null, metric: output === "regression" ? Infinity : 0 };
  const out = model.forward(X).outputs;
  if (output === "regression") {
    const pred = out.map((o) => o[0]!);
    const m = regressionMetrics(pred, y);
    return { loss: m.mse, metric: m.rmse };
  }
  const pred = out.map(argmax);
  const m = classificationMetrics(pred, y, classes!, output === "softmax" ? out : null);
  const loss = output === "softmax" ? m.logLoss : mean(out.map((s, i) => s.reduce((acc, v, c) => acc + Math.max(0, 1 - (c === y[i] ? 1 : -1) * v), 0) / s.length));
  return { loss, metric: headline(m).value };
}
