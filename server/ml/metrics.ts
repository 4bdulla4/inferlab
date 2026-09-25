import type { ClassificationMetrics, Metrics, RegressionMetrics } from "@shared/ml";

export function regressionMetrics(pred: number[], y: number[]): RegressionMetrics {
  const n = y.length;
  let se = 0;
  let ae = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i]!;
  mean /= Math.max(1, n);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = pred[i]! - y[i]!;
    se += d * d;
    ae += Math.abs(d);
    ss += (y[i]! - mean) ** 2;
  }
  const mse = n ? se / n : 0;
  return { task: "regression", mse, rmse: Math.sqrt(mse), mae: n ? ae / n : 0, r2: ss ? 1 - se / ss : 0, n };
}

export function classificationMetrics(pred: number[], y: number[], classes: string[], proba: number[][] | null, scores: number[][] | null = null): ClassificationMetrics {
  const k = classes.length;
  const matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  let correct = 0;
  for (let i = 0; i < y.length; i++) {
    const t = y[i]!;
    const p = pred[i]!;
    if (t >= 0 && t < k && p >= 0 && p < k) matrix[t]![p]! += 1;
    if (t === p) correct += 1;
  }
  let precision = 0;
  let recall = 0;
  let f1 = 0;
  for (let c = 0; c < k; c++) {
    const tp = matrix[c]![c]!;
    const fp = matrix.reduce((s, row, r) => s + (r === c ? 0 : row[c]!), 0);
    const fn = matrix[c]!.reduce((s, v, p) => s + (p === c ? 0 : v), 0);
    const pr = tp + fp ? tp / (tp + fp) : 0;
    const rc = tp + fn ? tp / (tp + fn) : 0;
    precision += pr;
    recall += rc;
    f1 += pr + rc ? (2 * pr * rc) / (pr + rc) : 0;
  }
  const n = y.length;
  let logLoss: number | null = null;
  if (proba) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum -= Math.log(Math.max(1e-12, proba[i]![y[i]!] ?? 1e-12));
    logLoss = n ? sum / n : 0;
  }
  const rank = proba ?? scores;
  return {
    task: "classification",
    accuracy: n ? correct / n : 0,
    precisionMacro: k ? precision / k : 0,
    recallMacro: k ? recall / k : 0,
    f1Macro: k ? f1 / k : 0,
    logLoss,
    confusion: { classes, matrix },
    roc: rank ? classes.map((c, ci) => ({ className: c, ...roc(rank.map((r) => r[ci] ?? 0), y.map((t) => (t === ci ? 1 : 0))) })) : null,
    pr: rank ? classes.map((c, ci) => ({ className: c, ...precisionRecall(rank.map((r) => r[ci] ?? 0), y.map((t) => (t === ci ? 1 : 0))) })) : null,
    n,
  };
}

/** ROC curve and AUC by sweeping the score threshold. */
export function roc(score: number[], positive: number[]): { points: { fpr: number; tpr: number }[]; auc: number } {
  const order = score.map((_, i) => i).sort((a, b) => score[b]! - score[a]!);
  const P = positive.reduce((s, v) => s + v, 0);
  const N = positive.length - P;
  const points: { fpr: number; tpr: number }[] = [{ fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  let auc = 0;
  let prevFpr = 0;
  let prevTpr = 0;
  for (let i = 0; i < order.length; i++) {
    if (positive[order[i]!]) tp += 1;
    else fp += 1;
    if (i + 1 < order.length && score[order[i + 1]!] === score[order[i]!]) continue;
    const tpr = P ? tp / P : 0;
    const fpr = N ? fp / N : 0;
    auc += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
    prevFpr = fpr;
    prevTpr = tpr;
    points.push({ fpr, tpr });
  }
  if (points.at(-1)!.fpr !== 1 || points.at(-1)!.tpr !== 1) points.push({ fpr: 1, tpr: 1 });
  return { points: thin(points, 60), auc: P && N ? auc : 0 };
}

export function precisionRecall(score: number[], positive: number[]): { points: { recall: number; precision: number }[]; ap: number } {
  const order = score.map((_, i) => i).sort((a, b) => score[b]! - score[a]!);
  const P = positive.reduce((s, v) => s + v, 0);
  const points: { recall: number; precision: number }[] = [];
  let tp = 0;
  let ap = 0;
  let prevRecall = 0;
  for (let i = 0; i < order.length; i++) {
    if (positive[order[i]!]) tp += 1;
    const precision = tp / (i + 1);
    const recall = P ? tp / P : 0;
    if (positive[order[i]!]) ap += precision * (recall - prevRecall);
    prevRecall = recall;
    points.push({ recall, precision });
  }
  return { points: thin(points, 60), ap: P ? ap : 0 };
}

function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const stride = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * stride)]!);
}

/** The single number a run is judged by, and whether bigger is better. */
export function headline(m: Metrics): { name: string; value: number; higherIsBetter: boolean } {
  return m.task === "classification" ? { name: "accuracy", value: m.accuracy, higherIsBetter: true } : { name: "rmse", value: m.rmse, higherIsBetter: false };
}

export function better(a: number, b: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? a > b : a < b;
}
