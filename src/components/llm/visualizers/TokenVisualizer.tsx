import type { TokenizationResult } from "@shared/llm";
import { cn } from "@/lib/cn";
import { visibleToken } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";
import { TokenInspector } from "../TokenInspector";

export function TokenVisualizer({ tokenization, showIds, inputText }: { tokenization: TokenizationResult | undefined; showIds: boolean; inputText: string }) {
  const selected = useUIStore((s) => s.selectedToken);
  const selectToken = useUIStore((s) => s.selectToken);

  if (!tokenization) {
    return <p className="mono text-[11px] text-muted">Tokens appear once this stage has run.</p>;
  }
  const { tokens, ids, exact, source, encoding, note } = tokenization;
  const sel = selected?.scope === "input" ? selected.index : null;

  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">
        {tokens.length} tokens · {encoding} · {exact ? "exact" : "approximate"}
      </p>

      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-3">
        <div>
          <p className="label-caps mb-1.5">User text</p>
          <p className="text-[13px] text-ink-dim break-words">{inputText}</p>
        </div>
        <div className="text-center mono text-faint">↓</div>
        <div>
          <p className="label-caps mb-1.5">Tokens · click to inspect</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Tokens">
            {tokens.map((t, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => selectToken(sel === i ? null : { scope: "input", index: i })}
                  aria-pressed={sel === i}
                  className={cn(
                    "mono rounded-md border px-1.5 py-0.5 text-[12px] transition-colors animate-fade-up",
                    source === "live" ? "border-live/40 bg-live/10 text-ink hover:bg-live/20" : "border-sim/40 bg-sim/10 text-ink hover:bg-sim/20",
                    sel === i && "ring-2 ring-accent-soft/70",
                  )}
                  style={{ animationDelay: `${Math.min(i, 40) * 30}ms` }}
                >
                  {visibleToken(t)}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {showIds ? (
          <>
            <div className="text-center mono text-faint">↓</div>
            <div>
              <p className="label-caps mb-1.5">Token ids</p>
              <ul className="flex flex-wrap gap-1.5 mono text-[12px]" aria-label="Token ids">
                {ids.map((id, i) => (
                  <li key={i} className={cn("rounded-md border border-line surface-1 px-1.5 py-0.5 text-ink-dim", sel === i && "ring-2 ring-accent-soft/70")}>
                    {id}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </div>

      {sel !== null && tokens[sel] !== undefined ? (
        <TokenInspector token={tokens[sel]!} id={ids[sel] ?? null} position={sel} encoding={encoding} source={source} exact={exact} onClose={() => selectToken(null)} />
      ) : null}

      <p className="text-[11.5px] leading-snug text-muted">{note}</p>
    </div>
  );
}
