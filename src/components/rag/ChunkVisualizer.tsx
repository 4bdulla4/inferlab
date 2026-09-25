import type { RagChunk } from "@shared/rag";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { SourceBadge } from "@/components/layout/SourceBadge";

export interface ChunkVisualizerProps {
  chunks: RagChunk[];
  chunkSize?: number;
  chunkOverlap?: number;
  /** Highlight the shared spans between neighbours. */
  showOverlap?: boolean;
  selectedChunkId?: string | null;
  onSelectChunk?: (chunkId: string | null) => void;
  /** Cap on how many chunk blocks to draw before summarising the rest. */
  limit?: number;
}

/**
 * The document laid out as its chunks: one block per chunk, width proportional
 * to token count, with the tokens each shares with its predecessor shaded.
 * Everything here is the real chunking result, not a sketch of one.
 */
export function ChunkVisualizer({ chunks, chunkSize, chunkOverlap, showOverlap, selectedChunkId, onSelectChunk, limit = 48 }: ChunkVisualizerProps) {
  if (chunks.length === 0) return <p className="mono text-[11px] text-muted">Chunks appear once a document has been split.</p>;
  const shown = chunks.slice(0, limit);
  const maxTokens = Math.max(1, ...shown.map((c) => c.tokenCount));
  const totalTokens = chunks.reduce((s, c) => s + c.tokenCount, 0);
  const docs = new Set(chunks.map((c) => c.docId)).size;

  return (
    <div className="grid gap-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="mono text-[11px] text-muted">
          <span className="text-ink">{chunks.length}</span> chunks · {formatNumber(totalTokens)} tokens{docs > 1 ? ` · ${docs} documents` : ""}
          {chunkSize ? ` · target ${chunkSize}` : ""}
          {chunkOverlap !== undefined ? ` · overlap ${chunkOverlap}` : ""}
        </p>
        <SourceBadge source="live" compact />
      </div>

      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-1.5">
        <p className="label-caps">{showOverlap ? "Token windows · shaded = shared with the previous chunk" : "Token windows · width = token count"}</p>
        <ol className="grid gap-1" aria-label="Chunks">
          {shown.map((c) => {
            const selected = selectedChunkId === c.id;
            const overlapPct = showOverlap && c.overlapTokens > 0 ? (c.overlapTokens / c.tokenCount) * 100 : 0;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectChunk?.(selected ? null : c.id)}
                  aria-pressed={selected}
                  title={`${c.id} · ${c.tokenCount} tokens · chars ${c.charStart}–${c.charEnd}${c.page ? ` · page ${c.page}` : ""}`}
                  className="group grid w-full grid-cols-[52px_minmax(0,1fr)_52px] items-center gap-2 text-left"
                >
                  <span className="mono text-[10px] text-faint truncate">c{c.index}</span>
                  <span className={cn("relative h-4 rounded-sm border overflow-hidden", selected ? "border-accent-soft" : "border-line group-hover:border-line-strong")} style={{ width: `${(c.tokenCount / maxTokens) * 100}%` }}>
                    <span className="absolute inset-0 bg-live/25" />
                    {overlapPct > 0 ? <span className="absolute inset-y-0 left-0 bg-sim/60" style={{ width: `${overlapPct}%` }} title={`${c.overlapTokens} tokens shared with c${c.index - 1}`} /> : null}
                  </span>
                  <span className="mono text-[10px] text-muted text-right">{c.tokenCount}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {chunks.length > shown.length ? <p className="mono text-[10px] text-faint">+{chunks.length - shown.length} more chunks not drawn</p> : null}
      </div>

      {selectedChunkId ? <ChunkText chunk={chunks.find((c) => c.id === selectedChunkId)} /> : null}
    </div>
  );
}

function ChunkText({ chunk }: { chunk: RagChunk | undefined }) {
  if (!chunk) return null;
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/[0.05] px-3 py-2 grid gap-1 min-w-0">
      <p className="mono text-[10.5px] text-accent-soft">
        {chunk.id} · {chunk.tokenCount} tokens · chars {chunk.charStart}–{chunk.charEnd}
        {chunk.page ? ` · page ${chunk.page}` : ""}
        {chunk.overlapTokens ? ` · first ${chunk.overlapTokens} tokens shared with c${chunk.index - 1}` : ""}
      </p>
      <p className="text-[12px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto panel-scroll">{chunk.text}</p>
    </div>
  );
}
