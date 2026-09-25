import type { IndexStats, VectorIndexKind } from "@shared/rag";
import { cosine, kmeans } from "./vectorMath";

export interface SearchHit {
  id: string;
  score: number;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** How many stored vectors were compared against the query. */
  compared: number;
  probedLists?: number[];
}

/**
 * An in-memory vector index. "flat" compares the query with every vector, so
 * it is exact. "ivf" clusters vectors into coarse lists and only compares
 * against the closest lists, trading recall for fewer comparisons: the same
 * trade a production vector database makes, at a size where you can watch it.
 */
export class VectorIndex {
  readonly stats: IndexStats;
  private readonly ids: string[];
  private readonly vectors: number[][];
  private lists: number[][] = [];
  private centroids: number[][] = [];

  constructor(kind: VectorIndexKind, ids: string[], vectors: number[][]) {
    const start = Date.now();
    this.ids = ids;
    this.vectors = vectors;
    let lists: number | undefined;
    let probes: number | undefined;
    let effective: VectorIndexKind = kind;
    if (kind === "ivf" && vectors.length >= 4) {
      lists = Math.max(2, Math.round(Math.sqrt(vectors.length)));
      probes = Math.max(1, Math.ceil(lists / 3));
      const { assignments, centroids } = kmeans(vectors, lists);
      this.centroids = centroids;
      this.lists = centroids.map(() => []);
      assignments.forEach((c, i) => this.lists[c]!.push(i));
    } else if (kind === "ivf") {
      // Too few vectors to cluster meaningfully; behave as flat and report that.
      effective = "flat";
    }
    this.stats = {
      kind: effective,
      vectors: vectors.length,
      dims: vectors[0]?.length ?? 0,
      lists,
      probes,
      builtAt: Date.now(),
      buildMs: Date.now() - start,
    };
  }

  search(query: number[], limit: number): SearchOutcome {
    if (this.stats.kind === "flat") {
      const hits = this.vectors.map((v, i) => ({ id: this.ids[i]!, score: cosine(query, v) }));
      hits.sort((a, b) => b.score - a.score);
      return { hits: hits.slice(0, limit), compared: this.vectors.length };
    }
    const ranked = this.centroids.map((c, i) => ({ i, s: cosine(query, c) })).sort((a, b) => b.s - a.s);
    const probed = ranked.slice(0, this.stats.probes ?? 1).map((r) => r.i);
    const hits: SearchHit[] = [];
    let compared = 0;
    for (const list of probed) {
      for (const idx of this.lists[list]!) {
        hits.push({ id: this.ids[idx]!, score: cosine(query, this.vectors[idx]!) });
        compared += 1;
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits: hits.slice(0, limit), compared, probedLists: probed };
  }

  /** Which coarse list a stored vector belongs to (IVF only), for drawing clusters. */
  listOf(id: string): number | undefined {
    if (this.stats.kind !== "ivf") return undefined;
    const idx = this.ids.indexOf(id);
    return this.lists.findIndex((l) => l.includes(idx));
  }

  get size(): number {
    return this.vectors.length;
  }
}
