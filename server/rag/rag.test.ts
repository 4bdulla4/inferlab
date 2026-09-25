import { describe, expect, it } from "vitest";
import type { RagChunk, RagDocument, ScoredChunk } from "@shared/rag";
import { buildBm25, terms } from "./bm25";
import { chunkText, countTokens } from "./chunker";
import { assemblePrompt, buildContext, extractCitations } from "./context";
import { embedLocal } from "./embeddings";
import { extractHtml } from "./extract";
import { sanitizeSettings } from "./KnowledgeBase";
import { MMR_LAMBDA, retrieve } from "./retrieval";
import { cosine, kmeans, normalize, pca2d } from "./vectorMath";
import { VectorIndex } from "./vectorStore";

const LOREM =
  "The sky appears blue because of Rayleigh scattering. Sunlight contains all wavelengths. Shorter wavelengths scatter more strongly than longer ones. " +
  "At sunset the light path is longer, so blue is scattered away and red remains. Clouds are white because their droplets scatter every colour equally. " +
  "Violet scatters even more than blue, yet the sky is not violet, partly because human eyes are less sensitive to it. ";

function longText(repeats = 12): string {
  return Array.from({ length: repeats }, (_, i) => `Paragraph ${i + 1}. ${LOREM}`).join("\n\n");
}

describe("chunker", () => {
  it("cuts real token windows of the requested size with exact overlap", () => {
    const text = longText();
    const chunks = chunkText("d1", text, { chunkSize: 64, chunkOverlap: 16 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(64);
      // The chunk's own text really is that many tokens.
      expect(countTokens(c.text)).toBe(c.tokenCount);
    }
    expect(chunks[0]!.overlapTokens).toBe(0);
    for (const c of chunks.slice(1, -1)) expect(c.overlapTokens).toBe(16);
  });

  it("covers the whole document without gaps", () => {
    const text = longText(4);
    const chunks = chunkText("d1", text, { chunkSize: 48, chunkOverlap: 8 });
    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[chunks.length - 1]!.charEnd).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.charStart).toBeLessThanOrEqual(chunks[i - 1]!.charEnd);
  });

  it("assigns pages from page offsets", () => {
    const text = "Page one text. ".repeat(20) + "Page two text. ".repeat(20);
    const chunks = chunkText("d1", text, { chunkSize: 40, chunkOverlap: 0 }, [{ page: 1, start: 0 }, { page: 2, start: "Page one text. ".repeat(20).length }]);
    expect(chunks[0]!.page).toBe(1);
    expect(chunks[chunks.length - 1]!.page).toBe(2);
  });

  it("never lets overlap swallow the window", () => {
    const chunks = chunkText("d1", longText(3), { chunkSize: 32, chunkOverlap: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokenCount > 0)).toBe(true);
  });
});

describe("vector math", () => {
  it("cosine is 1 for parallel vectors, 0 for orthogonal, 0 for zero", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("normalize yields unit length", () => {
    const v = normalize([3, 4]);
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1, 9);
  });

  it("kmeans separates two obvious clusters", () => {
    const a = Array.from({ length: 10 }, (_, i) => normalize([1, 0.01 * i, 0]));
    const b = Array.from({ length: 10 }, (_, i) => normalize([0, 0.01 * i, 1]));
    const { assignments } = kmeans([...a, ...b], 2);
    expect(new Set(assignments.slice(0, 10)).size).toBe(1);
    expect(new Set(assignments.slice(10)).size).toBe(1);
    expect(assignments[0]).not.toBe(assignments[10]);
  });

  it("pca2d scales into the unit square and keeps clusters apart", () => {
    const a = Array.from({ length: 8 }, (_, i) => normalize([1, 0.05 * i, 0, 0.1]));
    const b = Array.from({ length: 8 }, (_, i) => normalize([0, 0.05 * i, 1, 0.1]));
    const pts = pca2d([...a, ...b]);
    expect(pts.length).toBe(16);
    for (const p of pts) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.000001);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1.000001);
    }
    const meanA = pts.slice(0, 8).reduce((s, p) => s + p.x, 0) / 8;
    const meanB = pts.slice(8).reduce((s, p) => s + p.x, 0) / 8;
    expect(Math.abs(meanA - meanB)).toBeGreaterThan(0.5);
  });
});

