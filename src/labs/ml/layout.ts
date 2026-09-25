import type { MLStageId } from "./stages";
import { DATA_STAGES, DEPLOY_STAGES, EVAL_STAGES, TRAIN_STAGES } from "./stages";

/** Virtual coordinate space of the ML diagram. */
export const ML_CANVAS_W = 1400;
export const ML_CANVAS_H = 596;

export interface MLNodeLayout {
  id: MLStageId;
  x: number;
  y: number;
  w: number;
  h: number;
  band: 0 | 1 | 2 | 3;
}

export interface MLConnectionLayout {
  id: string;
  from: MLStageId;
  to: MLStageId;
  points: [number, number][];
  /** "flow" follows execution; "loop" is the training loop's return edge; "feed" is data feeding a later stage. */
  kind: "flow" | "loop" | "feed";
}

const MARGIN = 36;
const GAP = 16;
const NODE_H = 66;
const BAND_Y: [number, number, number, number] = [40, 196, 352, 508];

export const ML_BAND_LABELS = ["01 · Data · rows become matrices", "02 · Training · the loop that learns", "03 · Evaluation · did it learn?", "04 · Deployment · new data in, prediction out"];

function band(ids: MLStageId[], y: number, index: 0 | 1 | 2 | 3, maxWidth = ML_CANVAS_W - MARGIN * 2): MLNodeLayout[] {
  const available = maxWidth - (ids.length - 1) * GAP;
  const w = Math.max(120, Math.min(200, available / ids.length));
  return ids.map((id, i) => ({ id, x: MARGIN + i * (w + GAP), y, w, h: NODE_H, band: index }));
}

const evalAndDeploy = [...EVAL_STAGES];

export const ML_NODES: MLNodeLayout[] = [...band(DATA_STAGES, BAND_Y[0], 0), ...band(TRAIN_STAGES, BAND_Y[1], 1), ...band(evalAndDeploy, BAND_Y[2], 2), ...band(DEPLOY_STAGES, BAND_Y[3], 3)];

export const ML_NODE_BY_ID: Record<MLStageId, MLNodeLayout> = Object.fromEntries(ML_NODES.map((n) => [n.id, n])) as Record<MLStageId, MLNodeLayout>;

const cy = (n: MLNodeLayout) => n.y + n.h / 2;
const cx = (n: MLNodeLayout) => n.x + n.w / 2;

function flowAcross(ids: MLStageId[]): MLConnectionLayout[] {
  const out: MLConnectionLayout[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ML_NODE_BY_ID[ids[i]!];
    const b = ML_NODE_BY_ID[ids[i + 1]!];
    out.push({ id: `${a.id}-${b.id}`, from: a.id, to: b.id, kind: "flow", points: [[a.x + a.w, cy(a)], [b.x, cy(b)]] });
  }
  return out;
}

/** A drop from the end of one band to the start of the next. */
function drop(from: MLStageId, to: MLStageId): MLConnectionLayout {
  const a = ML_NODE_BY_ID[from];
  const b = ML_NODE_BY_ID[to];
  const midY = a.y + a.h + (b.y - (a.y + a.h)) / 2;
  return { id: `${from}-${to}`, from, to, kind: "flow", points: [[cx(a), a.y + a.h], [cx(a), midY], [cx(b), midY], [cx(b), b.y]] };
}

const iterate = ML_NODE_BY_ID.iterate;
const forward = ML_NODE_BY_ID.forward;

export const ML_CONNECTIONS: MLConnectionLayout[] = [
  ...flowAcross(DATA_STAGES),
  drop("split", "selectModel"),
  ...flowAcross(TRAIN_STAGES),
  // The loop: the next iteration returns to the forward pass, drawn below the band.
  { id: "iterate-forward", from: "iterate", to: "forward", kind: "loop", points: [[cx(iterate), iterate.y + iterate.h], [cx(iterate), iterate.y + iterate.h + 22], [cx(forward), forward.y + forward.h + 22], [cx(forward), forward.y + forward.h]] },
  drop("epoch", "validate"),
  ...flowAcross(EVAL_STAGES),
  drop("evaluate", "save"),
  ...flowAcross(DEPLOY_STAGES),
];

/** Keyboard navigation order (matches execution order). */
export const ML_NODE_ORDER: MLStageId[] = [...DATA_STAGES, ...TRAIN_STAGES, ...EVAL_STAGES, ...DEPLOY_STAGES];
