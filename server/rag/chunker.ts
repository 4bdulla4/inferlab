import type { RagChunk } from "@shared/rag";
import { tokenize } from "../lib/tokenizer";
import { decode as decodeO200k } from "gpt-tokenizer/encoding/o200k_base";

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

export interface PageSpan {
  page: number;
  /** Character offset in the document text where this page begins. */
  start: number;
}

/**
 * Splits a document into token-window chunks with overlap. Every count here is
 * a real o200k_base token count: the tokenizer is the public one, so a chunk of
 * 256 tokens is exactly 256 tokens, not an estimate.
 *
 * Windows step by (chunkSize - chunkOverlap) tokens. Where a window would end
 * mid-sentence, the end is pulled back to the last sentence boundary inside the
 * final quarter of the window, so chunks read as whole thoughts when they can.
 */
export function chunkText(docId: string, text: string, options: ChunkOptions, pages?: PageSpan[]): RagChunk[] {
  const size = Math.max(16, Math.round(options.chunkSize));
  const overlap = Math.min(Math.max(0, Math.round(options.chunkOverlap)), size - 8);
  const step = size - overlap;
  const { ids } = tokenize(text, "o200k_base");
  if (ids.length === 0) return [];

  // Character offset at the start of each token, so chunks can cite positions.
  const offsets = tokenCharOffsets(ids);

  const chunks: RagChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < ids.length) {
    let end = Math.min(ids.length, start + size);
    if (end < ids.length) end = snapToSentence(ids, start, end, size);
    const charStart = offsets[start]!;
    const charEnd = end < ids.length ? offsets[end]! : text.length;
    const body = text.slice(charStart, charEnd);
    chunks.push({
      id: `${docId}:c${index}`,
      docId,
      index,
      text: body,
      charStart,
      charEnd,
      tokenCount: end - start,
      overlapTokens: index === 0 ? 0 : Math.min(overlap, end - start),
      page: pages ? pageFor(pages, charStart) : undefined,
    });
    index += 1;
    if (end >= ids.length) break;
    // Overlap is measured back from the (possibly snapped) end, so it stays
    // exactly `overlap` tokens whatever the sentence boundary did.
    start = Math.max(start + 1, end - overlap);
    void step;
  }
  return chunks;
}

/** Decodes prefixes to find where each token starts in the original string. */
function tokenCharOffsets(ids: number[]): number[] {
  const offsets = new Array<number>(ids.length);
  let consumed = 0;
  // Decode in one pass, growing the prefix: cheaper than decoding each token.
  for (let i = 0; i < ids.length; i++) {
    offsets[i] = consumed;
    consumed += decodeO200k([ids[i]!]).length;
  }
  return offsets;
}

const SENTENCE_END = /[.!?…]["')\]]?\s*$/;

/** Pulls a window end back to a sentence boundary in its last quarter, if one exists. */
function snapToSentence(ids: number[], start: number, end: number, size: number): number {
  const floor = Math.max(start + Math.ceil(size * 0.75), start + 8);
  for (let i = end; i > floor; i--) {
    const piece = decodeO200k([ids[i - 1]!]);
    if (SENTENCE_END.test(piece)) return i;
  }
  return end;
}

function pageFor(pages: PageSpan[], charStart: number): number | undefined {
  let page: number | undefined;
  for (const p of pages) {
    if (p.start <= charStart) page = p.page;
    else break;
  }
  return page;
}

/** Real token count for arbitrary text, in the same encoding the chunks use. */
export function countTokens(text: string): number {
  return tokenize(text, "o200k_base").ids.length;
}
