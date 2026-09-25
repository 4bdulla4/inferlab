import { X } from "lucide-react";
import type { DataSource } from "@shared/llm";
import { simulateEmbeddings } from "@/engine/simulation";
import { visibleToken } from "@/lib/format";
import { SourceBadge } from "@/components/layout/SourceBadge";

export interface TokenInspectorProps {
  token: string;
  id: number | null;
  position: number;
  encoding?: string;
  source: DataSource;
  exact: boolean;
  onClose: () => void;
}

/** Detail card for a single token. Never invents real embedding values. */
export function TokenInspector({ token, id, position, encoding, source, exact, onClose }: TokenInspectorProps) {
  const vec = simulateEmbeddings([token], 32).vectors[0]!;
  const bytes = new TextEncoder().encode(token);
  return (
    <div role="dialog" aria-label={`Token ${visibleToken(token)}`} className="rounded-lg border border-accent/40 bg-accent/[0.06] p-3 grid gap-2 animate-fade-up">
      <div className="flex items-center gap-2">
        <span className="mono text-[15px] text-ink rounded border border-line bg-bg-elevated px-2 py-0.5">{visibleToken(token)}</span>
        <SourceBadge source={source} compact />
        <button type="button" onClick={onClose} aria-label="Close token inspector" className="ml-auto size-6 inline-flex items-center justify-center rounded border border-line text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <dl className="mono grid grid-cols-3 gap-2 text-[11px]">
        <div><dt className="text-faint uppercase tracking-[0.12em] text-[9.5px]">token id</dt><dd className="text-ink-dim">{id ?? "—"}</dd></div>
        <div><dt className="text-faint uppercase tracking-[0.12em] text-[9.5px]">position</dt><dd className="text-ink-dim">{position}</dd></div>
        <div><dt className="text-faint uppercase tracking-[0.12em] text-[9.5px]">bytes</dt><dd className="text-ink-dim">{bytes.length} · {Array.from(bytes).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join(" ")}{bytes.length > 4 ? " …" : ""}</dd></div>
      </dl>
      <p className="text-[11px] text-muted leading-snug">
        {exact ? `Exact id in the ${encoding ?? "model"} vocabulary.` : `Approximate id from the open ${encoding ?? "BPE"} encoding — the provider's real tokenizer is private.`}
      </p>
      <div>
        <p className="flex items-center justify-between label-caps text-[9.5px] mb-1">
          <span>Approximate representation</span>
          <span className="text-sim">◇ educational visualization</span>
        </p>
        <div className="grid grid-cols-16 gap-[3px]" aria-hidden="true">
          {vec.values.map((val, i) => (
            <span
              key={i}
              className="h-3 rounded-[2px]"
              style={{ backgroundColor: val >= 0 ? `rgba(34,211,238,${0.15 + Math.abs(val) * 0.8})` : `rgba(142,45,255,${0.15 + Math.abs(val) * 0.8})` }}
            />
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-faint">A real embedding is a learned vector with thousands of dimensions; its values are not returned by the API.</p>
      </div>
    </div>
  );
}
