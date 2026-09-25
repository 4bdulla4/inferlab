import type { RagChunk, RetrievalStrategy, ScoredChunk, SearchReport } from "@shared/rag";
import { buildBm25, type Bm25Index } from "./bm25";
import type { VectorIndex } from "./vectorStore";
import { cosine } from "./vectorMath";

export interface RetrievalInput {
  question: string;
  queryVector: number[];
  index: VectorIndex;
  chunks: RagChunk[];
  vectorsById: Map<string, number[]>;
  topK: number;
  threshold: number;
  strategy: RetrievalStrategy;
}

export interface RetrievalOutput {
  results: ScoredChunk[];
  report: SearchReport;
  explanation: string;
}

export const MMR_LAMBDA = 0.7;
export const RRF_K = 60;

interface Candidate {
  chunkId: string;
  vectorScore: number;
}

/** Runs one retrieval strategy end to end and explains the ranking it produced. */
export function retrieve(input: RetrievalInput): RetrievalOutput {
  const start = Date.now();
  const { question, queryVector, index, chunks, topK, threshold, strategy } = input;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  // Ask the index for a generous candidate pool so MMR and hybrid have room to reorder.
  const pool = Math.min(index.size, Math.max(topK * 4, 20));
  const outcome = index.search(queryVector, pool);
  const candidates: Candidate[] = outcome.hits.map((h) => ({ chunkId: h.id, vectorScore: h.score }));
  const passing = candidates.filter((c) => c.vectorScore >= threshold);
  const belowThreshold = candidates.length - passing.length;
  const bm25 = buildBm25(chunks.map((c) => c.text));
  const chunkIndex = new Map(chunks.map((c, i) => [c.id, i]));
  const matched = (id: string) => bm25.matched(question, chunkIndex.get(id) ?? -1);

  let results: ScoredChunk[];
  let explanation: string;

  if (strategy === "similarity") {
    results = passing.slice(0, topK).map((c, i) => ({
      chunkId: c.chunkId,
      docId: byId.get(c.chunkId)?.docId ?? "",
      rank: i + 1,
      score: c.vectorScore,
      vectorScore: c.vectorScore,
      reason:
        i === 0
          ? `Highest cosine similarity to the query vector (${c.vectorScore.toFixed(3)}).`
          : `Cosine ${c.vectorScore.toFixed(3)}, ${(passing[i - 1]!.vectorScore - c.vectorScore).toFixed(3)} below rank ${i}.`,
      matchedTerms: matched(c.chunkId),
    }));
    explanation = `Ranked ${candidates.length} candidates by cosine similarity, dropped ${belowThreshold} below ${threshold.toFixed(2)}, kept the top ${results.length}.`;
  } else if (strategy === "mmr") {
    results = mmr(passing, input, byId, matched);
    explanation = `Maximal marginal relevance with λ=${MMR_LAMBDA}: each pick balances similarity to the query against similarity to chunks already chosen, so near-duplicate passages do not crowd out different ones.`;
  } else {
    results = hybrid(question, candidates, input, byId, bm25, chunkIndex, matched);
    explanation = `Hybrid: vector ranks and BM25 keyword ranks fused with reciprocal rank fusion (k=${RRF_K}), so a chunk that scores well on either side rises.`;
  }

  const report: SearchReport = {
    strategy,
    index: index.stats.kind,
    compared: outcome.compared,
    total: index.size,
    probedLists: outcome.probedLists,
    candidates,
    belowThreshold,
    ms: Date.now() - start,
  };
  return { results, report, explanation };
}

function mmr(passing: Candidate[], input: RetrievalInput, byId: Map<string, RagChunk>, matched: (id: string) => string[]): ScoredChunk[] {
  const chosen: ScoredChunk[] = [];
  const remaining = [...passing];
  while (chosen.length < input.topK && remaining.length > 0) {
    let best = -1;
    let bestScore = -Infinity;
    let bestPenalty = 0;
    remaining.forEach((c, i) => {
      const v = input.vectorsById.get(c.chunkId);
      let redundancy = 0;
      for (const picked of chosen) {
        const pv = input.vectorsById.get(picked.chunkId);
        if (v && pv) redundancy = Math.max(redundancy, cosine(v, pv));
      }
      const score = MMR_LAMBDA * c.vectorScore - (1 - MMR_LAMBDA) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestPenalty = redundancy;
      }
    });
    const pick = remaining.splice(best, 1)[0]!;
    chosen.push({
      chunkId: pick.chunkId,
      docId: byId.get(pick.chunkId)?.docId ?? "",
      rank: chosen.length + 1,
      score: bestScore,
      vectorScore: pick.vectorScore,
      redundancyPenalty: bestPenalty,
      reason:
        chosen.length === 0
          ? `First pick: highest similarity (${pick.vectorScore.toFixed(3)}), nothing to be redundant with yet.`
          : `Similarity ${pick.vectorScore.toFixed(3)}, overlaps ${bestPenalty.toFixed(3)} with earlier picks → MMR score ${bestScore.toFixed(3)}.`,
      matchedTerms: matched(pick.chunkId),
    });
  }
  return chosen;
}

function hybrid(
  question: string,
  candidates: Candidate[],
  input: RetrievalInput,
  byId: Map<string, RagChunk>,
  bm25: Bm25Index,
  chunkIndex: Map<string, number>,
  matched: (id: string) => string[],
): ScoredChunk[] {
  const vectorRank = new Map(candidates.map((c, i) => [c.chunkId, i + 1]));
  const vectorScore = new Map(candidates.map((c) => [c.chunkId, c.vectorScore]));
  const lexical = input.chunks
    .map((c) => ({ chunkId: c.id, score: bm25.score(question, chunkIndex.get(c.id)!) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const lexicalRank = new Map(lexical.map((c, i) => [c.chunkId, i + 1]));
  const lexicalScore = new Map(lexical.map((c) => [c.chunkId, c.score]));

  const ids = new Set([...vectorRank.keys(), ...lexicalRank.keys()]);
  const fused = [...ids]
    .map((id) => {
      const vr = vectorRank.get(id);
      const lr = lexicalRank.get(id);
      const score = (vr ? 1 / (RRF_K + vr) : 0) + (lr ? 1 / (RRF_K + lr) : 0);
      // A chunk found only by keywords still has a real cosine; compute it rather than guess.
      const vs = vectorScore.get(id) ?? cosineFor(id, input);
      return { id, score, vr, lr, vs };
    })
    .filter((f) => f.vs >= input.threshold || (f.lr !== undefined && f.lr <= input.topK))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topK);

  return fused.map((f, i) => ({
    chunkId: f.id,
    docId: byId.get(f.id)?.docId ?? "",
    rank: i + 1,
    score: f.score,
    vectorScore: f.vs,
    lexicalScore: lexicalScore.get(f.id),
    vectorRank: f.vr,
    lexicalRank: f.lr,
    reason: [f.vr ? `vector rank ${f.vr}` : "outside the vector pool", f.lr ? `keyword rank ${f.lr}` : "no keyword match", `fused ${f.score.toFixed(4)}`].join(" · "),
    matchedTerms: matched(f.id),
  }));
}

function cosineFor(id: string, input: RetrievalInput): number {
  const v = input.vectorsById.get(id);
  return v ? cosine(input.queryVector, v) : 0;
}
