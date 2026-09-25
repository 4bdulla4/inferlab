import type { PositionalSimulation } from "@/labs/llm/events";
import { visibleToken } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";

export function PositionalVisualizer({ positional }: { positional: PositionalSimulation | undefined }) {
  const mode = useUIStore((s) => s.mode);
  if (!positional) return <p className="mono text-[11px] text-muted">Positions appear once this stage has run.</p>;
  const shown = positional.positions.slice(0, 16);
  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">{positional.positions.length} positions</p>
      <ul className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-1.5" aria-label="Token positions">
        {shown.map((p, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
            <span className="mono text-[12px] text-ink text-right truncate">{visibleToken(p.token)}</span>
            <span className="mono text-[10px] text-faint">+</span>
            <span className="mono text-[11px] text-sim">
              position {p.position}
              <span className="ml-2 inline-flex gap-[2px] align-middle" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, k) => (
                  <span key={k} className="inline-block h-2 w-1 rounded-[1px]" style={{ backgroundColor: `rgba(167,139,250,${0.25 + 0.7 * Math.abs(Math.sin((p.position + 1) / (k + 1)))})` }} />
                ))}
              </span>
            </span>
          </li>
        ))}
        {positional.positions.length > shown.length ? <li className="mono text-[10.5px] text-faint">+{positional.positions.length - shown.length} more</li> : null}
      </ul>
      <p className="text-[11.5px] leading-snug text-muted">{positional.note}</p>
      {mode === "advanced" ? (
        <p className="text-[11.5px] leading-snug text-muted">
          Sinusoidal or learned absolute embeddings are added to the token vector; rotary encodings (RoPE) instead rotate Query/Key vectors inside attention so relative distance is encoded in dot products.
        </p>
      ) : null}
    </div>
  );
}
