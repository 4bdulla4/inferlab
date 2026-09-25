import type { DataSource } from "@shared/llm";
import { cn } from "@/lib/cn";

export interface SourceBadgeProps {
  source: DataSource;
  compact?: boolean;
  className?: string;
}

/** The LIVE / SIMULATION indicator. Uses distinct glyphs, not just color. */
export function SourceBadge({ source, compact, className }: SourceBadgeProps) {
  const live = source === "live";
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1.5 rounded-md border px-1.5 h-5 text-[10px] tracking-[0.12em] uppercase whitespace-nowrap",
        live ? "border-live/40 text-live bg-live/10" : "border-sim/40 text-sim bg-sim/10",
        className,
      )}
      title={live ? "Observed from the provider API" : "Educational / conceptual visualization"}
    >
      <span aria-hidden="true">{live ? "●" : "◇"}</span>
      {compact ? (live ? "LIVE" : "SIM") : live ? "LIVE API DATA" : "EDUCATIONAL SIMULATION"}
    </span>
  );
}

export function SourceDot({ source, className }: { source: DataSource; className?: string }) {
  const live = source === "live";
  return (
    <span
      aria-label={live ? "live" : "simulated"}
      className={cn("mono text-[10px] leading-none", live ? "text-live" : "text-sim", className)}
    >
      {live ? "●" : "◇"}
    </span>
  );
}
