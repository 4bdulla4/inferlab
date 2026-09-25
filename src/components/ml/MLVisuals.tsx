import { Fragment, useMemo } from "react";
import type { ClassificationMetrics, ColumnSummary, DecisionSurface, Metrics, NetworkArchitecture, ParamSnapshot, SplitReport, TreeNode } from "@shared/ml";
import { cn } from "@/lib/cn";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";

/*
 * Small, pure drawings shared by the inspector, the result panel and the
 * comparison view. Every number drawn here was computed by the server on the
 * real rows; the only stand-in is the decision surface, which says so itself.
 */

const fmt = (n: number, d = 3) => (Number.isFinite(n) ? (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(d)) : "—");
const short = (n: number) => (Math.abs(n) >= 1e4 ? n.toExponential(1) : Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(3));

/** Class colours: distinct hues, readable on both themes. */
export const CLASS_COLORS = ["#22d3ee", "#f472b6", "#fbbf24", "#34d399", "#a78bfa", "#fb923c", "#60a5fa", "#e879f9", "#4ade80", "#f87171", "#facc15", "#2dd4bf"];
export const classColor = (i: number) => CLASS_COLORS[((i % CLASS_COLORS.length) + CLASS_COLORS.length) % CLASS_COLORS.length]!;

/* ────────────────────────────── line chart ───────────────────────────── */

