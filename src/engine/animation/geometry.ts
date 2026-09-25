export type Point = [number, number];

export interface Segment {
  from: Point;
  to: Point;
  length: number;
  cumulative: number;
}

export interface PolylinePath {
  points: Point[];
  segments: Segment[];
  length: number;
}

export function buildPath(points: Point[]): PolylinePath {
  const segments: Segment[] = [];
  let cumulative = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    segments.push({ from, to, length, cumulative });
    cumulative += length;
  }
  return { points, segments, length: cumulative };
}

/** Point at normalized distance t ∈ [0,1] along the polyline. */
export function pointAt(path: PolylinePath, t: number): Point {
  const target = Math.max(0, Math.min(1, t)) * path.length;
  for (const seg of path.segments) {
    if (target <= seg.cumulative + seg.length || seg === path.segments[path.segments.length - 1]) {
      const local = seg.length === 0 ? 0 : (target - seg.cumulative) / seg.length;
      return [seg.from[0] + (seg.to[0] - seg.from[0]) * local, seg.from[1] + (seg.to[1] - seg.from[1]) * local];
    }
  }
  return path.points[path.points.length - 1] ?? [0, 0];
}

/** SVG path data with softly rounded corners. */
export function toSvgPath(points: Point[], radius = 10): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]![0]} ${points[0]![1]}`;
  if (points.length === 2) return `M ${points[0]![0]} ${points[0]![1]} L ${points[1]![0]} ${points[1]![1]}`;
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    const outLen = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inPoint: Point = [curr[0] - ((curr[0] - prev[0]) / inLen) * r, curr[1] - ((curr[1] - prev[1]) / inLen) * r];
    const outPoint: Point = [curr[0] + ((next[0] - curr[0]) / outLen) * r, curr[1] + ((next[1] - curr[1]) / outLen) * r];
    d += ` L ${inPoint[0]} ${inPoint[1]} Q ${curr[0]} ${curr[1]} ${outPoint[0]} ${outPoint[1]}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}
