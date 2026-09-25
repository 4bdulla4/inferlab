import type { ColumnSummary, EncodeReport, ImputeReport, MLConfig, MLTask, ScaleReport, SplitReport } from "@shared/ml";
import { ML_LIMITS } from "../../shared/ml";
import { isMissing, summarizeColumn, toNumber, type RawTable } from "./data";
import { Rng } from "./random";

/**
 * Everything between raw strings and the matrices a model trains on. Each step
 * returns a report of exactly what it did, and the fitted transformations are
 * kept so a new row can be pushed through the same path at prediction time.
 */

export interface Identified {
  features: string[];
  target: string;
  task: MLTask;
  classes: string[] | null;
  reason: string;
  columns: ColumnSummary[];
}

export function identify(table: RawTable, config: MLConfig): Identified {
  const columns = table.columns.map((name, i) => summarizeColumn(name, table.rows.map((r) => r[i] ?? "")));
  const usable = columns.filter((c) => c.type !== "id" && c.type !== "constant" && c.type !== "text");
  let target = config.target && table.columns.includes(config.target) ? config.target : null;
  let reason = target ? "You chose the target column." : "";
  if (!target) {
    const last = [...usable].reverse().find((c) => !config.excluded.includes(c.name));
    if (!last) throw new Error("No usable column could serve as the target. Columns that are ids, constant, or free text cannot be predicted.");
    target = last.name;
    reason = "No target was chosen, so the last usable column is predicted, as in most tabular files.";
  }
  const tcol = columns.find((c) => c.name === target)!;
  const task: MLTask = tcol.type === "numeric" && tcol.unique > 12 ? "regression" : "classification";
  const features = usable.map((c) => c.name).filter((n) => n !== target && !config.excluded.includes(n));
  if (features.length === 0) throw new Error("At least one feature column is needed besides the target.");
  const idx = table.columns.indexOf(target);
  const classes = task === "classification" ? [...new Set(table.rows.map((r) => r[idx] ?? "").filter((v) => !isMissing(v)))].sort() : null;
  if (classes && classes.length < 2) throw new Error(`The target "${target}" has a single value, so there is nothing to classify.`);
  if (classes && classes.length > 20) throw new Error(`The target "${target}" has ${classes.length} distinct values; classification here supports up to 20 classes.`);
  reason += task === "classification" ? ` "${target}" has ${classes!.length} distinct values, so this is classification.` : ` "${target}" is numeric with many distinct values, so this is regression.`;
  return { features, target, task, classes, reason, columns };
}

export interface Cleaned {
  table: RawTable;
  rowsBefore: number;
  droppedRows: { emptyTarget: number; duplicates: number };
  droppedColumns: { name: string; reason: string }[];
}

export function clean(table: RawTable, id: Identified): Cleaned {
  const keep = [...id.features, id.target];
  const droppedColumns = table.columns
    .filter((c) => !keep.includes(c))
    .map((name) => {
      const col = id.columns.find((c) => c.name === name)!;
      return { name, reason: col.type === "id" ? "identifier: unique per row, carries no pattern" : col.type === "constant" ? "constant: the same value in every row" : col.type === "text" ? "free text: too many distinct values to encode" : "excluded by you" };
    });
  const idx = keep.map((c) => table.columns.indexOf(c));
  const tIdx = table.columns.indexOf(id.target);
  const seen = new Set<string>();
  let emptyTarget = 0;
  let duplicates = 0;
  const rows: string[][] = [];
  for (const r of table.rows) {
    if (isMissing(r[tIdx] ?? "")) {
      emptyTarget += 1;
      continue;
    }
    const projected = idx.map((i) => r[i] ?? "");
    const key = projected.join("\u0001");
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    rows.push(projected);
  }
  return { table: { columns: keep, rows }, rowsBefore: table.rows.length, droppedRows: { emptyTarget, duplicates }, droppedColumns };
}

export interface Imputer {
  column: string;
  kind: "numeric" | "categorical";
  strategy: MLConfig["impute"];
  fill: number | string | null;
}

