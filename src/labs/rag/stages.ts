import type { DataSource } from "@shared/llm";

/** Execution order of the RAG pipeline, ingestion first, then a question's journey. */
export const RAG_STAGE_IDS = [
  "ingest",
  "load",
  "extract",
  "chunk",
  "overlap",
  "embedDocs",
  "vectorStore",
  "index",
  "query",
  "embedQuery",
  "search",
  "topK",
  "retrieved",
  "context",
  "prompt",
  "llm",
  "answer",
  "citations",
] as const;

export type RagStageId = (typeof RAG_STAGE_IDS)[number];

export interface RagStageDefinition {
  id: RagStageId;
  label: string;
  shortLabel: string;
  /** Where the data shown in this stage normally comes from. */
  defaultSource: DataSource;
  /** One-line summary shown under the node. */
  caption: string;
  beginner: string;
  advanced: string;
  /** Sentence explaining what is LIVE vs SIMULATED in this stage. */
  sourceNote: string;
}

export const RAG_STAGES: Record<RagStageId, RagStageDefinition> = {
  ingest: {
    id: "ingest",
    label: "Data Ingestion",
    shortLabel: "Ingest",
    defaultSource: "live",
    caption: "Source received",
    beginner: "A document, page or block of text arrives to become part of what the system knows.",
    advanced: "Bytes arrive with a name and MIME type; the server picks an extractor by type and records size and origin for provenance.",
    sourceNote: "Live: the real file, URL or text you supplied, with its true size.",
  },
  load: {
    id: "load",
    label: "Document Loading",
    shortLabel: "Load",
    defaultSource: "live",
    caption: "Bytes → parser",
    beginner: "The file is opened by the right reader: a PDF reader for PDFs, a Word reader for .docx, a fetcher for web pages.",
    advanced: "pdf-parse (pdf.js) for PDFs, mammoth for DOCX, an HTML stripper for pages; URLs are fetched with a 15 s timeout and an 8 MB cap.",
    sourceNote: "Live: the parser named here is the one that actually ran.",
  },
  extract: {
    id: "extract",
    label: "Text Extraction",
    shortLabel: "Extract",
    defaultSource: "live",
    caption: "Readable text",
    beginner: "Formatting, images and layout are dropped so only the words remain.",
    advanced: "Per-page text is concatenated with page offsets kept, so chunks can later cite a page. Pages with no text layer are reported.",
    sourceNote: "Live: character counts, page counts and warnings come from the extractor's real output.",
  },
  chunk: {
    id: "chunk",
    label: "Chunking",
    shortLabel: "Chunk",
    defaultSource: "live",
    caption: "Text → windows",
    beginner: "The text is cut into pieces of a set size so each can be searched and quoted on its own.",
    advanced: "Token windows of the configured size (o200k_base), snapped back to a sentence boundary in the window's last quarter when one exists.",
    sourceNote: "Live: chunk boundaries and token counts are exact; the tokenizer is the public o200k_base BPE.",
  },
  overlap: {
    id: "overlap",
    label: "Chunk Overlap",
    shortLabel: "Overlap",
    defaultSource: "live",
    caption: "Shared edges",
    beginner: "Neighbouring chunks share a little text at their edges, so an idea split across a boundary is not lost.",
    advanced: "Each window starts (chunkSize − overlap) tokens after the previous one; the overlap is measured back from the snapped end so it stays exact.",
    sourceNote: "Live: the overlapping spans drawn here are the real shared token ranges.",
  },
  embedDocs: {
    id: "embedDocs",
    label: "Embeddings",
    shortLabel: "Embed",
    defaultSource: "live",
    caption: "Chunks → vectors",
    beginner: "Each chunk is turned into a long list of numbers that captures what it is about.",
    advanced: "Batches of chunk text go to the embedding model and come back as unit vectors of fixed dimension; provider usage is recorded when reported.",
    sourceNote: "Live when a provider model runs. The local option computes real hashed n-gram vectors but is labelled a simulation: it has no learned meaning.",
  },
  vectorStore: {
    id: "vectorStore",
    label: "Vector Database",
    shortLabel: "Vector DB",
    defaultSource: "simulation",
    caption: "Where vectors live",
    beginner: "The vectors are kept in a store built for finding the nearest ones quickly.",
    advanced: "Here that store is the server's memory; the 2-D map is a PCA projection of the real vectors, drawn to show neighbourhoods, not exact geometry.",
    sourceNote: "Conceptual: a real database would persist and shard these; the projection is a lossy view of the real vectors.",
  },
  index: {
    id: "index",
    label: "Indexing",
    shortLabel: "Index",
    defaultSource: "live",
    caption: "Flat or IVF",
    beginner: "The store organises vectors so a search does not have to look at every one.",
    advanced: "Flat keeps every vector and compares all of them exactly. IVF clusters them into √n lists with k-means and probes only the closest lists.",
    sourceNote: "Live: both index kinds are real algorithms run on the real vectors; list counts and probes are what actually ran.",
  },
  query: {
    id: "query",
    label: "User Query",
    shortLabel: "Query",
    defaultSource: "live",
    caption: "Question received",
    beginner: "You ask a question.",
    advanced: "The question is token-counted and the run's settings are frozen so a comparison run can use different ones.",
    sourceNote: "Live: your question and its exact token count.",
  },
  embedQuery: {
    id: "embedQuery",
    label: "Query Embedding",
    shortLabel: "Embed Q",
    defaultSource: "live",
    caption: "Question → vector",
    beginner: "The question is turned into numbers the same way the chunks were, so they can be compared.",
    advanced: "Always the same model that embedded the chunks, whatever the run's overrides say: vectors from different models cannot be compared.",
    sourceNote: "Live when a provider model runs; the local option is a labelled stand-in.",
  },
  search: {
    id: "search",
    label: "Similarity Search",
    shortLabel: "Search",
    defaultSource: "live",
    caption: "Cosine over the index",
    beginner: "The question's vector is compared with the stored vectors to find the closest ones.",
    advanced: "Cosine similarity against every vector (flat) or the probed lists (IVF); the count of vectors compared is reported.",
    sourceNote: "Live: every score is a real cosine between real vectors.",
  },
  topK: {
    id: "topK",
    label: "Top-K Retrieval",
    shortLabel: "Top-K",
    defaultSource: "live",
    caption: "Threshold, then cut",
    beginner: "Only the best few matches are kept.",
    advanced: "Candidates below the similarity threshold are dropped, then the strategy (similarity, MMR or hybrid) orders what remains and keeps K.",
    sourceNote: "Live: the strategy's arithmetic on the real scores.",
  },
  retrieved: {
    id: "retrieved",
    label: "Retrieved Chunks",
    shortLabel: "Retrieved",
    defaultSource: "live",
    caption: "Ranked passages",
    beginner: "The pieces of your documents the system thinks are most relevant.",
    advanced: "Each carries its rank, score components and a one-line reason so the ranking can be audited.",
    sourceNote: "Live: real chunks from your documents with their real scores.",
  },
  context: {
    id: "context",
    label: "Context Construction",
    shortLabel: "Context",
    defaultSource: "live",
    caption: "Pack to budget",
    beginner: "The retrieved pieces are stacked into one block of text for the model to read.",
    advanced: "Pieces are added in rank order until the token budget is full; each gets a [n] marker the model is asked to reuse.",
    sourceNote: "Live: this is the exact text and token count that went to the model.",
  },
  prompt: {
    id: "prompt",
    label: "Prompt Assembly",
    shortLabel: "Prompt",
    defaultSource: "live",
    caption: "System + context + question",
    beginner: "Instructions, the context and your question are combined into what the model is sent.",
    advanced: "A system prompt restricts the model to the passages and asks for citations; the user turn carries the numbered context and the question.",
    sourceNote: "Live: the exact system and user text sent.",
  },
  llm: {
    id: "llm",
    label: "LLM",
    shortLabel: "LLM",
    defaultSource: "live",
    caption: "Model generates",
    beginner: "The model reads the prompt and writes an answer.",
    advanced: "The configured provider streams tokens back; time to first token, latency and usage are recorded from the API.",
    sourceNote: "Live: streamed text, timings and usage from the provider API.",
  },
  answer: {
    id: "answer",
    label: "Generated Answer",
    shortLabel: "Answer",
    defaultSource: "live",
    caption: "Streamed text",
    beginner: "The answer, exactly as the model produced it.",
    advanced: "Nothing is post-edited; the finish reason and token counts come from the provider.",
    sourceNote: "Live: the model's own words.",
  },
  citations: {
    id: "citations",
    label: "Citations / Sources",
    shortLabel: "Sources",
    defaultSource: "live",
    caption: "[n] → chunk → document",
    beginner: "Every [n] in the answer points back to the passage, and the document, it came from.",
    advanced: "Markers in the answer are matched to the numbered context pieces, giving chunk id, document and page for each claim.",
    sourceNote: "Live: derived by matching the model's markers against the real context pieces.",
  },
};

/** The stages that run when a document is added, in order. */
export const INGEST_STAGES: RagStageId[] = ["ingest", "load", "extract", "chunk", "overlap", "embedDocs", "vectorStore", "index"];

/** The stages a question passes through, in order. */
export const QUERY_STAGES: RagStageId[] = ["query", "embedQuery", "search", "topK", "retrieved", "context", "prompt", "llm", "answer", "citations"];
