import type { RagChunk, RagDocument, RetrievalStrategy, ScoredChunk, SearchReport } from "@shared/rag";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";

export interface RetrievalRankingPanelProps {
  report?: SearchReport;
  results: ScoredChunk[];
  threshold: number;
  topK: number;
  strategy?: RetrievalStrategy;
  explanation?: string;
  chunks: RagChunk[];
  documents: RagDocument[];
  selectedChunkId?: string | null;
  onSelectChunk?: (chunkId: string | null) => void;
  /** Show only the ranked results, not the full candidate bar chart. */
  compact?: boolean;
}

/**
 * Why these passages and not others. The bars are every candidate the index
 * scored, by cosine; the threshold line and the top-K cut show what was
 * dropped where; each kept passage explains its own rank.
 */
export function RetrievalRankingPanel({ report, results, threshold, topK, strategy, explanation, chunks, documents, selectedChunkId, onSelectChunk, compact }: RetrievalRankingPanelProps) {
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const docName = (id: string) => documents.find((d) => d.id === id)?.name ?? id;
  const kept = new Map(results.map((r) => [r.chunkId, r]));

  if (!report && results.length === 0) return <p className="mono text-[11px] text-muted">The ranking appears once a question has been searched.</p>;

  const candidates = report?.candidates ?? [];
  const maxScore = Math.max(0.05, ...candidates.map((c) => Math.abs(c.vectorScore)), ...results.map((r) => Math.abs(r.vectorScore)));
  const barW = 100 / Math.max(1, candidates.length);

  return (
    <div className="grid gap-3 min-w-0">
      {report ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mono text-[11px] text-muted">
          <span>
            compared <span className="text-ink">{report.compared}</span> of {report.total} vectors
          </span>
          <span>·</span>
          <span>{report.candidates.length} candidates scored</span>
          <span>·</span>
          <span>
            <span className="text-warn">{report.belowThreshold}</span> below {threshold.toFixed(2)}
          </span>
          <span>·</span>
          <span>{report.ms} ms</span>
          {report.probedLists ? <Badge tone="live">IVF · probed lists {report.probedLists.join(", ")}</Badge> : <Badge tone="live">{report.index} index</Badge>}
        </div>
      ) : null}

      {!compact && candidates.length > 0 ? (
        <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-1.5">
          <p className="label-caps">Cosine similarity of every candidate · threshold and top-{topK} cut</p>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-24" role="img" aria-label="Candidate similarity scores">
            {candidates.map((c, i) => {
              const h = Math.max(0.6, (Math.max(0, c.vectorScore) / maxScore) * 34);
              const hit = kept.get(c.chunkId);
              const below = c.vectorScore < threshold;
              const selected = selectedChunkId === c.chunkId;
              return (
                <g key={c.chunkId} className="cursor-pointer" onClick={() => onSelectChunk?.(selected ? null : c.chunkId)}>
                  <title>{`${c.chunkId} · cos ${c.vectorScore.toFixed(3)}${hit ? ` · kept as rank ${hit.rank}` : below ? " · below threshold" : " · outside top-K"}`}</title>
                  <rect
                    x={i * barW + barW * 0.15}
                    y={38 - h}
                    width={barW * 0.7}
                    height={h}
                    fill={hit ? "var(--color-live)" : below ? "var(--color-err)" : "var(--color-faint)"}
                    opacity={hit ? 0.95 : below ? 0.55 : 0.5}
                    stroke={selected ? "var(--color-accent-soft)" : "none"}
                    strokeWidth={selected ? 0.8 : 0}
                  />
                </g>
              );
            })}
            <line x1={0} x2={100} y1={38 - (Math.max(0, threshold) / maxScore) * 34} y2={38 - (Math.max(0, threshold) / maxScore) * 34} stroke="var(--color-warn)" strokeWidth={0.4} strokeDasharray="1.5 1.5" />
            {results.length > 0 && results.length < candidates.length ? <line x1={results.length * barW} x2={results.length * barW} y1={2} y2={38} stroke="var(--color-accent-soft)" strokeWidth={0.4} strokeDasharray="1 1.5" /> : null}
          </svg>
          <p className="mono flex flex-wrap gap-x-3 text-[10px] text-faint">
            <span className="text-live">■ kept</span>
            <span>■ outside top-K</span>
            <span className="text-err">■ below threshold</span>
            <span className="text-warn">- - threshold</span>
            {strategy && strategy !== "similarity" ? <span className="text-accent-soft">bars are cosine order; {strategy} reordered the kept set</span> : null}
          </p>
        </div>
      ) : null}

      {explanation ? <p className="text-[11.5px] leading-snug text-ink-dim">{explanation}</p> : null}

      <ol className="grid gap-1.5" aria-label="Retrieved passages by rank">
        {results.map((r) => {
          const chunk = chunkById.get(r.chunkId);
          const selected = selectedChunkId === r.chunkId;
          return (
            <li key={r.chunkId}>
              <button
                type="button"
                onClick={() => onSelectChunk?.(selected ? null : r.chunkId)}
                aria-pressed={selected}
                className={cn("w-full text-left rounded-lg border px-3 py-2 grid gap-1 min-w-0", selected ? "border-accent/60 bg-accent/[0.07]" : "border-line surface-1 hover:border-line-strong")}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span className="mono text-[11px] text-live shrink-0">#{r.rank}</span>
                  <span className="mono text-[10.5px] text-ink truncate">{r.chunkId}</span>
                  <span className="text-[11px] text-muted truncate">
                    {docName(r.docId)}
                    {chunk?.page ? ` · p.${chunk.page}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    <Badge tone="live">cos {r.vectorScore.toFixed(3)}</Badge>
                    {r.lexicalScore !== undefined ? <Badge tone="ok">bm25 {r.lexicalScore.toFixed(2)}</Badge> : null}
                    {r.redundancyPenalty !== undefined && r.rank > 1 ? <Badge tone="warn">−{r.redundancyPenalty.toFixed(2)} redundancy</Badge> : null}
                    {r.vectorRank !== undefined || r.lexicalRank !== undefined ? <Badge>v#{r.vectorRank ?? "–"} · k#{r.lexicalRank ?? "–"}</Badge> : null}
                  </span>
                </span>
                <span className="text-[11px] leading-snug text-ink-dim">{r.reason}</span>
                {chunk ? <span className="text-[11.5px] leading-snug text-muted line-clamp-2">{highlight(chunk.text, r.matchedTerms)}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Marks the query terms that appear in a passage, so the lexical side of a match is visible. */
function highlight(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text.slice(0, 260);
  const excerpt = text.slice(0, 260);
  const splitter = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  // Membership is checked against the term set, not by re-testing a stateful global regex.
  const wanted = new Set(terms.map((t) => t.toLowerCase()));
  return excerpt.split(splitter).map((part, i) => (wanted.has(part.toLowerCase()) ? <mark key={i} className="rounded-sm bg-live/20 text-live px-0.5">{part}</mark> : <span key={i}>{part}</span>));
}
