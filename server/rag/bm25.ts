/**
 * BM25 over chunk texts: the classic lexical ranking function. Real algorithm,
 * standard constants (k1 = 1.2, b = 0.75), used for the hybrid strategy.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were", "be", "it", "this", "that",
  "with", "as", "by", "at", "from", "its", "into", "than", "then", "so", "but", "not", "no", "do", "does", "did", "how",
  "what", "why", "when", "where", "which", "who", "can", "could", "would", "should", "will", "i", "you", "we", "they",
]);

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface Bm25Index {
  score(query: string, docIndex: number): number;
  /** Which query terms occur in the document, for highlighting. */
  matched(query: string, docIndex: number): string[];
  size: number;
}

export function buildBm25(docs: string[], k1 = 1.2, b = 0.75): Bm25Index {
  const tokenized = docs.map(terms);
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const tf = tokenized.map((toks) => {
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const n = docs.length;
  const avgLen = n === 0 ? 0 : tokenized.reduce((s, t) => s + t.length, 0) / n;
  const idf = (t: string) => {
    const d = df.get(t) ?? 0;
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  };
  return {
    size: n,
    score(query, i) {
      const q = terms(query);
      const len = tokenized[i]?.length ?? 0;
      let s = 0;
      for (const t of q) {
        const f = tf[i]?.get(t) ?? 0;
        if (f === 0) continue;
        s += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / Math.max(1, avgLen))));
      }
      return s;
    },
    matched(query, i) {
      const q = new Set(terms(query));
      return [...q].filter((t) => (tf[i]?.get(t) ?? 0) > 0);
    },
  };
}
