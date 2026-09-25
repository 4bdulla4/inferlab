import { Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { ProviderId } from "@shared/llm";
import type { EmbeddingProviderId, RagSettings, RetrievalStrategy, VectorIndexKind } from "@shared/rag";
import { ragRuntime } from "@/engine/rag/ragRuntime";
import { cn } from "@/lib/cn";
import { useRagStore } from "@/store/ragStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceDot } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";

/**
 * Every knob that changes what the pipeline does. Chunking, embedding and index
 * settings change the knowledge base and need a rebuild; retrieval and
 * generation settings apply to the next question straight away.
 *
 * `bare` drops the panel chrome so a drawer can supply its own header.
 */
export function RagSettingsPanel({ bare, className }: { bare?: boolean; className?: string } = {}) {
  const settings = useRagStore((s) => s.settings);
  const service = useRagStore((s) => s.service);
  const kb = useRagStore((s) => s.kb);
  const ingesting = useRagStore((s) => s.ingesting);
  const save = (partial: Partial<RagSettings>) => void ragRuntime.saveSettings(partial).catch(() => {});

  const embeddingOptions = service?.embeddingModels ?? [];
  const llmOptions = service?.llmProviders ?? [];
  const selectedEmbedding = embeddingOptions.find((m) => m.provider === settings.embeddingProvider && m.model === settings.embeddingModel);

  const body = (
    <>
      <Group title="Ingestion" note={kb?.stale ? "changed since the index was built · rebuild to apply" : "applies when documents are added or the index is rebuilt"} stale={Boolean(kb?.stale)}>
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <Range label="Chunk size" unit="tokens" value={settings.chunkSize} min={32} max={1024} step={16} onChange={(v) => save({ chunkSize: v, chunkOverlap: Math.min(settings.chunkOverlap, v - 8) })} help="Bigger chunks carry more context but blur what each one is about." />
          <Range label="Chunk overlap" unit="tokens" value={settings.chunkOverlap} min={0} max={Math.max(0, settings.chunkSize - 8)} step={8} onChange={(v) => save({ chunkOverlap: v })} help="Text shared between neighbours so ideas split at a boundary survive." />
        </div>
        <Field label="Embedding model">
          <div className="grid gap-1.5">
            {embeddingOptions.map((m) => {
              const active = m.provider === settings.embeddingProvider && m.model === settings.embeddingModel;
              return (
                <button
                  key={`${m.provider}:${m.model}`}
                  type="button"
                  disabled={!m.configured}
                  aria-pressed={active}
                  onClick={() => save({ embeddingProvider: m.provider as EmbeddingProviderId, embeddingModel: m.model })}
                  title={m.configured ? m.note : "Add a key in Settings to use this model"}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 h-9 text-left min-w-0",
                    active ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
                    !m.configured && "opacity-45 cursor-not-allowed",
                  )}
                >
                  <SourceDot source={m.source} />
                  <span className="text-[12.5px] truncate">{m.label}</span>
                  <span className="mono ml-auto text-[10px] text-muted shrink-0">{m.dims}-d</span>
                  {!m.configured ? <Badge tone="err">no key</Badge> : null}
                </button>
              );
            })}
          </div>
          {selectedEmbedding ? <p className="text-[10.5px] leading-snug text-muted mt-1.5">{selectedEmbedding.note}</p> : null}
        </Field>
        <Field label="Vector index" help={settings.vectorIndex === "ivf" ? "Clusters vectors into √n lists and probes the closest third. Fewer comparisons, some recall lost; with few chunks it falls back to flat." : "Compares the question against every vector. Exact, and fine at this scale."}>
          <Segmented<VectorIndexKind> ariaLabel="Vector index" size="sm" value={settings.vectorIndex} onChange={(v) => save({ vectorIndex: v })} options={[{ value: "flat", label: "Flat (exact)" }, { value: "ivf", label: "IVF (clustered)" }]} />
        </Field>
      </Group>

      <Group title="Retrieval" note="applies to the next question">
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <Range label="Top-K" value={settings.topK} min={1} max={12} step={1} onChange={(v) => save({ topK: v })} help="How many passages survive the cut." />
          <Range label="Similarity threshold" value={settings.similarityThreshold} min={-0.2} max={0.9} step={0.05} digits={2} onChange={(v) => save({ similarityThreshold: v })} help="Cosine floor. Candidates below it are dropped before ranking." />
        </div>
        <Field label="Strategy" help={STRATEGY_HELP[settings.retrievalStrategy]}>
          <Segmented<RetrievalStrategy> ariaLabel="Retrieval strategy" size="sm" value={settings.retrievalStrategy} onChange={(v) => save({ retrievalStrategy: v })} options={[{ value: "similarity", label: "Similarity" }, { value: "mmr", label: "MMR" }, { value: "hybrid", label: "Hybrid" }]} />
        </Field>
        <Range label="Context budget" unit="tokens" value={settings.contextBudget} min={200} max={6000} step={100} onChange={(v) => save({ contextBudget: v })} help="Passages are packed in rank order until this is full; the rest are dropped and shown as such." />
      </Group>

      <Group title="Generation" note="the model that writes the answer">
        <Field label="LLM">
          <div className="flex flex-wrap gap-1.5">
            {llmOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.configured}
                aria-pressed={settings.llmProvider === p.id}
                onClick={() => save({ llmProvider: p.id as ProviderId })}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[12.5px]",
                  settings.llmProvider === p.id ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
                  !p.configured && "opacity-45 cursor-not-allowed",
                )}
                title={p.configured ? p.model : "Add a key in Settings"}
              >
                {p.name}
                <span className="mono text-[10px] text-muted">{p.model}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <Range label="Max output tokens" value={settings.maxOutputTokens} min={64} max={2000} step={16} onChange={(v) => save({ maxOutputTokens: v })} />
          <Range label="Temperature" value={settings.temperature} min={0} max={1.5} step={0.05} digits={2} onChange={(v) => save({ temperature: v })} help="Ignored by models that reject it; the run says so." />
        </div>
      </Group>
    </>
  );

  const rebuild = kb?.stale ? (
    <Button size="sm" variant="live" icon={ingesting ? <Loader2 className="animate-spin" /> : <RefreshCw />} disabled={ingesting} onClick={() => void ragRuntime.rebuild().catch(() => {})}>
      Rebuild index
    </Button>
  ) : null;

  if (bare) {
    return (
      <div className={cn("grid gap-4 content-start", className)}>
        {rebuild ? <div className="flex justify-end">{rebuild}</div> : null}
        {body}
      </div>
    );
  }

  return (
    <GlassPanel
      title="Pipeline settings"
      subtitle="change anything, then rerun and compare"
      actions={rebuild ?? <SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />}
      className={className}
      bodyClassName="p-3.5 grid gap-4"
    >
      {body}
    </GlassPanel>
  );
}

