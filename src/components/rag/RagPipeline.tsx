import { memo, useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DataSource } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { RAG_BAND_LABELS, RAG_CANVAS_H, RAG_CANVAS_W, RAG_CONNECTIONS, RAG_NODES, RAG_NODE_BY_ID, RAG_NODE_ORDER, type RagConnectionLayout, type RagNodeLayout } from "@/labs/rag/layout";
import { RAG_STAGES, type RagStageId } from "@/labs/rag/stages";
import type { RagRunState, RagVisualState } from "@/labs/rag/state";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { useRagStore } from "@/store/ragStore";
import { SourceDot } from "@/components/layout/SourceBadge";
import { StatusIcon } from "@/components/layout/StatusIcon";

type ConnectionState = "idle" | "pending" | "active" | "done" | "error";

export function connectionState(conn: RagConnectionLayout, nodes: Record<RagStageId, NodeState> | undefined): ConnectionState {
  if (!nodes) return "idle";
  const from = nodes[conn.from];
  const to = nodes[conn.to];
  if (from === "error" || to === "error") return "error";
  if (to === "active" || to === "processing") return "active";
  if (from === "completed" && to === "completed") return "done";
  if (from === "completed" && (to === "idle" || to === "queued")) return "pending";
  return "idle";
}

const STROKE: Record<ConnectionState, string> = {
  idle: "stroke-line",
  pending: "stroke-line-strong",
  active: "stroke-live",
  done: "stroke-ok/60",
  error: "stroke-err",
};

/**
 * The RAG diagram: three rows, one per act. Ingestion turns documents into an
 * index; a question is embedded and searched against it; the passages found
 * become a prompt and an answer. Nodes light up as the run's events apply.
 */
export function RagPipeline({ run, dimmed }: { run: RagRunState | undefined; dimmed?: boolean }) {
  const visual = run?.visual;
  const selectedStage = useRagStore((s) => s.selectedStage);
  const selectStage = useRagStore((s) => s.selectStage);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / RAG_CANVAS_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const current = (e.target as HTMLElement).dataset.ragNode as RagStageId | undefined;
    if (!current) return;
    const idx = RAG_NODE_ORDER.indexOf(current);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(RAG_NODE_ORDER.length - 1, idx + 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, idx - 1);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = RAG_NODE_ORDER.length - 1;
    if (next !== null) {
      e.preventDefault();
      containerRef.current?.querySelector<HTMLElement>(`[data-rag-node="${RAG_NODE_ORDER[next]}"]`)?.focus();
    }
  }, []);

  const fontScale = Math.min(1.15, Math.max(0.78, scale));

  return (
    <div ref={containerRef} className={cn("relative w-full min-w-0 select-none", dimmed && "opacity-60")} style={{ height: RAG_CANVAS_H * scale }} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 origin-top-left" style={{ width: RAG_CANVAS_W, height: RAG_CANVAS_H, transform: `scale(${scale})`, ["--fs" as string]: fontScale }}>
        {RAG_BAND_LABELS.map((label, i) => (
          <span key={label} className="mono absolute left-9 text-[10.5px] uppercase tracking-[0.16em] text-faint" style={{ top: [12, 168, 324][i], fontSize: `calc(10.5px * var(--fs))` }}>
            {label}
          </span>
        ))}

        <svg className="absolute inset-0 overflow-visible" width={RAG_CANVAS_W} height={RAG_CANVAS_H} aria-hidden="true">
          <defs>
            <marker id="rag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-line-strong" />
            </marker>
          </defs>
          {RAG_CONNECTIONS.map((conn) => {
            const state = connectionState(conn, visual?.nodes);
            const d = conn.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
            const animated = state === "active" && !reducedMotion;
            return (
              <g key={conn.id}>
                <path d={d} fill="none" className={cn("transition-colors", STROKE[state])} strokeWidth={state === "active" ? 2.2 : 1.4} strokeDasharray={conn.kind === "feed" ? "6 6" : animated ? "8 8" : undefined} markerEnd="url(#rag-arrow)" strokeLinejoin="round">
                  {animated ? <animate attributeName="stroke-dashoffset" from="32" to="0" dur="1.1s" repeatCount="indefinite" /> : null}
                </path>
              </g>
            );
          })}
        </svg>

        {RAG_NODES.map((node) => (
          <RagNode
            key={node.id}
            layout={node}
            state={visual?.nodes[node.id] ?? "idle"}
            source={visual?.nodeSources[node.id] ?? RAG_STAGES[node.id].defaultSource}
            pulse={visual?.pulses[node.id] ?? 0}
            selected={selectedStage === node.id}
            sublabel={sublabelFor(node.id, visual)}
            reducedMotion={reducedMotion}
            onSelect={selectStage}
          />
        ))}
      </div>
    </div>
  );
}

interface RagNodeProps {
  layout: RagNodeLayout;
  state: NodeState;
  source: DataSource;
  pulse: number;
  selected: boolean;
  sublabel?: string;
  reducedMotion: boolean;
  onSelect: (id: RagStageId) => void;
}

const STATE_STYLE: Record<NodeState, string> = {
  idle: "border-line surface-1 text-muted",
  queued: "border-line-strong surface-1 text-ink-dim",
  active: "surface-2 text-ink",
  processing: "surface-2 text-ink",
  completed: "border-ok/40 bg-ok/[0.05] text-ink",
  error: "border-err/60 bg-err/[0.08] text-ink shadow-glow-err",
};

