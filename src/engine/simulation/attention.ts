import { createRng } from "./random";

export interface AttentionSimulation {
  tokens: string[];
  /** weights[i][j] = how much position i attends to position j (causal: j ≤ i). Rows sum to 1. */
  weights: number[][];
  heads: number;
  note: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "to", "and", "or", "it", "its",
  "why", "how", "what", "do", "does", "did", "be", "for", "with", "as", "at", "by", "this", "that",
  "please", "explain", "me", "i", "you", "we", "they",
]);

function isContent(token: string): boolean {
  const t = token.trim().toLowerCase().replace(/[^a-z]/g, "");
  return t.length > 2 && !STOP_WORDS.has(t);
}

/**
 * Builds a plausible causal attention pattern: strong self/adjacent attention,
 * extra weight between content words, a mild "attention sink" on the first
 * token. Deterministic per token sequence. Educational only.
 */
export function simulateAttention(tokens: string[]): AttentionSimulation {
  const n = tokens.length;
  const rng = createRng(`attn:${tokens.join("|")}`);
  const weights: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    let sum = 0;
    for (let j = 0; j <= i; j++) {
      let score = 0.15;
      if (j === i) score += 0.55;
      if (j === i - 1) score += 0.35;
      if (j === 0 && i > 0) score += 0.25; // attention sink
      if (isContent(tokens[i]!) && isContent(tokens[j]!) && i !== j) score += 0.6;
      if (tokens[i]!.trim().toLowerCase() === tokens[j]!.trim().toLowerCase() && i !== j) score += 0.5;
      score *= 0.8 + rng.next() * 0.4;
      row[j] = score;
      sum += score;
    }
    for (let j = 0; j <= i; j++) row[j] = row[j]! / sum;
    weights.push(row);
  }
  return {
    tokens,
    weights,
    heads: 8,
    note: "Educational attention simulation. The Claude and OpenAI APIs do not return attention weights; this pattern illustrates causal self-attention structure only.",
  };
}
