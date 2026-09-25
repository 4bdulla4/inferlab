import type { DataSource, TokenAlternatives } from "@shared/llm";
import { createRng } from "./random";

export interface Candidate {
  token: string;
  probability: number;
  logprob: number | null;
  selected: boolean;
}

export interface CandidateSet {
  step: number;
  candidates: Candidate[];
  source: DataSource;
  note: string;
}

const FILLERS = [
  " the", " a", " is", " of", " and", " to", " in", " that", " because", " light", " sky", " blue",
  " when", " which", " it", " this", " sun", " air", " we", " color", " more", " as", " from", " like",
  " The", " In", " When", " Light", " Sunlight", ",", ".", " —", " (", " so", " but", " than", " its",
];

/** Converts real API log probabilities into a display-ready candidate set. */
export function candidatesFromLogprobs(step: number, alternatives: TokenAlternatives): CandidateSet {
  const seen = new Set<string>();
  const list: Candidate[] = [];
  const push = (token: string, logprob: number, selected: boolean) => {
    if (seen.has(token)) {
      const existing = list.find((c) => c.token === token);
      if (existing && selected) existing.selected = true;
      return;
    }
    seen.add(token);
    list.push({ token, logprob, probability: Math.exp(logprob), selected });
  };
  push(alternatives.token, alternatives.logprob, true);
  for (const alt of alternatives.top) push(alt.token, alt.logprob, alt.token === alternatives.token);
  list.sort((a, b) => b.probability - a.probability);
  return {
    step,
    candidates: list,
    source: "live",
    note: "Top log probabilities returned by the provider API for this position. Probabilities are exp(logprob); the list may not sum to 100% because only the top candidates are returned.",
  };
}

/**
 * Illustrative candidate distribution when the provider exposes no logprobs.
 * The selected token is the REAL streamed token; the alternatives and their
 * shares are simulated and labeled as such.
 */
export function simulateCandidates(step: number, selectedToken: string, contextTokens: string[]): CandidateSet {
  const rng = createRng(`cand:${step}:${selectedToken}:${contextTokens.slice(-4).join("|")}`);
  const pool = [...FILLERS, ...contextTokens.slice(-8).map((t) => (t.startsWith(" ") ? t : ` ${t.trim()}`))].filter(
    (t) => t !== selectedToken && t.trim().length > 0,
  );
  const alternatives: string[] = [];
  while (alternatives.length < 4 && pool.length > 0) {
    const pick = rng.pick(pool);
    if (!alternatives.includes(pick)) alternatives.push(pick);
  }
  const top = rng.range(0.34, 0.72);
  let remaining = 1 - top;
  const candidates: Candidate[] = [{ token: selectedToken, probability: top, logprob: null, selected: true }];
  alternatives.forEach((token, i) => {
    const share = i === alternatives.length - 1 ? remaining * 0.55 : remaining * rng.range(0.3, 0.55);
    remaining -= share;
    candidates.push({ token, probability: share, logprob: null, selected: false });
  });
  candidates.sort((a, b) => b.probability - a.probability);
  return {
    step,
    candidates,
    source: "simulation",
    note: "Educational simulation. The selected token is the real streamed output; the alternative candidates and their shares are illustrative because this provider does not return log probabilities.",
  };
}
