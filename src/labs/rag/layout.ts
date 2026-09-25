import type { RagStageId } from "./stages";
import { INGEST_STAGES, QUERY_STAGES } from "./stages";

/** Virtual coordinate space of the RAG diagram. */
export const RAG_CANVAS_W = 1400;
export const RAG_CANVAS_H = 440;

export interface RagNodeLayout {
  id: RagStageId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which of the three rows the node sits in, for band labels. */
  band: 0 | 1 | 2;
}

export interface RagConnectionLayout {
  id: string;
  from: RagStageId;
  to: RagStageId;
  points: [number, number][];
  /** "flow" follows execution; "feed" is the index feeding the search (drawn dashed). */
  kind: "flow" | "feed";
}

const MARGIN = 36;
const GAP = 16;
const NODE_H = 66;
const BAND_Y: [number, number, number] = [40, 196, 352];

export const RAG_BAND_LABELS = ["01 · Ingestion · documents become vectors", "02 · Retrieval · a question finds its passages", "03 · Generation · passages become an answer"];

function band(ids: RagStageId[], y: number, index: 0 | 1 | 2, maxWidth = RAG_CANVAS_W - MARGIN * 2): RagNodeLayout[] {
  const available = maxWidth - (ids.length - 1) * GAP;
  const w = Math.max(120, Math.min(200, available / ids.length));
  return ids.map((id, i) => ({ id, x: MARGIN + i * (w + GAP), y, w, h: NODE_H, band: index }));
}

const bandB = QUERY_STAGES.slice(0, 5);
const bandC = QUERY_STAGES.slice(5);

export const RAG_NODES: RagNodeLayout[] = [...band(INGEST_STAGES, BAND_Y[0], 0), ...band(bandB, BAND_Y[1], 1), ...band(bandC, BAND_Y[2], 2)];

export const RAG_NODE_BY_ID: Record<RagStageId, RagNodeLayout> = Object.fromEntries(RAG_NODES.map((n) => [n.id, n])) as Record<RagStageId, RagNodeLayout>;

function centerY(n: RagNodeLayout): number {
  return n.y + n.h / 2;
}

function flowAcross(ids: RagStageId[]): RagConnectionLayout[] {
  const out: RagConnectionLayout[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const a = RAG_NODE_BY_ID[ids[i]!];
    const b = RAG_NODE_BY_ID[ids[i + 1]!];
    out.push({ id: `${a.id}-${b.id}`, from: a.id, to: b.id, kind: "flow", points: [[a.x + a.w, centerY(a)], [b.x, centerY(b)]] });
  }
  return out;
}

const indexNode = RAG_NODE_BY_ID.index;
const searchNode = RAG_NODE_BY_ID.search;
const retrievedNode = RAG_NODE_BY_ID.retrieved;
const contextNode = RAG_NODE_BY_ID.context;

export const RAG_CONNECTIONS: RagConnectionLayout[] = [
  ...flowAcross(INGEST_STAGES),
  ...flowAcross(bandB),
  ...flowAcross(bandC),
  // The built index is what the search reads: a feed line down and across.
  {
    id: "index-search",
    from: "index",
    to: "search",
    kind: "feed",
    points: [
      [indexNode.x + indexNode.w / 2, indexNode.y + indexNode.h],
      [indexNode.x + indexNode.w / 2, searchNode.y - 40],
      [searchNode.x + searchNode.w / 2, searchNode.y - 40],
      [searchNode.x + searchNode.w / 2, searchNode.y],
    ],
  },
  // Retrieved passages drop down to become the context.
  {
    id: "retrieved-context",
    from: "retrieved",
    to: "context",
    kind: "flow",
    points: [
      [retrievedNode.x + retrievedNode.w / 2, retrievedNode.y + retrievedNode.h],
      [retrievedNode.x + retrievedNode.w / 2, contextNode.y - 40],
      [contextNode.x + contextNode.w / 2, contextNode.y - 40],
      [contextNode.x + contextNode.w / 2, contextNode.y],
    ],
  },
];

/** Keyboard navigation order (matches execution order). */
export const RAG_NODE_ORDER: RagStageId[] = [...INGEST_STAGES, ...QUERY_STAGES];
