import type { RagSettings } from "@shared/rag";
import type { RagRunState } from "@/labs/rag/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useRagStore } from "@/store/ragStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { RagAnswerPanel } from "./RagAnswerPanel";

const SETTING_LABELS: Partial<Record<keyof RagSettings, string>> = {
  chunkSize: "chunk size",
  chunkOverlap: "overlap",
  embeddingModel: "embedding",
  vectorIndex: "index",
  topK: "top-K",
  similarityThreshold: "threshold",
  retrievalStrategy: "strategy",
  contextBudget: "context budget",
  llmProvider: "LLM",
  maxOutputTokens: "max output",
  temperature: "temperature",
};

/**
 * The same question under two settings, side by side: what differed in the
 * settings, which passages each run retrieved (and which only one did), and
 * the two answers with their telemetry.
 */
export function RagCompare({ runs }: { runs: RagRunState[] }) {
  const kb = useRagStore((s) => s.kb);
  const selectChunk = useRagStore((s) => s.selectChunk);
  const selectedChunkId = useRagStore((s) => s.selectedChunkId);
  const [a, b] = runs;
  if (!a || !b) return null;

  const diffs = (Object.keys(SETTING_LABELS) as (keyof RagSettings)[]).filter((k) => a.settings[k] !== b.settings[k]);
  const idsA = new Set(a.visual.results.map((r) => r.chunkId));
  const idsB = new Set(b.visual.results.map((r) => r.chunkId));
  const shared = [...idsA].filter((id) => idsB.has(id));
  const docName = (docId: string) => kb?.documents.find((d) => d.id === docId)?.name ?? docId;

  return (
    <div className="grid gap-4">
      <GlassPanel title="Comparison" subtitle={`"${a.label}" under two configurations`} bodyClassName="p-4 grid gap-3">
        {diffs.length ? (
          <div className="grid gap-1.5">
            <p className="label-caps">What changed</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {diffs.map((k) => (
                <div key={k} className="rounded-lg border border-line surface-1 px-3 py-1.5 grid grid-cols-[110px_1fr_1fr] items-baseline gap-2 mono text-[11px]">
                  <span className="text-muted truncate">{SETTING_LABELS[k]}</span>
                  <span className="text-live truncate">{String(a.settings[k])}</span>
                  <span className="text-accent-soft truncate">{String(b.settings[k])}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mono text-[11px] text-muted">Identical settings: any difference below comes from the model's sampling, not the pipeline.</p>
        )}

        <div className="grid gap-1.5">
          <p className="label-caps">
            Retrieved passages · {shared.length} shared · {idsA.size - shared.length} only in A · {idsB.size - shared.length} only in B
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {[a, b].map((run, i) => (
              <ol key={run.id} className="grid gap-1" aria-label={`Passages retrieved by ${run.comparisonLabel ?? (i === 0 ? "A" : "B")}`}>
                <li className={cn("mono text-[10px] uppercase tracking-[0.12em]", i === 0 ? "text-live" : "text-accent-soft")}>{run.comparisonLabel ?? (i === 0 ? "A" : "B")}</li>
                {run.visual.results.map((r) => {
                  const other = i === 0 ? idsB : idsA;
                  const unique = !other.has(r.chunkId);
                  const chunk = kb?.chunks.find((c) => c.id === r.chunkId);
                  return (
                    <li key={r.chunkId}>
                      <button type="button" onClick={() => selectChunk(selectedChunkId === r.chunkId ? null : r.chunkId)} className={cn("w-full text-left rounded-lg border px-2.5 py-1.5 grid gap-0.5 min-w-0", selectedChunkId === r.chunkId ? "border-accent/60 bg-accent/[0.07]" : unique ? "border-warn/40 bg-warn/[0.04]" : "border-line surface-1")}>
                        <span className="flex items-center gap-2 min-w-0 mono text-[10.5px]">
                          <span className={i === 0 ? "text-live" : "text-accent-soft"}>#{r.rank}</span>
                          <span className="text-ink truncate">{r.chunkId}</span>
                          <span className="text-muted truncate">{docName(r.docId)}</span>
                          <Badge className="ml-auto shrink-0" tone={unique ? "warn" : "neutral"}>
                            {unique ? "only here" : "both"} · cos {r.vectorScore.toFixed(2)}
                          </Badge>
                        </span>
                        {chunk ? <span className="text-[11px] leading-snug text-muted line-clamp-2">{chunk.text}</span> : null}
                      </button>
                    </li>
                  );
                })}
                {run.visual.results.length === 0 ? <li className="mono text-[10.5px] text-faint">nothing retrieved</li> : null}
              </ol>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mono text-[11px] border-t border-line pt-3">
          <Metric label="compared vectors" a={a.visual.searchReport?.compared} b={b.visual.searchReport?.compared} />
          <Metric label="context tokens" a={a.visual.context?.tokenCount} b={b.visual.context?.tokenCount} />
          <Metric label="latency" a={a.visual.llm.latencyMs} b={b.visual.llm.latencyMs} fmt={formatMs} />
          <Metric label="output tokens" a={a.visual.llm.usage?.outputTokens ?? undefined} b={b.visual.llm.usage?.outputTokens ?? undefined} />
        </dl>
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <RagAnswerPanel run={a} compact />
        <RagAnswerPanel run={b} compact />
      </div>
    </div>
  );
}

function Metric({ label, a, b, fmt = (n: number) => formatNumber(n) }: { label: string; a?: number | null; b?: number | null; fmt?: (n: number) => string }) {
  return (
    <div className="rounded-lg border border-line surface-1 px-2.5 py-2 min-w-0">
      <dt className="label-caps text-[9.5px]">{label}</dt>
      <dd className="flex items-baseline gap-2 mt-0.5">
        <span className="text-live">{a != null ? fmt(a) : "—"}</span>
        <span className="text-faint">vs</span>
        <span className="text-accent-soft">{b != null ? fmt(b) : "—"}</span>
      </dd>
    </div>
  );
}