const STRATEGY_HELP: Record<RetrievalStrategy, string> = {
  similarity: "Pure cosine ranking. Fast and predictable; near-duplicate passages can crowd the top.",
  mmr: "Maximal marginal relevance: each pick is penalised for resembling passages already chosen, so the set is more diverse.",
  hybrid: "Vector ranks fused with BM25 keyword ranks by reciprocal rank fusion. Catches exact terms an embedding misses.",
};

function Group({ title, note, stale, children }: { title: string; note?: string; stale?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="label-caps">{title}</h3>
        {note ? <span className={cn("mono text-[10px]", stale ? "text-warn" : "text-faint")}>{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 min-w-0">
      <span className="label-caps text-[9.5px]">{label}</span>
      {children}
      {help ? <span className="text-[10.5px] leading-snug text-muted">{help}</span> : null}
    </div>
  );
}

function Range({ label, unit, value, min, max, step, digits = 0, onChange, help }: { label: string; unit?: string; value: number; min: number; max: number; step: number; digits?: number; onChange: (v: number) => void; help?: string }) {
  return (
    <label className="grid gap-1 min-w-0">
      <span className="flex items-baseline justify-between gap-2 label-caps text-[9.5px]">
        <span>{label}</span>
        <span className="mono text-ink-dim normal-case tracking-normal text-[11px]">
          {value.toFixed(digits)}
          {unit ? <span className="text-faint"> {unit}</span> : null}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="range-input w-full" style={{ ["--fill" as string]: `${((value - min) / Math.max(1e-9, max - min)) * 100}%` }} />
      {help ? <span className="text-[10.5px] leading-snug text-muted">{help}</span> : null}
    </label>
  );
}