describe("local embedder", () => {
  it("is deterministic, unit length, and puts similar texts closer than unrelated ones", () => {
    const a = embedLocal("the sky is blue because of scattering", 256);
    const a2 = embedLocal("the sky is blue because of scattering", 256);
    const b = embedLocal("why does the sky look blue at noon", 256);
    const c = embedLocal("quarterly revenue grew in the automotive segment", 256);
    expect(a).toEqual(a2);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});

describe("vector index", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `c${i}`);
  const vectors = ids.map((_, i) => embedLocal(`${i % 4 === 0 ? "sky blue scattering light" : i % 4 === 1 ? "engine torque revenue automotive" : i % 4 === 2 ? "recipe flour sugar butter oven" : "quantum qubit entanglement gate"} sample ${i}`, 256));

  it("flat compares every vector and ranks the true nearest first", () => {
    const index = new VectorIndex("flat", ids, vectors);
    const q = embedLocal("blue sky and light scattering", 256);
    const out = index.search(q, 5);
    expect(out.compared).toBe(40);
    expect(index.stats.kind).toBe("flat");
    expect(Number(out.hits[0]!.id.slice(1)) % 4).toBe(0);
  });

  it("ivf compares fewer vectors and still finds the same top hit", () => {
    const flat = new VectorIndex("flat", ids, vectors);
    const ivf = new VectorIndex("ivf", ids, vectors);
    const q = embedLocal("blue sky and light scattering", 256);
    const a = flat.search(q, 3);
    const b = ivf.search(q, 3);
    expect(ivf.stats.kind).toBe("ivf");
    expect(ivf.stats.lists).toBeGreaterThan(1);
    expect(b.compared).toBeLessThan(a.compared);
    expect(b.probedLists?.length).toBe(ivf.stats.probes);
    expect(b.hits[0]!.id).toBe(a.hits[0]!.id);
  });

  it("falls back to flat when there are too few vectors to cluster", () => {
    const small = new VectorIndex("ivf", ids.slice(0, 3), vectors.slice(0, 3));
    expect(small.stats.kind).toBe("flat");
  });
});

describe("bm25", () => {
  it("drops stop words and scores documents containing the query terms higher", () => {
    expect(terms("The sky is blue")).toEqual(["sky", "blue"]);
    const idx = buildBm25(["the sky is blue", "the car is fast", "blue paint on the wall"]);
    expect(idx.score("blue sky", 0)).toBeGreaterThan(idx.score("blue sky", 2));
    expect(idx.score("blue sky", 1)).toBe(0);
    expect(idx.matched("blue sky", 2)).toEqual(["blue"]);
  });
});

describe("retrieval strategies", () => {
  const texts = [
    "The sky is blue because short wavelengths scatter more.",
    "The sky is blue because short wavelengths scatter more strongly.",
    "Sunsets are red because the light path through air is longer.",
    "Clouds are white since droplets scatter all colours equally.",
    "A recipe for bread uses flour, water, salt and yeast.",
  ];
  const chunks: RagChunk[] = texts.map((t, i) => ({ id: `c${i}`, docId: "d1", index: i, text: t, charStart: 0, charEnd: t.length, tokenCount: countTokens(t), overlapTokens: 0 }));
  const vectorsById = new Map(chunks.map((c) => [c.id, embedLocal(c.text, 256)]));
  const index = new VectorIndex("flat", chunks.map((c) => c.id), chunks.map((c) => vectorsById.get(c.id)!));
  const base = { question: "why is the sky blue", queryVector: embedLocal("why is the sky blue", 256), index, chunks, vectorsById, topK: 3, threshold: -1 };

  it("similarity keeps the near-duplicate pair at the top", () => {
    const out = retrieve({ ...base, strategy: "similarity" });
    expect(out.results.map((r) => r.chunkId).slice(0, 2).sort()).toEqual(["c0", "c1"]);
    expect(out.report.compared).toBe(5);
    expect(out.results[0]!.rank).toBe(1);
  });

  it("mmr scores each pick as λ·similarity − (1−λ)·redundancy and orders by that score", () => {
    const sim = retrieve({ ...base, strategy: "similarity" }).results;
    const mmr = retrieve({ ...base, strategy: "mmr" }).results;
    // The first pick has nothing to be redundant with, so it is the plain best match.
    expect(mmr[0]!.chunkId).toBe(sim[0]!.chunkId);
    expect(mmr[0]!.redundancyPenalty).toBe(0);
    for (const r of mmr.slice(1)) {
      expect(r.redundancyPenalty).toBeDefined();
      expect(r.score).toBeCloseTo(MMR_LAMBDA * r.vectorScore - (1 - MMR_LAMBDA) * r.redundancyPenalty!, 6);
    }
    // Every later pick scored no higher than the one before it under the MMR objective.
    for (let i = 2; i < mmr.length; i++) expect(mmr[i]!.score).toBeLessThanOrEqual(mmr[i - 1]!.score + 1e-9);
  });

  it("mmr drops an exact duplicate of the top passage when a different relevant one exists", () => {
    const dupTexts = ["The sky is blue because short wavelengths scatter more.", "The sky is blue because short wavelengths scatter more.", "The sky looks blue at noon since air scatters blue light toward you.", "A recipe for bread uses flour, water, salt and yeast."];
    const dupChunks: RagChunk[] = dupTexts.map((t, i) => ({ id: `c${i}`, docId: "d1", index: i, text: t, charStart: 0, charEnd: t.length, tokenCount: countTokens(t), overlapTokens: 0 }));
    const vecs = new Map(dupChunks.map((c) => [c.id, embedLocal(c.text, 256)]));
    const idx = new VectorIndex("flat", dupChunks.map((c) => c.id), dupChunks.map((c) => vecs.get(c.id)!));
    const out = retrieve({ question: "why is the sky blue", queryVector: embedLocal("why is the sky blue", 256), index: idx, chunks: dupChunks, vectorsById: vecs, topK: 2, threshold: -1, strategy: "mmr" });
    const ids = out.results.map((r) => r.chunkId);
    // c0 and c1 are identical vectors (redundancy 1.0); MMR must not take both.
    expect(ids.includes("c0") && ids.includes("c1")).toBe(false);
    expect(ids).toContain("c2");
  });

  it("hybrid reports both ranks and fuses them", () => {
    const out = retrieve({ ...base, strategy: "hybrid" });
    expect(out.results.length).toBe(3);
    for (const r of out.results) expect(r.vectorRank !== undefined || r.lexicalRank !== undefined).toBe(true);
    expect(out.results[0]!.score).toBeGreaterThan(out.results[2]!.score);
  });

  it("threshold removes candidates and reports how many", () => {
    const out = retrieve({ ...base, strategy: "similarity", threshold: 0.99 });
    expect(out.results.length).toBeLessThan(3);
    expect(out.report.belowThreshold).toBeGreaterThan(0);
  });
});

