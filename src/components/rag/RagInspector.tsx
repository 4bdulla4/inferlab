import { Pause, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { DataSource } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { INGEST_STAGES, RAG_STAGES, type RagStageId } from "@/labs/rag/stages";
import type { RagRunState, RagVisualState } from "@/labs/rag/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useRagStore } from "@/store/ragStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { Badge } from "@/components/ui/Badge";
import { ChunkVisualizer } from "./ChunkVisualizer";
import { ContextInspector } from "./ContextInspector";
import { RetrievalRankingPanel } from "./RetrievalRankingPanel";
import { VectorSpaceView } from "./VectorSpaceView";

/** Stages whose facts can come from an existing index rather than this run. */
const INGEST_SEEDED_STAGES = new Set<RagStageId>(INGEST_STAGES);

/** What the inspector and the visualization are both looking at right now. */
export function useInspectedRagStage(run: RagRunState | undefined) {
  const selected = useRagStore((s) => s.selectedStage);
  const selectStage = useRagStore((s) => s.selectStage);
  const visual = run?.visual;
  const stage: RagStageId | null = selected ?? visual?.currentStage ?? null;
  const def = stage ? RAG_STAGES[stage] : null;
  const state: NodeState = stage ? (visual?.nodes[stage] ?? "idle") : "idle";
  const source: DataSource = stage ? (visual?.nodeSources[stage] ?? RAG_STAGES[stage].defaultSource) : "simulation";
  const toggleFollow = useCallback(() => {
    if (selected) selectStage(null);
    else if (stage) selectStage(stage);
  }, [selected, stage, selectStage]);
  return { stage, def, state, source, pinned: Boolean(selected), toggleFollow, visual };
}

function FollowToggle({ pinned, onToggle, disabled }: { pinned: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pinned}
      title={pinned ? "Resume following the run" : "Hold this stage still so it stops changing"}
      className={cn(
        "mono inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] uppercase tracking-[0.1em] disabled:opacity-40 disabled:cursor-not-allowed",
        pinned ? "border-accent/50 bg-accent/10 text-accent-soft hover:border-accent" : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
      )}
    >
      {pinned ? <PlayCircle className="size-3" aria-hidden="true" /> : <Pause className="size-3" aria-hidden="true" />}
      {pinned ? "follow" : "hold"}
    </button>
  );
}

function StageHeader({ label, state, source, reducedMotion }: { label: string; state: NodeState; source: DataSource; reducedMotion: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[16px] inline-flex">
        <StatusIcon state={state} spin={!reducedMotion} />
      </span>
      <h3 className="mono text-[13px] font-semibold tracking-[0.14em] uppercase text-ink">{label}</h3>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted">{NODE_STATE_LABEL[state]}</span>
        <SourceBadge source={source} compact />
      </span>
    </div>
  );
}

