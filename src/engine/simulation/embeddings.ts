import { createRng } from "./random";

export const EMBEDDING_DIMS = 48;

export interface EmbeddingVector {
  token: string;
  position: number;
  /** Values in [-1, 1]. Educational visualization only. */
  values: number[];
}

export interface EmbeddingSimulation {
  dims: number;
  vectors: EmbeddingVector[];
  note: string;
}

/**
 * Produces a stable pseudo-vector per token. Identical tokens get identical
 * vectors (as a real embedding table would), and tokens that share a stem get
 * correlated vectors so the visual conveys "similar tokens → similar vectors".
 * These are NOT the model's weights.
 */
export function simulateEmbeddings(tokens: string[], dims = EMBEDDING_DIMS): EmbeddingSimulation {
  const vectors = tokens.map((token, position) => {
    const normalized = token.trim().toLowerCase();
    const stem = normalized.replace(/[^a-z]/g, "").slice(0, 4) || normalized || "·";
    const stemRng = createRng(`stem:${stem}`);
    const tokenRng = createRng(`token:${normalized}`);
    const values: number[] = [];
    for (let i = 0; i < dims; i++) {
      const base = stemRng.range(-1, 1);
      const jitter = tokenRng.range(-0.35, 0.35);
      values.push(Math.max(-1, Math.min(1, base * 0.75 + jitter)));
    }
    return { token, position, values };
  });
  return {
    dims,
    vectors,
    note: `Each token becomes a ${dims}-dimensional vector in this visualization. Real models use thousands of dimensions and learned values that are not exposed by the API.`,
  };
}
