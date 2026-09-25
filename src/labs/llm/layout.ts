import type { LLMStageId } from "./stages";

/** Virtual coordinate space of the pipeline diagram. */
export const PIPELINE_W = 1280;
export const PIPELINE_H = 540;

export type NodeVariant = "default" | "block" | "inner" | "wide";

export interface NodeLayout {
  id: LLMStageId;
  x: number;
  y: number;
  w: number;
  h: number;
  variant: NodeVariant;
  parent?: LLMStageId;
}

export interface ConnectionLayout {
  id: string;
  from: LLMStageId;
  to: LLMStageId;
  /** Polyline in virtual coordinates. */
  points: [number, number][];
  kind: "flow" | "loop" | "internal";
}

const ROW1_Y = 36;
const ROW2_Y = 222;
const ROW3_Y = 430;
const NODE_W = 180;
const NODE_H = 66;

export const NODE_LAYOUTS: NodeLayout[] = [
  { id: "input", x: 40, y: ROW1_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "request", x: 238, y: ROW1_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "tokenization", x: 436, y: ROW1_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "tokenIds", x: 634, y: ROW1_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "embeddings", x: 832, y: ROW1_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "positional", x: 1030, y: ROW1_Y, w: NODE_W, h: NODE_H, variant: "default" },

  { id: "transformer", x: 700, y: 160, w: 540, h: 190, variant: "block" },
  { id: "attention", x: 730, y: 196, w: 480, h: 52, variant: "inner", parent: "transformer" },
  { id: "mlp", x: 730, y: 266, w: 480, h: 52, variant: "inner", parent: "transformer" },

  { id: "logits", x: 448, y: ROW2_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "probabilities", x: 244, y: ROW2_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "tokenSelection", x: 40, y: ROW2_Y, w: NODE_W, h: NODE_H, variant: "default" },

  { id: "nextToken", x: 40, y: ROW3_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "loop", x: 244, y: ROW3_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "detokenization", x: 448, y: ROW3_Y, w: NODE_W, h: NODE_H, variant: "default" },
  { id: "response", x: 700, y: ROW3_Y, w: 540, h: NODE_H, variant: "wide" },
];

export const NODE_BY_ID: Record<LLMStageId, NodeLayout> = Object.fromEntries(
  NODE_LAYOUTS.map((n) => [n.id, n]),
) as Record<LLMStageId, NodeLayout>;

const r1 = ROW1_Y + NODE_H / 2; // 69
const r2 = ROW2_Y + NODE_H / 2; // 255
const r3 = ROW3_Y + NODE_H / 2; // 463

export const CONNECTIONS: ConnectionLayout[] = [
  { id: "input-request", from: "input", to: "request", kind: "flow", points: [[220, r1], [238, r1]] },
  { id: "request-tokenization", from: "request", to: "tokenization", kind: "flow", points: [[418, r1], [436, r1]] },
  { id: "tokenization-tokenIds", from: "tokenization", to: "tokenIds", kind: "flow", points: [[616, r1], [634, r1]] },
  { id: "tokenIds-embeddings", from: "tokenIds", to: "embeddings", kind: "flow", points: [[814, r1], [832, r1]] },
  { id: "embeddings-positional", from: "embeddings", to: "positional", kind: "flow", points: [[1012, r1], [1030, r1]] },
  { id: "positional-transformer", from: "positional", to: "transformer", kind: "flow", points: [[1120, 102], [1120, 160]] },
  { id: "attention-mlp", from: "attention", to: "mlp", kind: "internal", points: [[970, 248], [970, 266]] },
  { id: "transformer-logits", from: "transformer", to: "logits", kind: "flow", points: [[700, r2], [628, r2]] },
  { id: "logits-probabilities", from: "logits", to: "probabilities", kind: "flow", points: [[448, r2], [424, r2]] },
  { id: "probabilities-tokenSelection", from: "probabilities", to: "tokenSelection", kind: "flow", points: [[244, r2], [220, r2]] },
  { id: "tokenSelection-nextToken", from: "tokenSelection", to: "nextToken", kind: "flow", points: [[130, 288], [130, 430]] },
  { id: "nextToken-loop", from: "nextToken", to: "loop", kind: "flow", points: [[220, r3], [244, r3]] },
  { id: "loop-transformer", from: "loop", to: "transformer", kind: "loop", points: [[334, 430], [334, 392], [970, 392], [970, 350]] },
  { id: "loop-detokenization", from: "loop", to: "detokenization", kind: "flow", points: [[424, r3], [448, r3]] },
  { id: "detokenization-response", from: "detokenization", to: "response", kind: "flow", points: [[628, r3], [700, r3]] },
];

export const CONNECTION_BY_ID: Record<string, ConnectionLayout> = Object.fromEntries(
  CONNECTIONS.map((c) => [c.id, c]),
);

/** Connections that make up the autoregressive cycle (ambient flow during generation). */
export const GENERATION_CYCLE: string[] = [
  "transformer-logits",
  "logits-probabilities",
  "probabilities-tokenSelection",
  "tokenSelection-nextToken",
  "nextToken-loop",
  "loop-transformer",
  "attention-mlp",
];

/** Keyboard navigation order (matches execution order). */
export const NODE_ORDER: LLMStageId[] = [
  "input",
  "request",
  "tokenization",
  "tokenIds",
  "embeddings",
  "positional",
  "transformer",
  "attention",
  "mlp",
  "logits",
  "probabilities",
  "tokenSelection",
  "nextToken",
  "loop",
  "detokenization",
  "response",
];