/** One stage box. Memoized: a run applies well over a hundred events and only a few nodes change each time. */
const RagNode = memo(function RagNode({ layout, state, source, pulse, selected, sublabel, reducedMotion, onSelect }: RagNodeProps) {
  const def = RAG_STAGES[layout.id];
  const live = state === "active" || state === "processing";
  const glow = live ? (source === "live" ? "border-live/70 shadow-glow-live" : "border-sim/70 shadow-glow-sim") : "";
  return (
    <button
      type="button"
      data-rag-node={layout.id}
      onClick={() => onSelect(layout.id)}
      aria-pressed={selected}
      aria-label={`${def.label}: ${state}${sublabel ? `, ${sublabel}` : ""}`}
      className={cn(
        "absolute rounded-lg border text-left transition-[border-color,background-color,box-shadow] duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft/70",
        STATE_STYLE[state],
        glow,
        selected && "ring-2 ring-accent-soft/70 ring-offset-2 ring-offset-bg",
      )}
      style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, fontSize: `calc(11px * var(--fs))` }}
    >
      <span className="grid size-full grid-cols-[auto_1fr_auto] grid-rows-[auto_auto] content-center items-start gap-x-2 gap-y-[0.25em] px-3">
        <span className="text-[1.2em] inline-flex mt-[0.05em]">
          <StatusIcon state={state} spin={!reducedMotion} />
        </span>
        <span className="mono font-semibold uppercase leading-[1.15] text-[0.82em] tracking-[0.07em] line-clamp-2 break-words">{def.label}</span>
        <span className="mt-[0.1em]">
          <SourceDot source={source} />
        </span>
        <span className="mono col-span-3 text-[0.82em] truncate text-muted">{sublabel ?? def.caption}</span>
      </span>
      {pulse > 0 && !reducedMotion ? <span key={pulse} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-lg animate-pulse-ring", source === "live" ? "shadow-glow-live" : "shadow-glow-sim")} /> : null}
    </button>
  );
});

/** Dynamic one-liner under each node, derived purely from visual state. */
export function sublabelFor(stage: RagStageId, v: RagVisualState | undefined): string | undefined {
  if (!v) return undefined;
  // A seeded stage describes the index the question will run against; a stage
  // driven by this run's events describes what just happened.
  const docs = v.seededDocuments.length;
  switch (stage) {
    case "ingest":
      if (v.document) return `${v.document.name} · ${formatBytes(v.document.bytes)}`;
      return docs ? (docs === 1 ? v.seededDocuments[0]!.name : `${docs} documents indexed`) : undefined;
    case "load":
      return v.loadNote ?? (v.ingestSeeded ? "already loaded" : undefined);
    case "extract":
      if (v.extraction) return `${v.extraction.chars.toLocaleString()} chars${v.extraction.pages ? ` · ${v.extraction.pages} pp` : ""}`;
      return v.ingestSeeded ? "text already extracted" : undefined;
    case "chunk":
      return v.chunks.length ? `${v.chunks.length} chunks · ~${v.chunkSettings?.chunkSize ?? "?"} tok` : undefined;
    case "overlap":
      return v.chunkSettings ? `${v.chunkSettings.chunkOverlap} tokens shared` : undefined;
    case "embedDocs":
      if (v.embedded) return `${v.embedded.count} × ${v.embedded.dims}-d · ${formatMs(v.embedded.ms)}`;
      if (v.embedProgress) return `${v.embedProgress.done}/${v.embedProgress.total} · ${v.embedding?.model ?? ""}`;
      if (v.ingestSeeded && v.embedding) return `${v.chunks.length} × ${v.embedding.dims}-d · ${v.embedding.model}`;
      return undefined;
    case "vectorStore":
      return v.stored ? `${v.stored.count} vectors in memory` : undefined;
    case "index":
      return v.index ? (v.index.kind === "ivf" ? `IVF · ${v.index.lists} lists` : `flat · ${v.index.vectors} vectors`) : undefined;
    case "query":
      return v.question ? `${v.queryTokens ?? "?"} tokens` : undefined;
    case "embedQuery":
      return v.queryEmbedding ? `${v.queryEmbedding.dims}-d · ${formatMs(v.queryEmbedding.ms)}` : undefined;
    case "search":
      return v.searchReport ? `${v.searchReport.compared}/${v.searchReport.total} compared` : v.searchStrategy;
    case "topK":
      return v.topK ? `${v.topK.kept} kept · ${v.topK.belowThreshold} cut` : undefined;
    case "retrieved":
      return v.results.length ? `${v.results.length} passages` : undefined;
    case "context":
      return v.context ? `${v.context.tokenCount}/${v.context.budget} tokens` : undefined;
    case "prompt":
      return v.prompt ? `~${v.prompt.prompt.tokenEstimate} tok → ${v.prompt.provider}` : undefined;
    case "llm":
      if (v.llm.completed) return `${v.llm.finishReason} · ${formatMs(v.llm.latencyMs)}`;
      if (v.llm.ttfbMs !== undefined) return `first token ${formatMs(v.llm.ttfbMs)}`;
      return v.llm.requestSentAt ? "waiting…" : undefined;
    case "answer":
      return v.llm.text ? `${v.llm.pieces} pieces · ${v.llm.text.length} chars` : undefined;
    case "citations":
      return v.citations.length ? `${v.citations.length} sources` : v.llm.completed ? "no [n] markers" : undefined;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export { RAG_NODE_BY_ID };
