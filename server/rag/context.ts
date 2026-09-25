import type { AssembledContext, AssembledPrompt, Citation, ContextPiece, RagChunk, RagDocument, ScoredChunk } from "@shared/rag";
import { countTokens } from "./chunker";

/**
 * Packs retrieved chunks into the context window in rank order until the token
 * budget is full. Every chunk gets a [n] citation marker the model is told to
 * reuse, so answers can be traced back to exact chunk ids.
 */
export function buildContext(results: ScoredChunk[], chunks: Map<string, RagChunk>, docs: Map<string, RagDocument>, budget: number): AssembledContext {
  const pieces: ContextPiece[] = [];
  const dropped: ScoredChunk[] = [];
  let used = 0;
  let citation = 1;
  for (const r of results) {
    const chunk = chunks.get(r.chunkId);
    if (!chunk) continue;
    // Header line per piece costs tokens too.
    const header = `[${citation}] ${docs.get(chunk.docId)?.name ?? chunk.docId}${chunk.page ? ` p.${chunk.page}` : ""}\n`;
    const cost = chunk.tokenCount + countTokens(header) + 1;
    if (used + cost > budget && pieces.length > 0) {
      dropped.push(r);
      continue;
    }
    pieces.push({
      citation,
      chunkId: chunk.id,
      docId: chunk.docId,
      docName: docs.get(chunk.docId)?.name ?? chunk.docId,
      page: chunk.page,
      tokenCount: chunk.tokenCount,
      text: chunk.text,
    });
    used += cost;
    citation += 1;
  }
  const text = pieces.map((p) => `[${p.citation}] ${p.docName}${p.page ? ` p.${p.page}` : ""}\n${p.text.trim()}`).join("\n\n");
  return { pieces, text, tokenCount: countTokens(text), budget, dropped };
}

export const RAG_SYSTEM_PROMPT =
  "You answer questions using only the numbered context passages provided. " +
  "Cite the passages you rely on with their markers, like [1] or [2], placed after the sentence they support. " +
  "If the context does not contain the answer, say so plainly instead of guessing. Be concise.";

export function assemblePrompt(question: string, context: AssembledContext): AssembledPrompt {
  const user = context.pieces.length === 0
    ? `No passages were retrieved for this question.\n\nQuestion: ${question}`
    : `Context passages:\n\n${context.text}\n\nQuestion: ${question}`;
  return { system: RAG_SYSTEM_PROMPT, user, tokenEstimate: countTokens(RAG_SYSTEM_PROMPT) + countTokens(user) };
}

/** Finds every [n] marker the model used and maps it back to the chunk it stood for. */
export function extractCitations(answer: string, context: AssembledContext): Citation[] {
  const seen = new Set<number>();
  const out: Citation[] = [];
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    const piece = context.pieces.find((p) => p.citation === n);
    if (!piece) continue;
    seen.add(n);
    out.push({ marker: n, chunkId: piece.chunkId, docId: piece.docId, docName: piece.docName, page: piece.page });
  }
  return out.sort((a, b) => a.marker - b.marker);
}