/** Explanation, data source and metadata for the stage in view. */
export function RagInspectorPanel({ run, className }: { run: RagRunState | undefined; className?: string }) {
  const mode = useUIStore((s) => s.mode);
  const reducedMotion = useReducedMotion();
  const { stage, def, state, source, pinned, toggleFollow, visual } = useInspectedRagStage(run);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pinned) bodyRef.current?.scrollTo({ top: 0 });
  }, [pinned, stage]);

  return (
    <GlassPanel bodyRef={bodyRef} title="Inspector" subtitle={pinned ? "held still" : stage ? "following execution" : undefined} actions={<FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!stage} />} className={className} bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll content-start">
      {!def || !stage ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Click any stage in the diagram or the timeline to inspect it. While a run plays the inspector follows the active stage.</p>
      ) : (
        <>
          <StageHeader label={def.label} state={state} source={source} reducedMotion={reducedMotion} />
          <div className="rounded-lg border border-line surface-1 p-3 grid gap-1">
            <p className="label-caps">What is happening?</p>
            <p className="text-[13px] leading-relaxed text-ink">{mode === "advanced" ? def.advanced : def.beginner}</p>
          </div>
          <StageMetadata stage={stage} visual={visual} />
          <div className="rounded-lg border border-line p-3 grid gap-1">
            <p className="label-caps">Data source</p>
            <p className="flex items-center gap-2 text-[12px] text-ink-dim">
              <SourceBadge source={source} />
              <span>{source === "live" ? "Real documents, real computation or a provider API" : "Conceptual view or a local stand-in method"}</span>
            </p>
            <p className="text-[11.5px] leading-snug text-muted">{def.sourceNote}</p>
          </div>
          {visual?.notices.length ? (
            <ul className="grid gap-1">
              {visual.notices.slice(-3).map((n) => (
                <li key={n.at + n.message} className={cn("text-[11px] leading-snug rounded-md border px-2.5 py-1.5", n.level === "warn" ? "border-warn/40 text-warn bg-warn/[0.06]" : "border-line text-muted")}>
                  {n.message}
                </li>
              ))}
            </ul>
          ) : null}
          {visual?.error ? <p className="rounded-md border border-err/40 bg-err/[0.06] px-2.5 py-1.5 text-[11.5px] text-err whitespace-pre-wrap">{visual.error.message}</p> : null}
        </>
      )}
    </GlassPanel>
  );
}

