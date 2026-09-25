import type { ColumnSummary, ColumnType, DatasetSummary } from "@shared/ml";
import { ML_LIMITS } from "../../shared/ml";

/** A dataset as rows of strings; "" marks a missing value. */
export interface RawTable {
  columns: string[];
  rows: string[][];
}

const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "-", "?", "missing"]);

export function isMissing(v: string): boolean {
  return MISSING.has(v.trim().toLowerCase());
}

/* ─────────────────────────────── parsing ────────────────────────────── */

/** RFC 4180-style CSV: quoted fields, escaped quotes, CRLF; the delimiter is sniffed from the header. */
export function parseCsv(text: string): RawTable {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t", "|"].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  if (rows.length < 2) throw new Error("The file needs a header row and at least one data row.");
  const header = rows[0]!.map((h, i) => (h.trim() || `column_${i + 1}`));
  const width = header.length;
  const body = rows.slice(1).map((r) => {
    const out = r.slice(0, width).map((v) => v.trim());
    while (out.length < width) out.push("");
    return out;
  });
  return { columns: dedupe(header), rows: body };
}

/** JSON: an array of flat objects, or an object with a `data`/`rows` array. */
export function parseJsonTable(text: string): RawTable {
  const parsed = JSON.parse(text) as unknown;
  const arr = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? ((parsed as Record<string, unknown>).data ?? (parsed as Record<string, unknown>).rows) : null;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("JSON must be an array of objects (or { data: [...] }).");
  const columns: string[] = [];
  for (const item of arr.slice(0, 200)) if (item && typeof item === "object") for (const k of Object.keys(item as object)) if (!columns.includes(k)) columns.push(k);
  if (columns.length === 0) throw new Error("No columns were found in the JSON objects.");
  const rows = arr.map((item) => columns.map((c) => stringify((item as Record<string, unknown>)?.[c])));
  return { columns, rows };
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    return count ? `${n}_${count + 1}` : n;
  });
}

export function parseTable(text: string, format: "csv" | "json"): RawTable {
  const table = format === "json" ? parseJsonTable(text) : parseCsv(text);
  if (table.rows.length > ML_LIMITS.maxRows) throw new Error(`Datasets are limited to ${ML_LIMITS.maxRows.toLocaleString()} rows; this one has ${table.rows.length.toLocaleString()}.`);
  if (table.columns.length > ML_LIMITS.maxColumns) throw new Error(`Datasets are limited to ${ML_LIMITS.maxColumns} columns; this one has ${table.columns.length}.`);
  return table;
}

/* ────────────────────────────── inference ───────────────────────────── */

const BOOL = new Set(["true", "false", "yes", "no", "y", "n", "t", "f"]);

export function toNumber(v: string): number | null {
  const s = v.trim().replace(/,/g, "");
  if (s === "" || isMissing(s)) return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?$/.test(s)) return null;
  const n = Number(s.replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

/** Decides what kind of column each one is from its values alone. */
export function inferColumnType(name: string, values: string[]): ColumnType {
  const present = values.filter((v) => !isMissing(v));
  if (present.length === 0) return "constant";
  const unique = new Set(present.map((v) => v.trim().toLowerCase()));
  if (unique.size === 1) return "constant";
  const numeric = present.filter((v) => toNumber(v) !== null).length;
  const lowers = [...unique];
  if (lowers.every((v) => BOOL.has(v)) && unique.size <= 2) return "boolean";
  if (numeric / present.length >= 0.9) {
    // An integer column with one distinct value per row is an identifier, not a measurement.
    if (unique.size === present.length && present.length > 20 && /(^|_)(id|no|number|index|key)$/i.test(name)) return "id";
    if (unique.size <= 2 && lowers.every((v) => v === "0" || v === "1")) return "boolean";
    return "numeric";
  }
  if (unique.size === present.length && present.length > 20) return "id";
  if (unique.size <= Math.max(20, Math.floor(present.length * 0.05))) return "categorical";
  return "text";
}

export function summarizeColumn(name: string, values: string[]): ColumnSummary {
  const type = inferColumnType(name, values);
  const present = values.filter((v) => !isMissing(v));
  const missing = values.length - present.length;
  const unique = new Set(present).size;
  const examples = [...new Set(present)].slice(0, 5);
  const out: ColumnSummary = { name, type, missing, unique, examples };
  if (type === "numeric") {
    const nums = present.map(toNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
    if (nums.length) {
      const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
      const std = Math.sqrt(nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length);
      const median = nums.length % 2 ? nums[(nums.length - 1) / 2]! : (nums[nums.length / 2 - 1]! + nums[nums.length / 2]!) / 2;
      out.stats = { min: nums[0]!, max: nums[nums.length - 1]!, mean, std, median };
      out.histogram = { bins: histogram(nums, 12) };
    }
  } else if (type === "categorical" || type === "boolean") {
    const counts = new Map<string, number>();
    for (const v of present) counts.set(v, (counts.get(v) ?? 0) + 1);
    out.histogram = { categories: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value, count]) => ({ value, count })) };
  }
  return out;
}

export function histogram(sorted: number[], bins: number): { from: number; to: number; count: number }[] {
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (max === min) return [{ from: min, to: max, count: sorted.length }];
  const width = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const n of sorted) out[Math.min(bins - 1, Math.floor((n - min) / width))]!.count += 1;
  return out;
}

export function summarizeTable(table: RawTable, meta: { id: string; name: string; origin: "sample" | "upload"; format: "csv" | "json"; bytes: number; synthetic?: boolean; note: string }): DatasetSummary {
  const columns = table.columns.map((name, i) => summarizeColumn(name, table.rows.map((r) => r[i] ?? "")));
  return { id: meta.id, name: meta.name, origin: meta.origin, synthetic: meta.synthetic, format: meta.format, rows: table.rows.length, columns, sampleRows: table.rows.slice(0, 12), bytes: meta.bytes, addedAt: Date.now(), note: meta.note };
}

/** Pearson correlation between two numeric arrays of equal length. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
