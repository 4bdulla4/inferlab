import type { ToolResult } from "@shared/agent";
import type { ToolContext } from "../types";
import { ToolExecutionError } from "../types";
import { truncateContent } from "./shared";

/** Searches the agent's knowledge base with the RAG lab's own retrieval pipeline. */
export async function retrieveFromKnowledgeBase(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new ToolExecutionError("A query is required.", "live", false);
  const kbId = ctx.config.ragKbId;
  const kb = kbId ? ctx.knowledgeBases?.get(kbId) : undefined;
  if (!kb) throw new ToolExecutionError("No knowledge base is attached to this agent. Add documents in the RAG lab, then pick it in the agent settings.", "live", false);
  const topK = typeof args.topK === "number" ? Math.round(args.topK) : undefined;
  const started = Date.now();
  const out = await kb.retrieve(query, ctx.keys, ctx.signal, topK);
  const lines = out.context.pieces.map((p) => `[${p.citation}] ${p.docName}${p.page ? ` p.${p.page}` : ""} (chunk ${p.chunkId}, cosine ${out.results.find((r) => r.chunkId === p.chunkId)?.vectorScore.toFixed(3) ?? "?"})\n${p.text.trim()}`);
  const content = lines.length ? lines.join("\n\n") : "No passages passed the similarity threshold for this query.";
  const { text, truncated } = truncateContent(content);
  return {
    ok: true,
    content: text,
    data: {
      results: out.results.map((r) => ({ rank: r.rank, chunkId: r.chunkId, docId: r.docId, score: r.score, vectorScore: r.vectorScore, reason: r.reason })),
      compared: out.report.compared,
      total: out.report.total,
      strategy: out.report.strategy,
      index: out.report.index,
      contextTokens: out.context.tokenCount,
      embeddingModel: out.embedding.model,
      embedMs: out.embedMs,
      searchMs: out.report.ms,
    },
    source: out.embedding.source,
    latencyMs: Date.now() - started,
    note: `${out.report.strategy} retrieval over ${out.report.total} chunks (${out.report.compared} compared, ${out.report.index} index) with ${out.embedding.model}. ${out.embedding.source === "live" ? "Real embeddings and real passages." : "Passages are real; the local embedder is a labelled stand-in."}`,
    truncated,
  };
}
