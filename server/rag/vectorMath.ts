/**
 * Plain vector arithmetic on number[] vectors. Every function here is exact
 * math on the real vectors; nothing is approximated for display.
 */

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: number[]): number[] {
  const n = norm(a);
  return n === 0 ? a.slice() : a.map((v) => v / n);
}

/** Cosine similarity in [-1, 1]; 0 when either vector is all zeros. */
export function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export function mean(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0]!.length;
  const out = new Array<number>(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i]! += v[i]!;
  return out.map((x) => x / vectors.length);
}

/**
 * k-means with deterministic seeding (first k vectors spread by index), used to
 * build IVF coarse lists. Returns each vector's list and the centroids.
 */
export function kmeans(vectors: number[][], k: number, iterations = 12): { assignments: number[]; centroids: number[][] } {
  const n = vectors.length;
  const clusters = Math.max(1, Math.min(k, n));
  const centroids = Array.from({ length: clusters }, (_, i) => vectors[Math.floor((i * n) / clusters)]!.slice());
  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestScore = -Infinity;
      for (let c = 0; c < clusters; c++) {
        const s = cosine(vectors[i]!, centroids[c]!);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }
    for (let c = 0; c < clusters; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length > 0) centroids[c] = normalize(mean(members));
    }
    if (!moved) break;
  }
  return { assignments, centroids };
}

/**
 * Top-2 principal components by power iteration, so the browser can draw the
 * real vectors on a plane. Positions are a lossy view; relative closeness in
 * the plane is a hint, not the similarity the search used.
 */
export function pca2d(vectors: number[][]): { x: number; y: number }[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0]!.length;
  const center = mean(vectors);
  const centered = vectors.map((v) => v.map((x, i) => x - center[i]!));
  if (vectors.length === 1) return [{ x: 0, y: 0 }];

  const component = (exclude: number[] | null): number[] => {
    let w = Array.from({ length: dims }, (_, i) => Math.sin(i * 12.9898 + 78.233) * 0.5 + 0.5);
    w = normalize(w);
    for (let iter = 0; iter < 40; iter++) {
      const next = new Array<number>(dims).fill(0);
      for (const v of centered) {
        const proj = dot(v, w);
        for (let i = 0; i < dims; i++) next[i]! += proj * v[i]!;
      }
      if (exclude) {
        const along = dot(next, exclude);
        for (let i = 0; i < dims; i++) next[i]! -= along * exclude[i]!;
      }
      const nn = norm(next);
      if (nn === 0) break;
      w = next.map((x) => x / nn);
    }
    return w;
  };

  const p1 = component(null);
  const p2 = component(p1);
  const raw = centered.map((v) => ({ x: dot(v, p1), y: dot(v, p2) }));
  // Scale into [-1, 1] on the larger axis so every knowledge base draws the same size.
  const extent = Math.max(1e-9, ...raw.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  return raw.map((p) => ({ x: p.x / extent, y: p.y / extent }));
}

/** Projects one new vector onto the plane of an existing projection, for the query point. */
export function projectOnto(vectors: number[][], projected: { x: number; y: number }[], vector: number[]): { x: number; y: number } | null {
  if (vectors.length < 2) return null;
  // Least-squares fit of the projection back to the basis: find p1, p2 from the data.
  const center = mean(vectors);
  const centered = vectors.map((v) => v.map((x, i) => x - center[i]!));
  const dims = vector.length;
  const p1 = new Array<number>(dims).fill(0);
  const p2 = new Array<number>(dims).fill(0);
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < centered.length; k++) {
    const v = centered[k]!;
    const { x, y } = projected[k]!;
    sxx += x * x;
    syy += y * y;
    for (let i = 0; i < dims; i++) {
      p1[i]! += x * v[i]!;
      p2[i]! += y * v[i]!;
    }
  }
  if (sxx === 0 || syy === 0) return null;
  const q = vector.map((x, i) => x - center[i]!);
  return { x: dot(q, p1) / sxx, y: dot(q, p2) / syy };
}
