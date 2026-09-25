import type { AgentGraphEdge, AgentGraphNode } from "./state";

export const AGENT_NODE_W = 188;
export const AGENT_NODE_H = 74;
export const AGENT_GAP_X = 40;
export const AGENT_GAP_Y = 22;
export const AGENT_MARGIN_X = 28;
export const AGENT_MARGIN_Y = 46;
export const AGENT_MIN_ROWS = 2;

/** Left-to-right on wide screens; top-to-bottom when the frame is narrow. */
export type GraphOrientation = "horizontal" | "vertical";

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Position along the flow (execution order). */
  col: number;
  /** Position across the flow (parallel branches). */
  row: number;
}

export interface IterationBand {
  iteration: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AgentLayout {
  orientation: GraphOrientation;
  nodes: Record<string, PlacedNode>;
  order: string[];
  width: number;
  height: number;
  columns: number;
  rows: number;
  bands: IterationBand[];
}

/**
 * Places a grown graph along the flow. A node's column is one past its furthest
 * predecessor, so parallel tool calls share a column and a fallback sits just
 * past the tool it replaced. Rows are inherited from the predecessor when free,
 * so a chain stays on one line and a fan-out stacks across the flow.
 *
 * The same column/row grid is drawn left-to-right or top-to-bottom; only the
 * mapping to pixels changes, so the two orientations always agree on structure.
 */
export function layoutAgentGraph(nodes: AgentGraphNode[], edges: AgentGraphEdge[], orientation: GraphOrientation = "horizontal"): AgentLayout {
  const ids = nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const preds = new Map<string, string[]>();
  for (const e of edges) {
    if (!index.has(e.from) || !index.has(e.to)) continue;
    preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  }

  // Longest path from any source, relaxed until stable (the graph is acyclic).
  const col = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length + 1; pass++) {
    let changed = false;
    for (const id of ids) {
      const best = Math.max(0, ...(preds.get(id) ?? []).map((p) => (col.get(p) ?? 0) + 1));
      if (best !== col.get(id)) {
        col.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const taken = new Map<number, Set<number>>();
  const row = new Map<string, number>();
  for (const id of ids) {
    const c = col.get(id)!;
    const used = taken.get(c) ?? new Set<number>();
    const parentRows = (preds.get(id) ?? []).map((p) => row.get(p) ?? 0);
    let r = parentRows.length ? Math.min(...parentRows) : 0;
    while (used.has(r)) r += 1;
    used.add(r);
    taken.set(c, used);
    row.set(id, r);
  }

  const vertical = orientation === "vertical";
  const stepAlong = vertical ? AGENT_NODE_H + AGENT_GAP_Y : AGENT_NODE_W + AGENT_GAP_X;
  const stepAcross = vertical ? AGENT_NODE_W + AGENT_GAP_X : AGENT_NODE_H + AGENT_GAP_Y;
  const marginAlong = vertical ? AGENT_MARGIN_Y : AGENT_MARGIN_X;
  const marginAcross = vertical ? AGENT_MARGIN_X : AGENT_MARGIN_Y;

  const placed: Record<string, PlacedNode> = {};
  let maxCol = 0;
  let maxRow = 0;
  for (const id of ids) {
    const c = col.get(id)!;
    const r = row.get(id)!;
    maxCol = Math.max(maxCol, c);
    maxRow = Math.max(maxRow, r);
    const along = marginAlong + c * stepAlong;
    const across = marginAcross + r * stepAcross;
    placed[id] = { id, col: c, row: r, x: vertical ? across : along, y: vertical ? along : across, w: AGENT_NODE_W, h: AGENT_NODE_H };
  }

  const columns = ids.length ? maxCol + 1 : 0;
  const rows = Math.max(AGENT_MIN_ROWS, ids.length ? maxRow + 1 : 0);
  const alongExtent = marginAlong + Math.max(columns, 3) * stepAlong - (vertical ? AGENT_GAP_Y : AGENT_GAP_X) + marginAlong / 2;
  const acrossExtent = marginAcross + rows * stepAcross - (vertical ? AGENT_GAP_X : AGENT_GAP_Y) + 16;

  const bands: IterationBand[] = [];
  const byIteration = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.iteration === undefined) continue;
    byIteration.set(n.iteration, [...(byIteration.get(n.iteration) ?? []), col.get(n.id)!]);
  }
  for (const [iteration, cols] of byIteration) {
    const from = Math.min(...cols);
    const to = Math.max(...cols);
    const start = marginAlong + from * stepAlong - (vertical ? AGENT_GAP_Y : AGENT_GAP_X) / 2;
    const length = (to - from + 1) * stepAlong;
    bands.push(vertical ? { iteration, x: 8, y: start, w: acrossExtent - 16, h: length } : { iteration, x: start, y: 10, w: length, h: acrossExtent - 18 });
  }
  bands.sort((a, b) => a.iteration - b.iteration);

  return {
    orientation,
    nodes: placed,
    order: ids,
    columns,
    rows,
    width: vertical ? acrossExtent : alongExtent,
    height: vertical ? alongExtent : acrossExtent,
    bands,
  };
}

/** A smooth path from the end of `from` to the start of `to`, following the flow direction. */
export function edgePath(from: PlacedNode, to: PlacedNode, orientation: GraphOrientation = "horizontal"): string {
  if (orientation === "vertical") {
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    if (Math.abs(x1 - x2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const dy = Math.max(16, (y2 - y1) / 2);
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
  }
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** Midpoint of an edge, for a label. */
export function edgeMidpoint(from: PlacedNode, to: PlacedNode, orientation: GraphOrientation = "horizontal"): { x: number; y: number } {
  if (orientation === "vertical") return { x: (from.x + from.w / 2 + to.x + to.w / 2) / 2, y: (from.y + from.h + to.y) / 2 };
  return { x: (from.x + from.w + to.x) / 2, y: (from.y + from.h / 2 + to.y + to.h / 2) / 2 };
}
