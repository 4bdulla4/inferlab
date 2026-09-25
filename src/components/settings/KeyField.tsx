import { Eye, EyeOff, Loader2, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionKeys } from "@/store/uiStore";
import { cn } from "@/lib/cn";

export interface KeySaveState {
  status: "saving" | "saved" | "error";
  message?: string;
}

export interface KeyFieldProps {
  label: string;
  field: keyof SessionKeys;
  value: string;
  onChange: (field: keyof SessionKeys, value: string) => void;
  onSave: (field: keyof SessionKeys) => void;
  saveState: KeySaveState | null;
  serverConfigured: boolean;
  remembered: boolean;
  autoFocus?: boolean;
  hint?: string;
  placeholder?: string;
  help?: string;
}

/**
 * One credential: masked, savable to the server's .env, and honest about where
 * the value currently lives. Three rows, because a key is a small thing.
 */
export function KeyField({ label, field, value, onChange, onSave, saveState, serverConfigured, remembered, autoFocus, hint, placeholder, help }: KeyFieldProps) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "center" });
    }
  }, [autoFocus]);

  const isSecret = field !== "anthropicWorkspace";
  const status = value ? (remembered ? "in browser" : "this tab") : serverConfigured ? "on server" : isSecret ? "no key" : "not set";
  const tone = value ? "text-sim" : serverConfigured ? "text-ok" : "text-muted";

  return (
    <label className="grid gap-1 min-w-0 content-start">
      <span className="flex items-baseline justify-between gap-2 min-w-0">
        <span className="text-[12.5px] text-ink truncate">
          {label}
          {hint ? <span className="mono ml-1.5 text-[10px] text-faint">{hint}</span> : null}
        </span>
        <span className={cn("mono shrink-0 text-[10px] uppercase tracking-[0.1em]", tone)}>{status}</span>
      </span>

      <span className="flex items-center gap-1.5 min-w-0">
        <span className="relative flex-1 min-w-0">
          <input
            ref={ref}
            type={show || !isSecret ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(field, e.target.value)}
            placeholder={placeholder ?? (serverConfigured ? "override for this session…" : "paste key…")}
            autoComplete="off"
            spellCheck={false}
            aria-label={isSecret ? `${label} API key` : label}
            className="mono h-8 w-full rounded-md border border-line bg-bg-elevated/80 pl-2.5 pr-8 text-[12px] text-ink placeholder:text-faint focus:border-accent/60"
          />
          {isSecret ? (
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide key" : "Show key"}
              className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded text-muted hover:text-ink"
            >
              {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => onSave(field)}
          disabled={!value || saveState?.status === "saving"}
          title="Store this key in the server's .env so it survives a restart"
          className="mono inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent/50 bg-accent/15 px-2 text-[10px] uppercase tracking-[0.08em] text-ink hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saveState?.status === "saving" ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          {saveState?.status === "saving" ? "saving" : ".env"}
        </button>
      </span>

      {saveState?.message ? (
        <span className={cn("text-[10.5px] leading-snug", saveState.status === "error" ? "text-err" : "text-ok")}>{saveState.message}</span>
      ) : help ? (
        <span className="text-[10.5px] leading-snug text-muted">{help}</span>
      ) : null}
    </label>
  );
}