export function impute(table: RawTable, id: Identified, strategy: MLConfig["impute"]): { table: RawTable; reports: ImputeReport[]; imputers: Imputer[]; rowsDropped: number } {
  const imputers: Imputer[] = [];
  const reports: ImputeReport[] = [];
  const cols = table.columns.map((name) => ({ name, col: id.columns.find((c) => c.name === name)! }));
  let rows = table.rows.map((r) => r.slice());
  let rowsDropped = 0;
  if (strategy === "drop") {
    const before = rows.length;
    rows = rows.filter((r) => r.every((v) => !isMissing(v)));
    rowsDropped = before - rows.length;
    for (const { name, col } of cols) if (col.missing > 0 && name !== id.target) reports.push({ column: name, strategy, filled: 0 });
    return { table: { columns: table.columns, rows }, reports, imputers, rowsDropped };
  }
  cols.forEach(({ name, col }, ci) => {
    if (name === id.target) return;
    const values = rows.map((r) => r[ci]!);
    const missingIdx = values.map((v, i) => (isMissing(v) ? i : -1)).filter((i) => i >= 0);
    let fill: number | string | null = null;
    const kind = col.type === "numeric" ? "numeric" : "categorical";
    if (kind === "numeric") {
      const nums = values.map(toNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
      const mean = nums.reduce((s, n) => s + n, 0) / Math.max(1, nums.length);
      const median = nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2]! : (nums[nums.length / 2 - 1]! + nums[nums.length / 2]!) / 2) : 0;
      fill = strategy === "mean" ? Math.round(mean * 1e6) / 1e6 : strategy === "mode" ? mode(nums.map(String)) : Math.round(median * 1e6) / 1e6;
      if (typeof fill === "string") fill = Number(fill);
    } else fill = mode(values.filter((v) => !isMissing(v)));
    imputers.push({ column: name, kind, strategy, fill });
    if (missingIdx.length) {
      for (const i of missingIdx) rows[i]![ci] = String(fill);
      reports.push({ column: name, strategy: kind === "numeric" ? strategy : "mode", filled: missingIdx.length, value: fill ?? undefined });
    }
  });
  return { table: { columns: table.columns, rows }, reports, imputers, rowsDropped };
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export interface Encoder {
  column: string;
  method: EncodeReport["method"];
  categories?: string[];
  /** Names of the produced feature columns, in order. */
  produced: string[];
}

export interface Encoded {
  X: number[][];
  y: number[];
  featureNames: string[];
  encoders: Encoder[];
  reports: EncodeReport[];
  targetEncoding: { method: "label" | "numeric"; classes?: string[] };
}

export function encode(table: RawTable, id: Identified): Encoded {
  const encoders: Encoder[] = [];
  const reports: EncodeReport[] = [];
  const featureNames: string[] = [];
  for (const name of id.features) {
    const col = id.columns.find((c) => c.name === name)!;
    const ci = table.columns.indexOf(name);
    const values = table.rows.map((r) => r[ci]!);
    if (col.type === "numeric") {
      encoders.push({ column: name, method: "passthrough", produced: [name] });
      reports.push({ column: name, method: "passthrough", producedColumns: [name] });
      featureNames.push(name);
    } else if (col.type === "boolean") {
      encoders.push({ column: name, method: "boolean", produced: [name] });
      reports.push({ column: name, method: "boolean", producedColumns: [name] });
      featureNames.push(name);
    } else {
      const categories = [...new Set(values)].sort();
      const produced = categories.map((c) => `${name}=${c}`);
      encoders.push({ column: name, method: "one-hot", categories, produced });
      reports.push({ column: name, method: "one-hot", categories, producedColumns: produced });
      featureNames.push(...produced);
    }
  }
  const X = table.rows.map((r) => encodeRow(r, table.columns, encoders));
  const tIdx = table.columns.indexOf(id.target);
  const y = table.rows.map((r) => (id.task === "classification" ? id.classes!.indexOf(r[tIdx]!) : (toNumber(r[tIdx]!) ?? 0)));
  return { X, y, featureNames, encoders, reports, targetEncoding: id.task === "classification" ? { method: "label", classes: id.classes! } : { method: "numeric" } };
}

const TRUE = new Set(["true", "yes", "y", "t", "1"]);

export function encodeRow(row: string[], columns: string[], encoders: Encoder[]): number[] {
  const out: number[] = [];
  for (const e of encoders) {
    const v = row[columns.indexOf(e.column)] ?? "";
    if (e.method === "passthrough") out.push(toNumber(v) ?? 0);
    else if (e.method === "boolean") out.push(TRUE.has(v.trim().toLowerCase()) ? 1 : 0);
    else for (const c of e.categories!) out.push(v === c ? 1 : 0);
  }
  return out;
}

export interface Scaler {
  method: MLConfig["scaling"];
  means: number[];
  stds: number[];
  mins: number[];
  maxs: number[];
}

/** Fitted on the training rows only, so validation and test never leak into the statistics. */
export function fitScaler(Xtrain: number[][], method: MLConfig["scaling"]): Scaler {
  const d = Xtrain[0]?.length ?? 0;
  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(1);
  const mins = new Array<number>(d).fill(0);
  const maxs = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let s = 0;
    let mn = Infinity;
    let mx = -Infinity;
    for (const r of Xtrain) {
      s += r[j]!;
      mn = Math.min(mn, r[j]!);
      mx = Math.max(mx, r[j]!);
    }
    const m = s / Math.max(1, Xtrain.length);
    let v = 0;
    for (const r of Xtrain) v += (r[j]! - m) ** 2;
    means[j] = m;
    stds[j] = Math.sqrt(v / Math.max(1, Xtrain.length)) || 1;
    mins[j] = mn;
    maxs[j] = mx === mn ? mn + 1 : mx;
  }
  return { method, means, stds, mins, maxs };
}