describe("context and citations", () => {
  const docs = new Map<string, RagDocument>([["d1", { id: "d1", name: "sky.txt", kind: "text", origin: "paste", bytes: 10, chars: 10, addedAt: 0, extraction: "test", warnings: [] }]]);
  const chunk = (id: string, text: string): RagChunk => ({ id, docId: "d1", index: 0, text, charStart: 0, charEnd: text.length, tokenCount: countTokens(text), overlapTokens: 0, page: 2 });
  const chunks = new Map([
    ["c0", chunk("c0", "Blue light scatters most. ".repeat(6))],
    ["c1", chunk("c1", "Sunsets are red. ".repeat(6))],
    ["c2", chunk("c2", "Clouds are white. ".repeat(6))],
  ]);
  const results: ScoredChunk[] = ["c0", "c1", "c2"].map((id, i) => ({ chunkId: id, docId: "d1", rank: i + 1, score: 1 - i * 0.1, vectorScore: 1 - i * 0.1, reason: "", matchedTerms: [] }));

  it("packs in rank order and drops what does not fit the budget", () => {
    const ctx = buildContext(results, chunks, docs, 60);
    expect(ctx.pieces.length).toBeGreaterThanOrEqual(1);
    expect(ctx.pieces.length).toBeLessThan(3);
    expect(ctx.dropped.length).toBe(3 - ctx.pieces.length);
    expect(ctx.tokenCount).toBeLessThanOrEqual(ctx.budget + 8);
    expect(ctx.pieces[0]!.citation).toBe(1);
    expect(ctx.text.startsWith("[1] sky.txt p.2")).toBe(true);
  });

  it("assembles a prompt that names the passages and the question", () => {
    const ctx = buildContext(results, chunks, docs, 1000);
    const prompt = assemblePrompt("Why is the sky blue?", ctx);
    expect(prompt.user).toContain("[1] sky.txt");
    expect(prompt.user).toContain("Question: Why is the sky blue?");
    expect(prompt.tokenEstimate).toBeGreaterThan(countTokens(prompt.system));
  });

  it("maps [n] markers in the answer back to chunk ids, ignoring unknown numbers", () => {
    const ctx = buildContext(results, chunks, docs, 1000);
    const cites = extractCitations("Blue scatters most [1]. Sunsets are red [2][2]. Nonsense [9].", ctx);
    expect(cites.map((c) => [c.marker, c.chunkId])).toEqual([
      [1, "c0"],
      [2, "c1"],
    ]);
    expect(cites[0]!.page).toBe(2);
  });
});

describe("settings sanitizer", () => {
  it("clamps every value and keeps overlap smaller than the chunk", () => {
    const s = sanitizeSettings({ chunkSize: 100000, chunkOverlap: 99999, topK: 0, similarityThreshold: 5, contextBudget: 1, retrievalStrategy: "nope" as never, vectorIndex: "weird" as never, embeddingProvider: "x" as never, embeddingModel: "m", llmProvider: "llama" as never, maxOutputTokens: 1, temperature: 9 });
    expect(s.chunkSize).toBe(2048);
    expect(s.chunkOverlap).toBe(2040);
    expect(s.topK).toBe(1);
    expect(s.similarityThreshold).toBe(1);
    expect(s.contextBudget).toBe(200);
    expect(s.retrievalStrategy).toBe("similarity");
    expect(s.vectorIndex).toBe("flat");
    expect(s.embeddingProvider).toBe("local");
    expect(s.llmProvider).toBe("claude");
    expect(s.maxOutputTokens).toBe(16);
    expect(s.temperature).toBe(2);
  });
});

describe("html extraction", () => {
  it("keeps the title and body text, drops scripts and navigation", () => {
    const out = extractHtml("<html><head><title>Sky</title><script>alert(1)</script></head><body><nav>menu</nav><p>Blue &amp; bright.</p><p>Second.</p></body></html>");
    expect(out.text.startsWith("Sky")).toBe(true);
    expect(out.text).toContain("Blue & bright.");
    expect(out.text).not.toContain("alert");
    expect(out.text).not.toContain("menu");
  });
});
