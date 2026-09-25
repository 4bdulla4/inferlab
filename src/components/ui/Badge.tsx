import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Badge({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: "neutral" | "live" | "sim" | "ok" | "warn" | "err" }) {
  const tones = {
    neutral: "border-line text-muted surface-1",
    live: "border-live/40 text-live bg-live/10",
    sim: "border-sim/40 text-sim bg-sim/10",
    ok: "border-ok/40 text-ok bg-ok/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    err: "border-err/40 text-err bg-err/10",
  } as const;
  return (
    <span className={cn("mono inline-flex items-center gap-1 rounded-md border px-1.5 h-5 text-[10px] tracking-wider uppercase whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}