/** The stage's numbers: ids, counts, dimensions, timings, straight from the events. */
function StageMetadata({ stage, visual: v }: { stage: RagStageId; visual: RagVisualState | undefined }) {
  if (!v) return null;
  const rows: [string, string][] = [];
  const push = (k: string, val: string | number | null | undefined) => {
    if (val !== undefined && val !== null && val !== "") rows.push([k, String(val)]);
  };
  if (v.ingestSeeded && INGEST_SEEDED_STAGES.has(stage)) push("source", "the index this question runs against, not this run");
  switch (stage) {
    case "ingest":
      push("document", v.document?.name);
      push("kind", v.document?.kind);
      push("bytes", v.document ? formatNumber(v.document.bytes) : undefined);
      v.seededDocuments.forEach((d, i) => push(`document ${i + 1}`, d.name));
      break;
    case "load":
      push("loader", v.loadNote);
      break;
    case "extract":
      push("characters", v.extraction ? formatNumber(v.extraction.chars) : undefined);
      push("pages", v.extraction?.pages);
      push("method", v.extraction?.extraction);
      v.extraction?.warnings.forEach((w, i) => push(`warning ${i + 1}`, w));
      break;
    case "chunk":
    case "overlap":
      push("chunks", v.chunks.length || undefined);
      push("chunk size", v.chunkSettings ? `${v.chunkSettings.chunkSize} tokens` : undefined);
      push("overlap", v.chunkSettings ? `${v.chunkSettings.chunkOverlap} tokens` : undefined);
      push("total tokens", v.chunks.length ? formatNumber(v.chunks.reduce((s, c) => s + c.tokenCount, 0)) : undefined);
      push("first chunk id", v.chunks[0]?.id);
      break;
    case "embedDocs":
      push("model", v.embedding?.model);
      push("provider", v.embedding?.provider);
      push("dimensions", v.embedded?.dims ?? v.embedding?.dims);
      push("vectors", v.embedded?.count ?? (v.ingestSeeded ? v.chunks.length : undefined));
      push("time", v.embedded ? formatMs(v.embedded.ms) : undefined);
      push("embedding tokens billed", v.embedded?.usage?.inputTokens ?? undefined);
      break;
    case "vectorStore":
      push("vectors held", v.stored?.count);
      push("dimensions", v.stored?.dims);
      push("where", v.stored ? "server memory (2 h TTL)" : undefined);
      break;
    case "index":
      push("kind", v.index?.kind);
      push("vectors", v.index?.vectors);
      push("dimensions", v.index?.dims);
      push("lists", v.index?.lists);
      push("probes per query", v.index?.probes);
      push("build time", v.index ? formatMs(v.index.buildMs) : undefined);
      break;
    case "query":
      push("question", v.question);
      push("tokens", v.queryTokens);
      push("strategy", v.querySettings?.retrievalStrategy);
      push("top-K", v.querySettings?.topK);
      push("threshold", v.querySettings?.similarityThreshold);
      break;
    case "embedQuery":
      push("model", v.queryEmbedding?.embedding.model);
      push("dimensions", v.queryEmbedding?.dims);
      push("time", v.queryEmbedding ? formatMs(v.queryEmbedding.ms) : undefined);
      push("tokens billed", v.queryEmbedding?.usage?.inputTokens ?? undefined);
      break;
    case "search":
      push("index", v.searchReport?.index);
      push("compared", v.searchReport ? `${v.searchReport.compared} of ${v.searchReport.total}` : undefined);
      push("candidates scored", v.searchReport?.candidates.length);
      push("probed lists", v.searchReport?.probedLists?.join(", "));
      push("time", v.searchReport ? `${v.searchReport.ms} ms` : undefined);
      break;
    case "topK":
    case "retrieved":
      push("strategy", v.topK?.strategy);
      push("kept", v.topK?.kept);
      push("top-K", v.topK?.topK);
      push("threshold", v.topK?.threshold.toFixed(2));
      push("below threshold", v.topK?.belowThreshold);
      v.results.forEach((r) => push(`#${r.rank}`, `${r.chunkId} · cos ${r.vectorScore.toFixed(3)}`));
      break;
    case "context":
      push("passages", v.context?.pieces.length);
      push("tokens used", v.context ? `${v.context.tokenCount} / ${v.context.budget}` : undefined);
      push("dropped", v.context?.dropped.length);
      break;
    case "prompt":
      push("model", v.prompt?.model);
      push("provider", v.prompt?.provider);
      push("prompt tokens (estimate)", v.prompt?.prompt.tokenEstimate);
      break;
    case "llm":
      push("model", v.llm.model ?? v.prompt?.model);
      push("time to first token", v.llm.ttfbMs !== undefined ? formatMs(v.llm.ttfbMs) : undefined);
      push("latency", v.llm.latencyMs !== undefined ? formatMs(v.llm.latencyMs) : undefined);
      push("generation", v.llm.generationMs !== undefined ? formatMs(v.llm.generationMs) : undefined);
      push("input tokens", v.llm.usage?.inputTokens ?? undefined);
      push("output tokens", v.llm.usage?.outputTokens ?? undefined);
      push("finish reason", v.llm.finishReason);
      break;
    case "answer":
      push("characters", v.llm.text.length || undefined);
      push("streamed pieces", v.llm.pieces || undefined);
      push("finish reason", v.llm.finishReason);
      break;
    case "citations":
      push("citations", v.citations.length);
      v.citations.forEach((c) => push(`[${c.marker}]`, `${c.chunkId} · ${c.docName}${c.page ? ` p.${c.page}` : ""}`));
      break;
  }
  if (rows.length === 0) return null;
  return (
    <dl className="rounded-lg border border-line p-3 grid gap-1 mono text-[11px]">
      {rows.map(([k, val]) => (
        <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 items-baseline">
          <dt className="text-muted truncate">{k}</dt>
          <dd className="text-ink-dim break-words">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The stage's visual, in a frame of its own. */
export function RagVisualizationPanel({ run, className }: { run: RagRunState | undefined; className?: string }) {
  const reducedMotion = useReducedMotion();
  const { stage, def, state, source, pinned, toggleFollow, visual } = useInspectedRagStage(run);
  const kb = useRagStore((s) => s.kb);
  const selectedChunkId = useRagStore((s) => s.selectedChunkId);
  const selectChunk = useRagStore((s) => s.selectChunk);

  return (
    <GlassPanel title="Visualization" subtitle={pinned ? "held still" : stage ? "following execution" : undefined} actions={<FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!stage} />} className={className} bodyClassName="p-4 grid gap-3 content-start overflow-y-auto panel-scroll">
      {!def || !stage ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Each stage draws what it did here: the chunks it cut, the vectors it made, the passages it ranked, the context it packed and the answer it wrote.</p>
      ) : (
        <>
          <StageHeader label={def.label} state={state} source={source} reducedMotion={reducedMotion} />
          <StageVisual stage={stage} visual={visual} kbChunks={kb?.chunks ?? []} kbDocs={kb?.documents ?? []} selectedChunkId={selectedChunkId} onSelectChunk={selectChunk} />
        </>
      )}
    </GlassPanel>
  );
}

function StageVisual({ stage, visual: v, kbChunks, kbDocs, selectedChunkId, onSelectChunk }: { stage: RagStageId; visual: RagVisualState | undefined; kbChunks: RagVisualState["chunks"]; kbDocs: { id: string; name: string }[]; selectedChunkId: string | null; onSelectChunk: (id: string | null) => void }) {
  if (!v) return null;
  const chunks = v.chunks.length ? v.chunks : kbChunks;
  const docs = kbDocs as Parameters<typeof VectorSpaceView>[0]["documents"];
  const embeddingSource = v.embedding?.source ?? v.queryEmbedding?.embedding.source ?? "simulation";

  switch (stage) {
    case "ingest":
      if (v.document)
        return (
          <div className="rounded-lg border border-line surface-1 p-3 grid gap-1">
            <p className="text-[13px] text-ink truncate">{v.document.name}</p>
            <p className="mono text-[11px] text-muted">
              {v.document.kind} · {formatNumber(v.document.bytes)} bytes
            </p>
          </div>
        );
      return v.ingestSeeded ? <SeededDocuments docs={v.seededDocuments} /> : <Empty>Waiting for a document.</Empty>;
    case "load":
      if (v.loadNote) return <p className="rounded-lg border border-line surface-1 p-3 text-[12.5px] text-ink-dim">{v.loadNote}</p>;
      return v.ingestSeeded ? <SeededDocuments docs={v.seededDocuments} /> : <Empty>The loader reports here.</Empty>;
    case "extract":
      if (!v.extraction && v.ingestSeeded) return <SeededDocuments docs={v.seededDocuments} note="Their text was extracted when they were added; this run searches the result." />;
      return v.extraction ? (
        <div className="grid gap-2">
          <p className="mono text-[11px] text-muted">
            {formatNumber(v.extraction.chars)} characters{v.extraction.pages ? ` across ${v.extraction.pages} pages` : ""} · {v.extraction.extraction}
          </p>
          {v.extraction.warnings.map((w) => (
            <p key={w} className="rounded-md border border-warn/40 bg-warn/[0.06] px-2.5 py-1.5 text-[11px] text-warn">
              {w}
            </p>
          ))}
          <pre className="mono text-[11px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words rounded-lg border border-line bg-bg-elevated/60 p-3 max-h-[220px] overflow-y-auto panel-scroll">{v.extraction.sample}…</pre>
        </div>
      ) : (
        <Empty>Extracted text appears here.</Empty>
      );
    case "chunk":
      return <ChunkVisualizer chunks={chunks} chunkSize={v.chunkSettings?.chunkSize} chunkOverlap={v.chunkSettings?.chunkOverlap} selectedChunkId={selectedChunkId} onSelectChunk={onSelectChunk} />;
    case "overlap":
      return <ChunkVisualizer chunks={chunks} chunkSize={v.chunkSettings?.chunkSize} chunkOverlap={v.chunkSettings?.chunkOverlap} showOverlap selectedChunkId={selectedChunkId} onSelectChunk={onSelectChunk} limit={24} />;
    case "embedDocs":
      return <EmbeddingView label="first chunk's vector" vector={v.embedded?.sampleVector} dims={v.embedded?.dims ?? v.embedding?.dims} model={v.embedding?.model} source={v.embedding?.source} progress={v.embedProgress} note={v.embedding?.note} />;
    case "vectorStore":
    case "index":
      return <VectorSpaceView projection={v.projection ?? useRagStore.getState().kb?.projection} chunks={chunks} documents={docs} embeddingSource={embeddingSource} selectedChunkId={selectedChunkId} onSelectChunk={onSelectChunk} compact />;
    case "query":
      return v.question ? (
        <div className="rounded-lg border border-line surface-1 p-3 grid gap-1">
          <p className="text-[13.5px] text-ink">{v.question}</p>
          <p className="mono text-[11px] text-muted">
            {v.queryTokens} tokens · {v.querySettings?.retrievalStrategy} · top-{v.querySettings?.topK} · threshold {v.querySettings?.similarityThreshold}
          </p>
        </div>
      ) : (
        <Empty>Ask a question to begin.</Empty>
      );
    case "embedQuery":
      return <EmbeddingView label="question vector" vector={v.queryEmbedding?.vector} dims={v.queryEmbedding?.dims} model={v.queryEmbedding?.embedding.model} source={v.queryEmbedding?.embedding.source} note={v.queryEmbedding?.embedding.note} />;
    case "search":
      return <VectorSpaceView projection={v.projection ?? useRagStore.getState().kb?.projection} chunks={chunks} documents={docs} results={v.results} query={v.queryEmbedding?.projected ?? null} embeddingSource={embeddingSource} selectedChunkId={selectedChunkId} onSelectChunk={onSelectChunk} compact />;
    case "topK":
    case "retrieved":
      return <RetrievalRankingPanel report={v.searchReport} results={v.results} threshold={v.topK?.threshold ?? v.querySettings?.similarityThreshold ?? 0} topK={v.topK?.topK ?? v.querySettings?.topK ?? 0} strategy={v.topK?.strategy} explanation={v.topK?.explanation} chunks={chunks} documents={docs} selectedChunkId={selectedChunkId} onSelectChunk={onSelectChunk} compact={stage === "retrieved"} />;
    case "context":
    case "prompt":
      return <ContextInspector context={v.context} prompt={v.prompt} selectedChunkId={selectedChunkId} onSelectChunk={onSelectChunk} />;
    case "llm":
      return (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="first token" value={v.llm.ttfbMs !== undefined ? formatMs(v.llm.ttfbMs) : "—"} />
            <Tile label="latency" value={v.llm.latencyMs !== undefined ? formatMs(v.llm.latencyMs) : v.llm.requestSentAt ? "…" : "—"} />
            <Tile label="in / out tokens" value={v.llm.usage ? `${v.llm.usage.inputTokens ?? "?"} / ${v.llm.usage.outputTokens ?? "?"}` : "—"} />
            <Tile label="finish" value={v.llm.finishReason ?? (v.llm.requestSentAt ? "streaming" : "—")} />
          </div>
          <AnswerText text={v.llm.text} streaming={Boolean(v.llm.requestSentAt) && !v.llm.completed && !v.error} />
        </div>
      );
    case "answer":
      return <AnswerText text={v.llm.text} streaming={Boolean(v.llm.requestSentAt) && !v.llm.completed && !v.error} />;
    case "citations":
      return v.citations.length ? (
        <ul className="grid gap-1.5">
          {v.citations.map((c) => {
            const chunk = chunks.find((k) => k.id === c.chunkId);
            return (
              <li key={c.marker}>
                <button type="button" onClick={() => onSelectChunk(selectedChunkId === c.chunkId ? null : c.chunkId)} className={cn("w-full text-left rounded-lg border px-3 py-2 grid gap-1", selectedChunkId === c.chunkId ? "border-accent/60 bg-accent/[0.07]" : "border-line surface-1 hover:border-line-strong")}>
                  <span className="flex items-center gap-2 min-w-0">
                    <Badge tone="live">[{c.marker}]</Badge>
                    <span className="text-[12px] text-ink truncate">
                      {c.docName}
                      {c.page ? ` · p.${c.page}` : ""}
                    </span>
                    <span className="mono ml-auto text-[10px] text-faint">{c.chunkId}</span>
                  </span>
                  {chunk ? <span className="text-[11.5px] leading-snug text-muted line-clamp-3">{chunk.text}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>{v.llm.completed ? "The answer used no [n] markers, so nothing can be traced to a passage." : "Citations are resolved when the answer finishes."}</Empty>
      );
  }
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mono text-[11px] text-muted">{children}</p>;
}

/** What is already in the index, for stages a query run did not itself perform. */
function SeededDocuments({ docs, note }: { docs: { id: string; name: string }[]; note?: string }) {
  if (docs.length === 0) return <Empty>Nothing indexed yet.</Empty>;
  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">
        {docs.length} document{docs.length === 1 ? "" : "s"} already in the index
      </p>
      <ul className="grid gap-1">
        {docs.map((d) => (
          <li key={d.id} className="rounded-lg border border-line surface-1 px-3 py-1.5 text-[12.5px] text-ink-dim truncate">
            {d.name}
          </li>
        ))}
      </ul>
      <p className="text-[10.5px] leading-snug text-muted">{note ?? "This stage ran when the documents were added. The question below searches what it produced."}</p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line surface-1 px-2.5 py-2 min-w-0">
      <p className="label-caps text-[9.5px]">{label}</p>
      <p className="mono text-[13px] text-ink truncate mt-0.5">{value}</p>
    </div>
  );
}

function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words min-h-[44px]", streaming ? "border-live/30 bg-live/[0.04]" : "border-accent/25 bg-accent/[0.05]")}>
      {text ? text : streaming ? <span className="shimmer-text mono text-[12px]">waiting for the first token…</span> : <span className="mono text-[11px] text-muted">The answer streams here.</span>}
      {streaming && text ? <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" /> : null}
    </div>
  );
}

/** A vector as bars: the first few dozen of its dimensions, signed. */
function EmbeddingView({ label, vector, dims, model, source, progress, note }: { label: string; vector?: number[]; dims?: number; model?: string; source?: DataSource; progress?: { done: number; total: number }; note?: string }) {
  if (!vector && !progress) return <Empty>Vectors appear once embedding has run.</Empty>;
  const max = Math.max(1e-6, ...(vector ?? []).map((x) => Math.abs(x)));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="mono text-[11px] text-muted">
          {model ?? "embedding"} · {dims ?? "?"} dimensions{vector ? ` · showing ${vector.length}` : ""}
        </p>
        {source ? <SourceBadge source={source} compact /> : null}
      </div>
      {progress && progress.done < progress.total ? (
        <div className="h-2 rounded surface-2 overflow-hidden">
          <div className="h-full bg-live/70 transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      ) : null}
      {vector ? (
        <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-1">
          <p className="label-caps">{label} · bar = value per dimension</p>
          <svg viewBox={`0 0 ${vector.length} 40`} preserveAspectRatio="none" className="w-full h-20" role="img" aria-label={label}>
            <line x1={0} x2={vector.length} y1={20} y2={20} className="stroke-line" strokeWidth={0.3} />
            {vector.map((x, i) => {
              const h = (Math.abs(x) / max) * 18;
              return <rect key={i} x={i + 0.15} y={x >= 0 ? 20 - h : 20} width={0.7} height={h} fill={x >= 0 ? "var(--color-live)" : "var(--color-sim)"} opacity={0.85} />;
            })}
          </svg>
        </div>
      ) : null}
      {note ? <p className="text-[10.5px] leading-snug text-muted">{note}</p> : null}
    </div>
  );
}
