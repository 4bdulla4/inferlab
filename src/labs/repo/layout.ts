import type { ArchEdge, ArchNode, EvidenceKind, NodeCategory } from "@shared/repo";
import type { Point } from "@/engine/animation/geometry";

export const COLUMN_W = 210;
export const NODE_W = 178;
export const NODE_H = 78;
export const ROW_GAP = 22;
export const TOP_PAD = 46;
export const BOTTOM_PAD = 24;
export const MIN_HEIGHT = 420;

export const LAYER_LABELS: Record<number, string> = {
  0: "Clients",
  1: "Frontend",
  2: "API surface",
  3: "Services · Auth · Jobs",
  4: "Data",
  5: "AI · External",
  6: "Deployment",
};

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  client: "Client",
  frontend: "Frontend",
  api: "API",
  auth: "Auth",
  service: "Service",
  data: "Data",
  async: "Async",
  ai: "AI",
  external: "External",
  infra: "Infra",
};

export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  client: "#9aa3b5",
  frontend: "#22d3ee",
  api: "#60a5fa",
  auth: "#fbbf24",
  service: "#a78bfa",
  data: "#34d399",
  async: "#f472b6",
  ai: "#8e2dff",
  external: "#fb923c",
  infra: "#94a3b8",
};

export const EVIDENCE_COLOR: Record<EvidenceKind, string> = {
  verified: "#34d399",
  heuristic: "#fbbf24",
  ai: "#a78bfa",
};

export interface PositionedNode {
  node: ArchNode;
  x: number;
  y: number;
  w: number;
  h: number;
  column: number;
}

export interface PositionedEdge {
  edge: ArchEdge;
  points: Point[];
  d: string;
  backwards: boolean;
}

export interface DiagramLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
  columns: { column: number; layer: number; x: number; label: string }[];
}

/** Column-based (layered) layout. Empty layers are removed so the diagram stays compact. */
export function layoutGraph(nodes: ArchNode[], edges: ArchEdge[], hidden: Set<string> = new Set()): DiagramLayout {
  const visible = nodes.filter((n) => !hidden.has(n.id));
  const layers = [...new Set(visible.map((n) => n.layer))].sort((a, b) => a - b);
  const columnOf = new Map(layers.map((l, i) => [l, i]));
  const byColumn = new Map<number, ArchNode[]>();
  for (const n of visible) {
    const c = columnOf.get(n.layer)!;
    if (!byColumn.has(c)) byColumn.set(c, []);
    byColumn.get(c)!.push(n);
  }
  const maxRows = Math.max(1, ...[...byColumn.values()].map((c) => c.length));
  const contentH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  const height = Math.max(MIN_HEIGHT, TOP_PAD + contentH + BOTTOM_PAD);
  const width = Math.max(5, layers.length) * COLUMN_W;

  const positioned: PositionedNode[] = [];
  const pos = new Map<string, PositionedNode>();
  for (const [column, list] of byColumn) {
    const colH = list.length * NODE_H + (list.length - 1) * ROW_GAP;
    const startY = TOP_PAD + (contentH - colH) / 2;
    list.forEach((node, i) => {
      const p: PositionedNode = { node, x: column * COLUMN_W + (COLUMN_W - NODE_W) / 2, y: startY + i * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H, column };
      positioned.push(p);
      pos.set(node.id, p);
    });
  }

  const positionedEdges: PositionedEdge[] = [];
  for (const edge of edges) {
    const a = pos.get(edge.from);
    const b = pos.get(edge.to);
    if (!a || !b) continue;
    const points = routeEdge(a, b, edge);
    positionedEdges.push({ edge, points, d: toPath(points), backwards: b.column < a.column });
  }

  return {
    nodes: positioned,
    edges: positionedEdges,
    width,
    height,
    columns: layers.map((layer, column) => ({ column, layer, x: column * COLUMN_W, label: LAYER_LABELS[layer] ?? `Layer ${layer}` })),
  };
}

function routeEdge(a: PositionedNode, b: PositionedNode, edge: ArchEdge): Point[] {
  if (a.column === b.column) {
    // Same column: bow out to the right.
    const x = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const y2 = b.y + b.h / 2;
    const bulge = 46;
    return sampleCubic([x, y1], [x + bulge, y1], [x + bulge, y2], [x, y2]);
  }
  if (b.column > a.column) {
    const p0: Point = [a.x + a.w, a.y + a.h / 2];
    const p3: Point = [b.x, b.y + b.h / 2];
    const dx = Math.max(40, (p3[0] - p0[0]) * 0.45);
    return sampleCubic(p0, [p0[0] + dx, p0[1]], [p3[0] - dx, p3[1]], p3);
  }
  // Backwards edge (e.g. provider → webhooks, infra → frontend): exit left, enter right, arcing above.
  const p0: Point = [a.x, a.y + a.h / 2];
  const p3: Point = [b.x + b.w, b.y + b.h / 2];
  const lift = edge.kind === "deploys" ? -70 : -40;
  return sampleCubic(p0, [p0[0] - 60, p0[1] + lift], [p3[0] + 60, p3[1] + lift], p3);
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps = 22): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([
      mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
      mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function toPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}
