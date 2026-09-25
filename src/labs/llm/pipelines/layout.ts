import type { LLMStageId } from "../stages";
import type { ConnectionLayout, NodeLayout } from "../layout";

export const CANVAS_W = 1400;
export const CANVAS_H = 548;

const MARGIN = 36;
const GAP = 16;
const ROW_H = 64;
const BLOCK_X = 782;
const BLOCK_Y = 150;
const BLOCK_W = 582;
const BLOCK_HEADER = 34;
const INNER_H = 48;
const INNER_GAP = 8;
const INNER_PAD = 14;

export interface BandSpec {
  /** Stage ids in flow order. */
  ids: LLMStageId[];
  y: number;
  /** "rtl" lays the flow out right-to-left (the return path under the model). */
  dir: "ltr" | "rtl";
  /** Right edge for rtl bands; left edge for ltr bands. */
  edge?: number;
  maxWidth?: number;
}

export interface BuiltLayout {
  nodes: NodeLayout[];
  byId: Partial<Record<LLMStageId, NodeLayout>>;
  connections: ConnectionLayout[];
  width: number;
  height: number;
}

function layoutBand(band: BandSpec): NodeLayout[] {
  const available = (band.maxWidth ?? CANVAS_W - MARGIN * 2) - (band.ids.length - 1) * GAP;
  const w = Math.max(132, Math.min(190, available / band.ids.length));
  return band.ids.map((id, i) => {
    const x = band.dir === "ltr" ? (band.edge ?? MARGIN) + i * (w + GAP) : (band.edge ?? CANVAS_W - MARGIN) - w - i * (w + GAP);
    return { id, x, y: band.y, w, h: ROW_H, variant: "default" as const };
  });
}

/**
 * Builds diagram geometry from a provider's bands, so each provider can have a
 * different set of stages without hand-placing boxes.
 */
export function buildLayout(bands: BandSpec[], blockInner: LLMStageId[]): BuiltLayout {
  const nodes: NodeLayout[] = [];
  for (const band of bands) nodes.push(...layoutBand(band));

  const blockH = BLOCK_HEADER + blockInner.length * INNER_H + (blockInner.length - 1) * INNER_GAP + INNER_PAD + 10;
  nodes.push({ id: "transformer", x: BLOCK_X, y: BLOCK_Y, w: BLOCK_W, h: blockH, variant: "block" });
  blockInner.forEach((id, i) => {
    nodes.push({
      id,
      x: BLOCK_X + 20,
      y: BLOCK_Y + BLOCK_HEADER + i * (INNER_H + INNER_GAP),
      w: BLOCK_W - 40,
      h: INNER_H,
      variant: "inner",
      parent: "transformer",
    });
  });

  const byId: Partial<Record<LLMStageId, NodeLayout>> = {};
  for (const n of nodes) byId[n.id] = n;
  const centerY = (n: NodeLayout) => n.y + n.h / 2;
  const connections: ConnectionLayout[] = [];
  const link = (from: LLMStageId, to: LLMStageId, kind: ConnectionLayout["kind"], points: [number, number][]) => {
    if (byId[from] && byId[to]) connections.push({ id: `${from}-${to}`, from, to, kind, points });
  };

  // Horizontal flow inside each band.
  for (const band of bands) {
    for (let i = 0; i < band.ids.length - 1; i++) {
      const a = byId[band.ids[i]!]!;
      const b = byId[band.ids[i + 1]!]!;
      const y = centerY(a);
      const points: [number, number][] = band.dir === "ltr" ? [[a.x + a.w, y], [b.x, y]] : [[a.x, y], [b.x + b.w, y]];
      link(band.ids[i]!, band.ids[i + 1]!, "flow", points);
    }
  }

  // Into the model block, out of it, back around the loop.
  const block = byId.transformer!;
  const preBand = bands[0]!;
  const lastPre = byId[preBand.ids[preBand.ids.length - 1]!]!;
  link(preBand.ids[preBand.ids.length - 1]!, "transformer", "flow", [
    [lastPre.x + lastPre.w / 2, lastPre.y + lastPre.h],
    [lastPre.x + lastPre.w / 2, BLOCK_Y],
  ]);

  const outBand = bands[1];
  if (outBand) {
    const first = byId[outBand.ids[0]!]!;
    link("transformer", outBand.ids[0]!, "flow", [
      [block.x, centerY(first)],
      [first.x + first.w, centerY(first)],
    ]);
    const lastOut = byId[outBand.ids[outBand.ids.length - 1]!]!;
    const tailBand = bands[2];
    if (tailBand) {
      const firstTail = byId[tailBand.ids[0]!]!;
      link(outBand.ids[outBand.ids.length - 1]!, tailBand.ids[0]!, "flow", [
        [lastOut.x + lastOut.w / 2, lastOut.y + lastOut.h],
        [firstTail.x + firstTail.w / 2, firstTail.y],
      ]);
      const loopNode = tailBand.ids.includes("loop") ? byId.loop! : firstTail;
      link("loop", "transformer", "loop", [
        [loopNode.x + loopNode.w / 2, loopNode.y],
        [loopNode.x + loopNode.w / 2, loopNode.y - 36],
        [block.x + block.w / 2, loopNode.y - 36],
        [block.x + block.w / 2, block.y + blockH],
      ]);
    }
  }

  // Chain inside the model block.
  for (let i = 0; i < blockInner.length - 1; i++) {
    const a = byId[blockInner[i]!]!;
    const b = byId[blockInner[i + 1]!]!;
    link(blockInner[i]!, blockInner[i + 1]!, "internal", [
      [a.x + a.w / 2, a.y + a.h],
      [b.x + b.w / 2, b.y],
    ]);
  }

  return { nodes, byId, connections, width: CANVAS_W, height: CANVAS_H };
}