export interface Series {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

/** A line chart with axes and a legend; ys share one scale. */
export function LineChart({ series, xLabel, yLabel, height = 160, logY = false, marker, className }: { series: Series[]; xLabel: string; yLabel: string; height?: number; logY?: boolean; marker?: { x: number; label: string } | null; className?: string }) {
  const W = 480;
  const H = height;
  const pad = { l: 46, r: 12, t: 20, b: 26 };
  const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.y));
  if (!all.length) return <p className="mono text-[11px] text-muted">nothing to plot yet</p>;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => (logY ? Math.log10(Math.max(p.y, 1e-9)) : p.y));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 - y0 < 1e-9) {
    y0 -= 0.5;
    y1 += 0.5;
  }
  const padY = (y1 - y0) * 0.08;
  // Losses, impurities and metrics never go below zero; do not draw an axis that suggests they might.
  const nonNegative = Math.min(...ys) >= 0;
  y0 = nonNegative ? Math.max(0, y0 - padY) : y0 - padY;
  y1 += padY;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - ((logY ? Math.log10(Math.max(y, 1e-9)) : y) - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const yTicks = 4;
  const tickVal = (i: number) => {
    const v = y0 + ((y1 - y0) * i) / yTicks;
    return logY ? Math.pow(10, v) : v;
  };
  return (
    <div className={cn("grid gap-1", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${yLabel} over ${xLabel}`}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const y = pad.t + (1 - i / yTicks) * (H - pad.t - pad.b);
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="mono fill-muted" fontSize={9}>
                {short(tickVal(i))}
              </text>
            </g>
          );
        })}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} className="stroke-line-strong" />
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="stroke-line-strong" />
        <text x={(pad.l + W - pad.r) / 2} y={H - 6} textAnchor="middle" className="mono fill-muted" fontSize={9} letterSpacing="0.1em">
          {xLabel.toUpperCase()}
        </text>
        <text x={pad.l} y={9} className="mono fill-muted" fontSize={9} letterSpacing="0.1em">
          {yLabel.toUpperCase()}
        </text>
        {marker && Number.isFinite(marker.x) ? (
          <g>
            <line x1={sx(marker.x)} x2={sx(marker.x)} y1={pad.t} y2={H - pad.b} stroke="var(--color-warn)" strokeDasharray="3 3" />
            <text x={sx(marker.x) + 4} y={pad.t + 10} className="mono" fill="var(--color-warn)" fontSize={9}>
              {marker.label}
            </text>
          </g>
        ) : null}
        {series.map((s) => {
          const pts = s.points.filter((p) => Number.isFinite(p.y));
          if (!pts.length) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
          const last = pts.at(-1)!;
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinejoin="round" />
              <circle cx={sx(last.x)} cy={sy(last.y)} r={3} fill={s.color} />
            </g>
          );
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mono text-[10px] text-muted">
        {series.map((s) => {
          const last = s.points.filter((p) => Number.isFinite(p.y)).at(-1);
          return (
            <li key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[2px]" style={{ background: s.color }} />
              {s.name}
              {last ? <span className="text-ink">{fmt(last.y, 4)}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─────────────────────────────── bars ───────────────────────────────── */

export interface BarItem {
  label: string;
  value: number;
  /** Optional right-hand text; defaults to the value. */
  text?: string;
  color?: string;
  highlight?: boolean;
}

/** Horizontal bars, scaled to the largest absolute value. Negative values grow leftwards from the centre. */
export function BarList({ items, signed = false, max: maxOverride, className, format = (v) => fmt(v) }: { items: BarItem[]; signed?: boolean; max?: number; className?: string; format?: (v: number) => string }) {
  const max = maxOverride ?? Math.max(1e-12, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul className={cn("grid gap-1", className)}>
      {items.map((it, i) => {
        const frac = Math.min(1, Math.abs(it.value) / max);
        return (
          <li key={`${it.label}-${i}`} className={cn("grid grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-2 mono text-[10.5px]", it.highlight && "text-ink")}>
            <span className="truncate text-ink-dim" title={it.label}>
              {it.label}
            </span>
            <span className="relative h-3 rounded-sm surface-1 border border-line overflow-hidden">
              {signed ? (
                <>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                  <span className="absolute inset-y-0 rounded-sm" style={{ background: it.color ?? (it.value < 0 ? "var(--color-err)" : "var(--color-live)"), left: it.value < 0 ? `${50 - frac * 50}%` : "50%", width: `${frac * 50}%` }} />
                </>
              ) : (
                <span className="absolute inset-y-0 left-0 rounded-sm" style={{ background: it.color ?? "var(--color-live)", width: `${frac * 100}%` }} />
              )}
            </span>
            <span className={cn("text-right tabular-nums", it.highlight ? "text-ink" : "text-muted")}>{it.text ?? format(it.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ──────────────────────────── histogram ─────────────────────────────── */

export function Histogram({ column, className }: { column: ColumnSummary; className?: string }) {
  const h = column.histogram;
  if (!h) return <p className="mono text-[10.5px] text-muted">no distribution for {column.type} columns</p>;
  if ("bins" in h) {
    const max = Math.max(1, ...h.bins.map((b) => b.count));
    return (
      <div className={cn("grid gap-1", className)}>
        <div className="flex items-end gap-px h-16" role="img" aria-label={`Histogram of ${column.name}`}>
          {h.bins.map((b, i) => (
            <span key={i} title={`${short(b.from)} – ${short(b.to)}: ${b.count}`} className="flex-1 rounded-t-sm bg-live/70 hover:bg-live min-w-[2px]" style={{ height: `${(b.count / max) * 100}%` }} />
          ))}
        </div>
        <div className="flex justify-between mono text-[9.5px] text-faint">
          <span>{short(h.bins[0]?.from ?? 0)}</span>
          <span>{short(h.bins.at(-1)?.to ?? 0)}</span>
        </div>
      </div>
    );
  }
  return <BarList className={className} items={h.categories.map((c, i) => ({ label: c.value, value: c.count, color: classColor(i), text: String(c.count) }))} />;
}

/* ───────────────────────────── parameters ───────────────────────────── */

const heat = (v: number, scale: number) => {
  const t = Math.max(-1, Math.min(1, v / (scale || 1)));
  const a = Math.abs(t);
  return t < 0 ? `rgba(248,113,113,${0.15 + a * 0.85})` : `rgba(34,211,238,${0.15 + a * 0.85})`;
};

/** Every parameter group as a strip of cells, red for negative and cyan for positive, with the group's shape and norm. */
export function WeightStrips({ params, gradient, className }: { params: ParamSnapshot; gradient?: { groups: { name: string; norm: number; values: number[] }[] } | undefined; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      {params.groups.map((g) => {
        const scale = Math.max(1e-9, ...g.values.map((v) => Math.abs(v)));
        const grad = gradient?.groups.find((x) => x.name === g.name);
        return (
          <div key={g.name} className="grid gap-1">
            <div className="flex items-baseline gap-2 mono text-[10.5px]">
              <span className="text-ink">{g.name}</span>
              <span className="text-muted">[{g.shape.join(" × ")}]</span>
              <span className="ml-auto text-muted">
                ‖w‖ <span className="text-ink">{fmt(g.norm)}</span>
                {grad ? (
                  <>
                    {" · "}‖∇‖ <span className="text-warn">{fmt(grad.norm)}</span>
                  </>
                ) : null}
              </span>
            </div>
            <div className="flex flex-wrap gap-px" role="img" aria-label={`${g.values.length} of the ${g.name} values`}>
              {g.values.map((v, i) => (
                <span key={i} title={`${g.name}[${i}] = ${v.toFixed(5)}`} className="size-3 rounded-[2px]" style={{ background: heat(v, scale) }} />
              ))}
              {g.truncated ? <span className="mono text-[9.5px] text-faint self-center ml-1">… first {g.values.length} of {g.shape.reduce((a, b) => a * b, 1).toLocaleString()}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────── network ───────────────────────────────── */

/**
 * The network as columns of neurons. Edge tint comes from the real weight
 * values the server sent (the first values of each layer, when the layer is
 * larger than the snapshot); neuron fill comes from real activations when a
 * forward pass has been drawn. Layers wider than 12 units are abbreviated.
 */
export function NetworkDiagram({ architecture, params, activations, className }: { architecture: NetworkArchitecture; params?: ParamSnapshot; activations?: { layer: string; values: number[] }[]; className?: string }) {
  const layers = architecture.layers;
  const MAX_SHOWN = 12;
  const W = 520;
  const H = 210;
  const colX = (i: number) => 40 + (i * (W - 80)) / Math.max(1, layers.length - 1);
  const shown = layers.map((l) => Math.min(l.units, MAX_SHOWN));
  const nodeY = (li: number, ni: number) => {
    const n = shown[li]!;
    const gap = Math.min(16, (H - 50) / Math.max(1, n));
    return H / 2 - ((n - 1) * gap) / 2 + ni * gap;
  };
  const weightGroups = params?.groups.filter((g) => g.shape.length === 2) ?? [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full h-auto", className)} role="img" aria-label={`Network with ${layers.map((l) => l.units).join(", ")} units per layer`}>
      {layers.slice(1).map((_, li) => {
        const from = li;
        const to = li + 1;
        const g = weightGroups[li];
        const scale = g ? Math.max(1e-9, ...g.values.map((v) => Math.abs(v))) : 1;
        const inUnits = layers[from]!.units;
        return (
          <g key={`e${li}`}>
            {Array.from({ length: shown[from]! }, (_, a) =>
              Array.from({ length: shown[to]! }, (_, b) => {
                // Row-major [in × out]: weight for input a, output b.
                const idx = a * layers[to]!.units + b;
                const w = g && idx < g.values.length && inUnits === layers[from]!.units ? g.values[idx]! : 0;
                return <line key={`${a}-${b}`} x1={colX(from)} y1={nodeY(from, a)} x2={colX(to)} y2={nodeY(to, b)} stroke={g && idx < g.values.length ? heat(w, scale) : "var(--color-line)"} strokeWidth={g && idx < g.values.length ? 0.6 + (Math.abs(w) / scale) * 1.4 : 0.6} />;
              }),
            )}
          </g>
        );
      })}
      {layers.map((l, li) => {
        const act = activations?.find((a) => a.layer === l.name)?.values;
        const scale = act ? Math.max(1e-9, ...act.map((v) => Math.abs(v))) : 1;
        return (
          <g key={l.name}>
            {Array.from({ length: shown[li]! }, (_, ni) => {
              const v = act?.[ni];
              return (
                <circle key={ni} cx={colX(li)} cy={nodeY(li, ni)} r={5} fill={v !== undefined ? heat(v, scale) : "var(--color-bg-elevated)"} stroke="var(--color-line-strong)" strokeWidth={1}>
                  <title>
                    {l.name} unit {ni + 1}
                    {v !== undefined ? ` · activation ${v.toFixed(4)}` : ""}
                  </title>
                </circle>
              );
            })}
            {l.units > MAX_SHOWN ? (
              <text x={colX(li)} y={nodeY(li, shown[li]! - 1) + 16} textAnchor="middle" className="mono fill-faint" fontSize={9}>
                +{l.units - MAX_SHOWN} more
              </text>
            ) : null}
            <text x={colX(li)} y={14} textAnchor="middle" className="mono fill-ink-dim" fontSize={9.5}>
              {l.name}
            </text>
            <text x={colX(li)} y={H - 6} textAnchor="middle" className="mono fill-muted" fontSize={9}>
              {l.units} · {l.activation}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─────────────────────────────── tree ───────────────────────────────── */

/** A decision tree laid out by depth; leaves show their value or class mix. `path` highlights a prediction's route. */
export function TreeView({ nodes, classes, path, maxDepth = 5, className }: { nodes: TreeNode[]; classes: string[] | null; path?: number[]; maxDepth?: number; className?: string }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const root = byId.get(0);
  const layout = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();
    let leafCounter = 0;
    const place = (id: number, depth: number): number => {
      const n = byId.get(id);
      if (!n) return leafCounter++;
      const isLeaf = n.left === undefined || depth >= maxDepth;
      if (isLeaf) {
        const x = leafCounter++;
        pos.set(id, { x, y: depth });
        return x;
      }
      const l = place(n.left!, depth + 1);
      const r = place(n.right!, depth + 1);
      const x = (l + r) / 2;
      pos.set(id, { x, y: depth });
      return x;
    };
    if (root) place(0, 0);
    return { pos, leaves: leafCounter };
  }, [byId, root, maxDepth]);

  if (!root) return <p className="mono text-[10.5px] text-muted">no tree yet</p>;
  const depthShown = Math.min(maxDepth, Math.max(...nodes.map((n) => n.depth)));
  const W = Math.max(320, layout.leaves * 92);
  const H = 60 + depthShown * 74;
  const px = (x: number) => 46 + (layout.leaves > 1 ? (x / (layout.leaves - 1)) * (W - 92) : (W - 92) / 2);
  const py = (y: number) => 26 + y * 74;
  const onPath = new Set(path ?? []);
  return (
    <div className={cn("overflow-x-auto panel-scroll", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-none" role="img" aria-label={`Decision tree with ${nodes.length} nodes`}>
        {nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p || n.left === undefined || n.depth >= maxDepth) return null;
          return [n.left, n.right].map((c, i) => {
            const cp = c !== undefined ? layout.pos.get(c) : undefined;
            if (!cp) return null;
            const hot = onPath.has(n.id) && onPath.has(c!);
            return (
              <g key={`${n.id}-${i}`}>
                <path d={`M${px(p.x)},${py(p.y) + 16} C${px(p.x)},${py(p.y) + 46} ${px(cp.x)},${py(cp.y) - 40} ${px(cp.x)},${py(cp.y) - 16}`} fill="none" stroke={hot ? "var(--color-warn)" : "var(--color-line-strong)"} strokeWidth={hot ? 2 : 1.2} />
                <text x={(px(p.x) + px(cp.x)) / 2 + (i === 0 ? -10 : 10)} y={(py(p.y) + py(cp.y)) / 2 + 3} textAnchor="middle" className="mono fill-muted" fontSize={8.5}>
                  {i === 0 ? "yes" : "no"}
                </text>
              </g>
            );
          });
        })}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const isLeaf = n.left === undefined || n.depth >= maxDepth;
          // A child the grower has not reached yet: it has rows but neither a split nor a value.
          const pending = n.left === undefined && n.value === undefined && n.feature === undefined;
          const hot = onPath.has(n.id);
          const majority = n.classCounts ? n.classCounts.indexOf(Math.max(...n.classCounts)) : -1;
          const label = pending ? "growing…" : isLeaf ? (n.left !== undefined ? `… ${n.samples} rows` : classes ? (classes[majority] ?? String(n.value)) : fmt(n.value ?? 0, 2)) : `${n.feature} ≤ ${short(n.threshold ?? 0)}`;
          return (
            <g key={n.id}>
              <rect x={px(p.x) - 42} y={py(p.y) - 16} width={84} height={32} rx={6} fill={isLeaf && !pending && classes && majority >= 0 ? `${classColor(majority)}22` : "var(--color-bg-elevated)"} stroke={hot ? "var(--color-warn)" : pending ? "var(--color-line)" : isLeaf ? "var(--color-ok)" : "var(--color-line-strong)"} strokeWidth={hot ? 2 : 1} strokeDasharray={pending ? "3 3" : undefined} />
              <text x={px(p.x)} y={py(p.y) - 3} textAnchor="middle" className={pending ? "mono fill-muted" : "mono fill-ink"} fontSize={8.5}>
                {label.length > 16 ? `${label.slice(0, 15)}…` : label}
              </text>
              <text x={px(p.x)} y={py(p.y) + 9} textAnchor="middle" className="mono fill-muted" fontSize={7.5}>
                {n.samples} rows · {pending ? "pending" : isLeaf ? "leaf" : `imp ${fmt(n.impurity, 2)}`}
              </text>
              <title>
                {n.feature ? `${n.feature} ≤ ${n.threshold}` : "leaf"} · {n.samples} rows · impurity {n.impurity.toFixed(4)}
                {n.classCounts ? ` · counts ${n.classCounts.join("/")}` : n.value !== undefined ? ` · value ${n.value}` : ""}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ───────────────────────────── metrics ──────────────────────────────── */

export function MetricCards({ metrics, className }: { metrics: Metrics; className?: string }) {
  const cards: { k: string; v: string; hint?: string }[] =
    metrics.task === "classification"
      ? [
          { k: "accuracy", v: `${(metrics.accuracy * 100).toFixed(1)}%`, hint: "correct ÷ all" },
          { k: "precision", v: fmt(metrics.precisionMacro), hint: "macro" },
          { k: "recall", v: fmt(metrics.recallMacro), hint: "macro" },
          { k: "F1", v: fmt(metrics.f1Macro), hint: "macro" },
          { k: "log loss", v: metrics.logLoss === null ? "—" : fmt(metrics.logLoss), hint: "lower is better" },
          { k: "rows", v: String(metrics.n) },
        ]
      : [
          { k: "RMSE", v: fmt(metrics.rmse), hint: "target units" },
          { k: "MAE", v: fmt(metrics.mae), hint: "target units" },
          { k: "MSE", v: fmt(metrics.mse) },
          { k: "R²", v: fmt(metrics.r2), hint: "1 = perfect, 0 = mean" },
          { k: "rows", v: String(metrics.n) },
        ];
  return (
    <dl className={cn("grid grid-cols-3 sm:grid-cols-6 gap-2 mono text-[11px]", className)}>
      {cards.map((c) => (
        <div key={c.k} className="rounded-lg border border-line surface-1 px-2.5 py-1.5 min-w-0">
          <dt className="text-muted text-[9.5px] uppercase tracking-[0.12em] truncate">{c.k}</dt>
          <dd className="text-ink text-[13px] truncate">{c.v}</dd>
          {c.hint ? <dd className="text-faint text-[9px] truncate">{c.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function ConfusionMatrix({ confusion, className }: { confusion: ClassificationMetrics["confusion"]; className?: string }) {
  const max = Math.max(1, ...confusion.matrix.flat());
  return (
    <div className={cn("grid gap-1 min-w-0 overflow-x-auto panel-scroll", className)}>
      <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-muted">rows = actual · columns = predicted</p>
      <div className="grid gap-px mono text-[10.5px]" style={{ gridTemplateColumns: `minmax(64px,auto) repeat(${confusion.classes.length}, minmax(44px, 1fr))` }}>
        <span />
        {confusion.classes.map((c, i) => (
          <span key={c} className="truncate text-center px-1" style={{ color: classColor(i) }} title={c}>
            {c}
          </span>
        ))}
        {confusion.matrix.map((row, i) => (
          <Fragment key={i}>
            <span className="truncate pr-2 text-right" style={{ color: classColor(i) }} title={confusion.classes[i]}>
              {confusion.classes[i]}
            </span>
            {row.map((v, j) => (
              <span key={j} className={cn("text-center py-1.5 rounded-sm border", i === j ? "border-ok/30" : "border-line")} style={{ background: i === j ? `rgba(52,211,153,${0.08 + (v / max) * 0.6})` : `rgba(248,113,113,${v ? 0.08 + (v / max) * 0.6 : 0})` }} title={`actual ${confusion.classes[i]} → predicted ${confusion.classes[j]}: ${v}`}>
                {v}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** ROC and precision-recall curves, one line per class (one-vs-rest). */
export function Curves({ metrics, className }: { metrics: ClassificationMetrics; className?: string }) {
  if (!metrics.roc && !metrics.pr) return <p className="mono text-[10.5px] text-muted">this model gives no probabilities, so there are no ROC or PR curves</p>;
  const S = 150;
  const plot = (title: string, lines: { name: string; points: { x: number; y: number }[]; score: string; color: string }[], xl: string, yl: string, diagonal: boolean) => (
    <div className="grid gap-1 min-w-0">
      <p className="label-caps text-[9.5px]">{title}</p>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[220px] h-auto" role="img" aria-label={title}>
        <rect x={0.5} y={0.5} width={S - 1} height={S - 1} fill="none" className="stroke-line" />
        {diagonal ? <line x1={0} y1={S} x2={S} y2={0} className="stroke-line-strong" strokeDasharray="3 3" /> : null}
        {lines.map((l) => (
          <path key={l.name} d={l.points.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * (S - 2) + 1).toFixed(1)},${((1 - p.y) * (S - 2) + 1).toFixed(1)}`).join(" ")} fill="none" stroke={l.color} strokeWidth={1.6} />
        ))}
        <text x={S - 3} y={S - 3} textAnchor="end" className="mono fill-faint" fontSize={7}>
          {xl}
        </text>
        <text x={3} y={9} className="mono fill-faint" fontSize={7}>
          {yl}
        </text>
      </svg>
      <ul className="grid gap-0.5 mono text-[9.5px] text-muted">
        {lines.map((l) => (
          <li key={l.name} className="flex items-center gap-1.5 truncate">
            <span className="inline-block w-2.5 h-[2px]" style={{ background: l.color }} />
            <span className="truncate">{l.name}</span>
            <span className="ml-auto text-ink">{l.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      {metrics.roc ? plot("ROC · one-vs-rest", metrics.roc.map((r, i) => ({ name: r.className, points: r.points.map((p) => ({ x: p.fpr, y: p.tpr })), score: `AUC ${fmt(r.auc)}`, color: classColor(i) })), "FPR →", "TPR", true) : null}
      {metrics.pr ? plot("Precision · recall", metrics.pr.map((r, i) => ({ name: r.className, points: r.points.map((p) => ({ x: p.recall, y: p.precision })), score: `AP ${fmt(r.ap)}`, color: classColor(i) })), "recall →", "precision", false) : null}
    </div>
  );
}

/* ───────────────────────── decision surface ─────────────────────────── */

/**
 * Predicted regions over two features with the real rows on top. When the
 * model has more than two features the grid is a slice (other features at their
 * mean) and the badge says SIM; with exactly two it is exact and says LIVE.
 */
export function DecisionSurfaceView({ surface, classes, className }: { surface: DecisionSurface; classes: string[] | null; className?: string }) {
  const nx = surface.xs.length;
  const ny = surface.ys.length;
  const S = 260;
  const cw = S / nx;
  const ch = S / ny;
  const x0 = surface.xs[0] ?? 0;
  const x1 = surface.xs.at(-1) ?? 1;
  const y0 = surface.ys[0] ?? 0;
  const y1 = surface.ys.at(-1) ?? 1;
  const vmin = Math.min(...surface.values);
  const vmax = Math.max(...surface.values);
  const px = (x: number) => ((x - x0) / (x1 - x0 || 1)) * S;
  const py = (y: number) => S - ((y - y0) / (y1 - y0 || 1)) * S;
  const cell = (v: number) => (classes ? `${classColor(Math.round(v))}55` : `rgba(34,211,238,${0.1 + ((v - vmin) / (vmax - vmin || 1)) * 0.7})`);
  const point = (v: number) => (classes ? classColor(Math.round(v)) : `hsl(${200 - ((v - vmin) / (vmax - vmin || 1)) * 160} 80% 60%)`);
  return (
    <div className={cn("grid gap-2 min-w-0", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <SourceBadge source={surface.source} compact />
        <span className="text-[11px] leading-snug text-muted">{surface.note}</span>
      </div>
      <div className="grid gap-1 justify-items-start">
        <svg viewBox={`-34 -6 ${S + 40} ${S + 30}`} className="w-full max-w-[380px] h-auto" role="img" aria-label={`Decision regions over ${surface.xFeature} and ${surface.yFeature}`}>
          {surface.values.map((v, i) => {
            const ix = i % nx;
            const iy = Math.floor(i / nx);
            return <rect key={i} x={ix * cw} y={S - (iy + 1) * ch} width={cw + 0.5} height={ch + 0.5} fill={cell(v)} />;
          })}
          {surface.points.map((p, i) => (
            <circle key={i} cx={px(p.x)} cy={py(p.y)} r={p.split === "test" ? 3.2 : 2.4} fill={point(p.target)} stroke={p.predicted === p.target || !classes ? "rgba(0,0,0,0.6)" : "var(--color-err)"} strokeWidth={p.predicted === p.target || !classes ? 0.6 : 1.4} opacity={p.split === "train" ? 0.75 : 1}>
              <title>
                {p.split} row · {surface.xFeature} {short(p.x)} · {surface.yFeature} {short(p.y)} · actual {classes ? classes[p.target] : short(p.target)} · predicted {classes ? classes[p.predicted] : short(p.predicted)}
              </title>
            </circle>
          ))}
          <rect x={0} y={0} width={S} height={S} fill="none" className="stroke-line-strong" />
          <text x={S / 2} y={S + 18} textAnchor="middle" className="mono fill-muted" fontSize={9}>
            {surface.xFeature} →
          </text>
          <text x={-8} y={S / 2} textAnchor="middle" transform={`rotate(-90 -8 ${S / 2})`} className="mono fill-muted" fontSize={9}>
            {surface.yFeature} →
          </text>
        </svg>
        <p className="mono text-[9.5px] text-faint">
          {classes ? "colour = class · red ring = misclassified" : "colour = value"} · larger dots = test rows · {surface.points.length} rows shown
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────── split bars ────────────────────────────── */

export function SplitBars({ report, className }: { report: SplitReport; className?: string }) {
  const total = report.train + report.validation + report.test || 1;
  const parts = [
    { k: "train", n: report.train, c: "var(--color-live)" },
    { k: "validation", n: report.validation, c: "var(--color-warn)" },
    { k: "test", n: report.test, c: "var(--color-accent-soft)" },
  ];
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex h-4 rounded-md overflow-hidden border border-line" role="img" aria-label="Split proportions">
        {parts.map((p) => (
          <span key={p.k} style={{ width: `${(p.n / total) * 100}%`, background: p.c }} title={`${p.k}: ${p.n} rows`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mono text-[10.5px] text-muted">
        {parts.map((p) => (
          <li key={p.k} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: p.c }} />
            {p.k} <span className="text-ink">{p.n}</span> <span className="text-faint">({((p.n / total) * 100).toFixed(0)}%)</span>
          </li>
        ))}
        <li className="text-faint">seed {report.seed} · {report.stratified ? "stratified" : "plain shuffle"}</li>
      </ul>
      {report.classCounts ? (
        <div className="grid gap-1 mono text-[10px]">
          <p className="label-caps text-[9.5px]">class balance per split</p>
          {Object.entries(report.classCounts).map(([cls, c], i) => (
            <div key={cls} className="grid grid-cols-[minmax(0,120px)_repeat(3,1fr)] gap-2">
              <span className="truncate" style={{ color: classColor(i) }}>
                {cls}
              </span>
              <span className="text-ink-dim">{c.train}</span>
              <span className="text-ink-dim">{c.validation}</span>
              <span className="text-ink-dim">{c.test}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── predictions ────────────────────────────── */

export function PredictionTable({ rows, classes, limit = 12, className }: { rows: { index: number; predicted: number; target: number; probabilities?: number[] }[]; classes: string[] | null; limit?: number; className?: string }) {
  if (!rows.length) return <p className="mono text-[10.5px] text-muted">no predictions recorded</p>;
  return (
    <table className={cn("w-full mono text-[10.5px]", className)}>
      <thead>
        <tr className="text-muted text-left">
          <th className="font-normal py-1">row</th>
          <th className="font-normal py-1">actual</th>
          <th className="font-normal py-1">predicted</th>
          <th className="font-normal py-1">{classes ? "confidence" : "error"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, limit).map((r) => {
          const ok = classes ? r.predicted === r.target : Math.abs(r.predicted - r.target) < 1e-9;
          const conf = r.probabilities ? Math.max(...r.probabilities) : null;
          return (
            <tr key={r.index} className="border-t border-line">
              <td className="py-1 text-faint">#{r.index}</td>
              <td className="py-1" style={classes ? { color: classColor(r.target) } : undefined}>
                {classes ? classes[r.target] : fmt(r.target, 2)}
              </td>
              <td className={cn("py-1", classes && !ok && "text-err")} style={classes && ok ? { color: classColor(r.predicted) } : undefined}>
                {classes ? classes[r.predicted] : fmt(r.predicted, 2)}
                {classes ? <span className="ml-1">{ok ? "✓" : "✗"}</span> : null}
              </td>
              <td className="py-1 text-muted">{classes ? (conf !== null ? `${(conf * 100).toFixed(0)}%` : "—") : fmt(r.predicted - r.target, 2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Probabilities per class as bars, the winner highlighted. */
export function ProbabilityBars({ probabilities, classes, className }: { probabilities: number[]; classes: string[]; className?: string }) {
  const best = probabilities.indexOf(Math.max(...probabilities));
  return <BarList className={className} max={1} items={probabilities.map((p, i) => ({ label: classes[i] ?? String(i), value: p, color: classColor(i), text: `${(p * 100).toFixed(1)}%`, highlight: i === best }))} />;
}

export function SimNote({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-2 text-[11px] leading-snug text-muted">
      <Badge tone="sim" className="shrink-0 mt-px">
        sim
      </Badge>
      {children}
    </p>
  );
}
