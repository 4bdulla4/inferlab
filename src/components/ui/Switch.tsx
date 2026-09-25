import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  return (
    <label className={cn("flex items-start justify-between gap-3 cursor-pointer", disabled && "opacity-50 cursor-not-allowed", className)}>
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{label}</span>
        {description ? <span className="block text-[11.5px] text-muted leading-snug mt-0.5">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "bg-accent/80 border-accent-soft/60" : "surface-3 border-line-strong",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white ring-1 ring-black/10 shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </label>
  );
}