export function applyScaler(x: number[], s: Scaler): number[] {
  if (s.method === "none") return x.slice();
  return x.map((v, j) => (s.method === "standard" ? (v - s.means[j]!) / s.stds[j]! : (v - s.mins[j]!) / (s.maxs[j]! - s.mins[j]!)));
}

export function scaleReports(s: Scaler, featureNames: string[]): ScaleReport[] {
  return featureNames.map((feature, j) => (s.method === "standard" ? { feature, method: s.method, mean: s.means[j], std: s.stds[j] } : s.method === "minmax" ? { feature, method: s.method, min: s.mins[j], max: s.maxs[j] } : { feature, method: s.method }));
}

/** Adds squares of numeric features and pairwise products of the first three. */
export function engineer(featureNames: string[], numericMask: boolean[]): { added: string[]; expand: (x: number[]) => number[]; names: string[] } {
  const numericIdx = numericMask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  const squares = numericIdx.map((i) => ({ name: `${featureNames[i]}^2`, fn: (x: number[]) => x[i]! * x[i]! }));
  const pairs: { name: string; fn: (x: number[]) => number }[] = [];
  const firstFew = numericIdx.slice(0, 3);
  for (let a = 0; a < firstFew.length; a++) for (let b = a + 1; b < firstFew.length; b++) pairs.push({ name: `${featureNames[firstFew[a]!]}*${featureNames[firstFew[b]!]}`, fn: (x) => x[firstFew[a]!]! * x[firstFew[b]!]! });
  const extra = [...squares, ...pairs];
  return { added: extra.map((e) => e.name), expand: (x) => [...x, ...extra.map((e) => e.fn(x))], names: [...featureNames, ...extra.map((e) => e.name)] };
}

export interface Split {
  train: number[];
  validation: number[];
  test: number[];
}

/** Seeded shuffle, stratified by class when asked so every split sees every class. */
export function split(y: number[], config: MLConfig, task: MLTask): Split {
  const rng = new Rng(config.seed);
  const n = y.length;
  const trainF = Math.min(0.9, Math.max(0.4, config.trainFraction));
  const valF = Math.min(0.4, Math.max(0.05, config.validationFraction));
  const groups: number[][] = task === "classification" && config.stratify ? Object.values(y.reduce<Record<number, number[]>>((acc, c, i) => ((acc[c] ??= []).push(i), acc), {})) : [Array.from({ length: n }, (_, i) => i)];
  const out: Split = { train: [], validation: [], test: [] };
  for (const g of groups) {
    const shuffled = rng.shuffle(g);
    const nTrain = Math.max(1, Math.round(shuffled.length * trainF));
    const nVal = Math.max(shuffled.length >= 3 ? 1 : 0, Math.round(shuffled.length * valF));
    out.train.push(...shuffled.slice(0, nTrain));
    out.validation.push(...shuffled.slice(nTrain, nTrain + nVal));
    out.test.push(...shuffled.slice(nTrain + nVal));
  }
  // A split that emptied test or validation borrows from train so every stage has rows.
  if (out.test.length === 0 && out.train.length > 2) out.test.push(out.train.pop()!);
  if (out.validation.length === 0 && out.train.length > 2) out.validation.push(out.train.pop()!);
  return { train: rng.shuffle(out.train), validation: rng.shuffle(out.validation), test: rng.shuffle(out.test) };
}

export function splitReport(sp: Split, X: number[][], y: number[], config: MLConfig, classes: string[] | null): SplitReport {
  const classCounts: SplitReport["classCounts"] = classes ? Object.fromEntries(classes.map((c, ci) => [c, { train: sp.train.filter((i) => y[i] === ci).length, validation: sp.validation.filter((i) => y[i] === ci).length, test: sp.test.filter((i) => y[i] === ci).length }])) : undefined;
  const pick = (idx: number[], name: "train" | "validation" | "test") => idx.slice(0, 3).map((i) => ({ split: name, features: X[i]!.map((v) => Math.round(v * 1000) / 1000), target: y[i]! }));
  return { train: sp.train.length, validation: sp.validation.length, test: sp.test.length, stratified: Boolean(classes && config.stratify), seed: config.seed, classCounts, samples: [...pick(sp.train, "train"), ...pick(sp.validation, "validation"), ...pick(sp.test, "test")] };
}

export const TRAIN_ROW_CAP = ML_LIMITS.maxTrainRows;
