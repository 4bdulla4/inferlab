import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}

export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel, size = "md", className }: SegmentedProps<T>) {
  return (
    // w-fit keeps the track hugging its options: a grid item would otherwise stretch
    // to the whole column even though it is inline-flex.
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex w-fit shrink-0 items-center gap-0.5 rounded-lg border border-line surface-1 p-1", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              // Equal widths so the options read as one control rather than ragged text.
              "mono rounded-md text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              size === "sm" ? "h-6 min-w-[2.75rem] px-2 text-[10.5px]" : "h-7 min-w-[3.5rem] px-2.5 text-[11.5px]",
              active
                ? "surface-3 text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                : "text-muted hover:text-ink-dim hover:surface-1",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
