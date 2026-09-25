import { Asterisk, Atom, FlaskConical, Sparkle, type LucideIcon } from "lucide-react";
import type { ProviderDescriptor, ProviderId } from "@shared/llm";
import { cn } from "@/lib/cn";
import { PROVIDER_KEY_FIELD, useUIStore } from "@/store/uiStore";

export interface ModelSelectorProps {
  providers: ProviderDescriptor[];
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
  /** In comparison mode every configured provider runs, so the tabs become informational. */
  comparison?: boolean;
}

/** A recognisable glyph per vendor, tinted so the row reads at a glance. */
const GLYPH: Record<string, { icon: LucideIcon; className: string }> = {
  claude: { icon: Asterisk, className: "text-ink-dim" },
  openai: { icon: Atom, className: "text-ok" },
  gemini: { icon: Sparkle, className: "text-sim" },
  mock: { icon: FlaskConical, className: "text-warn" },
};

/** Providers as selectable cards, two up in a narrow panel and four across a wide one. */
export function ModelSelector({ providers, value, onChange, disabled, comparison }: ModelSelectorProps) {
  const openSettingsFor = useUIStore((s) => s.openSettingsFor);
  const selected = providers.find((p) => p.id === value) ?? providers[0];

  return (
    <div className="grid gap-2 min-w-0">
      <div role="tablist" aria-label="Model" className="grid gap-2 grid-cols-2 @2xl:grid-cols-4">
        {providers.map((p) => {
          const active = p.id === value;
          const glyph = GLYPH[p.mock ? "mock" : p.id] ?? GLYPH.claude!;
          const Icon = glyph.icon;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${p.name} · ${p.model}${p.configured ? "" : " (no API key)"}`}
              disabled={disabled || comparison}
              onClick={() => onChange(p.id)}
              className={cn(
                "flex h-11 min-w-0 items-center gap-2.5 rounded-lg border px-3.5 transition-colors",
                active ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
                (disabled || comparison) && "cursor-default opacity-70",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-accent-soft" : glyph.className)} aria-hidden="true" />
              <span className="text-[13.5px] font-semibold truncate">{p.name}</span>
              <span
                aria-hidden="true"
                title={p.configured ? "Key configured" : "No API key"}
                className={cn("ml-auto size-1.5 rounded-full shrink-0", p.mock ? "bg-warn" : p.configured ? "bg-ok" : "bg-err")}
              />
            </button>
          );
        })}
      </div>

      {selected && !selected.configured && !selected.mock ? (
        <p className="text-[11.5px] text-warn flex flex-wrap items-center gap-x-2">
          <span>No API key for {selected.name}.</span>
          <button type="button" onClick={() => openSettingsFor(PROVIDER_KEY_FIELD[selected.id])} className="mono text-[10.5px] uppercase tracking-[0.1em] text-live underline-offset-2 hover:underline">
            enter one →
          </button>
        </p>
      ) : null}
    </div>
  );
}
