import { useMemo } from "react";
import type { ProjectedPoint, RagChunk, RagDocument, ScoredChunk } from "@shared/rag";
import { cn } from "@/lib/cn";
import { SourceBadge } from "@/components/layout/SourceBadge";

const DOC_COLORS = ["var(--color-accent-soft)", "var(--color-live)", "var(--color-ok)", "var(--color-warn)", "var(--color-sim)", "var(--color-err)"];

export interface VectorSpaceViewProps {
  projection: ProjectedPoint[] | null | undefined;
  chunks: RagChunk[];
  documents: RagDocument[];
  results?: ScoredChunk[];
  query?: { x: number; y: number } | null;
  selectedChunkId?: string | null;
  onSelectChunk?: (chunkId: string | null) => void;
  /** Whether the vectors behind the points came from a real model or the local stand-in. */
  embeddingSource: "live" | "simulation";
  compact?: boolean;
}

/**
 * The knowledge base drawn on a plane: every chunk as a point at its PCA
 * projection, coloured by document, with the retrieved ones ringed by rank and
 * the question's own point marked. The vectors are real; the plane is a lossy
 * view of them, so distance here is a hint about similarity, not the score.
 */
export function VectorSpaceView({ projection, chunks, documents, results = [], query, selectedChunkId, onSelectChunk, embeddingSource, compact }: VectorSpaceViewProps) {
  const size = compact ? 220 : 360;
  const pad = 18;
  const docIndex = useMemo(() => new Map(documents.map((d, i) => [d.id, i])), [documents]);
  const chunkById = useMemo(() => new Map(chunks.map((c) => [c.id, c])), [chunks]);
  const rankById = useMemo(() => new Map(results.map((r) => [r.chunkId, r])), [results]);

  if (!projection || projection.length === 0) {
    return <p className="mono text-[11px] text-muted">The vector space appears once chunks have been embedded and indexed.</p>;
  }

  const toPx = (v: number) => pad + ((v + 1) / 2) * (size - pad * 2);

  return (
    <div className="grid gap-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="mono text-[11px] text-muted">
          {projection.length} chunk vectors · 2-D PCA projection{query ? " · ◆ question" : ""}
        </p>
        <span className="flex items-center gap-1.5">
          <SourceBadge source={embeddingSource} compact />
          <span className="mono text-[10px] text-sim">◇ projection</span>
        </span>
      </div>
      <div className="rounded-lg border border-line bg-bg-elevated/60 p-2 grid place-items-center">
        <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} role="img" aria-label="Chunk vectors projected to two dimensions">
          <line x1={pad} y1={size / 2} x2={size - pad} y2={size / 2} className="stroke-line" strokeWidth={0.6} strokeDasharray="3 4" />
          <line x1={size / 2} y1={pad} x2={size / 2} y2={size - pad} className="stroke-line" strokeWidth={0.6} strokeDasharray="3 4" />

          {query
            ? results.map((r) => {
                const p = projection.find((q) => q.chunkId === r.chunkId);
                if (!p) return null;
                return <line key={`ray-${r.chunkId}`} x1={toPx(query.x)} y1={toPx(-query.y)} x2={toPx(p.x)} y2={toPx(-p.y)} className="stroke-live/50" strokeWidth={1} strokeDasharray="2 3" />;
              })
            : null}

          {projection.map((p) => {
            const chunk = chunkById.get(p.chunkId);
            const doc = chunk ? docIndex.get(chunk.docId) ?? 0 : 0;
            const hit = rankById.get(p.chunkId);
            const selected = selectedChunkId === p.chunkId;
            const cx = toPx(p.x);
            const cy = toPx(-p.y);
            return (
              <g key={p.chunkId} className="cursor-pointer" onClick={() => onSelectChunk?.(selected ? null : p.chunkId)}>
                <title>{`${chunk?.id ?? p.chunkId}${hit ? ` · rank ${hit.rank} · cos ${hit.vectorScore.toFixed(3)}` : ""}\n${chunk?.text.slice(0, 120) ?? ""}`}</title>
                {hit ? <circle cx={cx} cy={cy} r={hit.rank === 1 ? 11 : 9} fill="none" className="stroke-live" strokeWidth={1.4} opacity={0.9} /> : null}
                {selected ? <circle cx={cx} cy={cy} r={13} fill="none" className="stroke-accent-soft" strokeWidth={1.6} /> : null}
                <circle cx={cx} cy={cy} r={hit ? 4.5 : 3.2} fill={DOC_COLORS[doc % DOC_COLORS.length]} opacity={hit || !results.length ? 0.95 : 0.45} />
                {hit ? (
                  <text x={cx + 8} y={cy - 8} className="mono fill-live" style={{ fontSize: 9 }}>
                    #{hit.rank}
                  </text>
                ) : null}
              </g>
            );
          })}

          {query ? (
            <g>
              <title>The question's vector, projected onto the same plane</title>
              <path d={`M ${toPx(query.x)} ${toPx(-query.y) - 7} l 7 7 l -7 7 l -7 -7 z`} className="fill-live stroke-bg" strokeWidth={1.5} />
            </g>
          ) : null}
        </svg>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {documents.map((d, i) => (
          <li key={d.id} className="mono flex items-center gap-1.5 text-[10px] text-muted min-w-0">
            <span className="inline-block size-2 rounded-full shrink-0" style={{ backgroundColor: DOC_COLORS[i % DOC_COLORS.length] }} aria-hidden="true" />
            <span className="truncate max-w-[180px]">{d.name}</span>
          </li>
        ))}
      </ul>
      <p className={cn("text-[10.5px] leading-snug text-muted")}>
        Points are real {embeddingSource === "live" ? "model" : "locally computed"} vectors squashed onto two axes that keep the most variance. Neighbours here are usually neighbours in the full space, but the search ranked by cosine over every dimension, not by distance on this plane.
      </p>
    </div>
  );
}
