import type { VisualState } from "@/labs/llm/state";
import { visibleToken } from "@/lib/format";

export function DetokenizationVisualizer({ visual }: { visual: VisualState | undefined }) {
  const d = visual?.detokenization;
  if (!d) return <p className="mono text-[11px] text-muted">Detokenization runs after generation completes.</p>;
  const shown = d.tokens.slice(0, 60);
  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">{d.tokens.length} pieces → {d.text.length} characters</p>
      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-2">
        <p className="label-caps">Streamed pieces</p>
        <div className="flex flex-wrap gap-1">
          {shown.map((t, i) => (
            <span key={i} className="mono text-[11px] rounded border border-live/30 bg-live/10 px-1 text-ink-dim animate-fade-up" style={{ animationDelay: `${i * 12}ms` }}>
              {visibleToken(t)}
            </span>
          ))}
          {d.tokens.length > shown.length ? <span className="mono text-[10.5px] text-faint">+{d.tokens.length - shown.length}</span> : null}
        </div>
        <div className="text-center mono text-faint">↓ join · decode UTF-8</div>
        <p className="label-caps">Text</p>
        <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap break-words">{d.text}</p>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{d.note}</p>
    </div>
  );
}
