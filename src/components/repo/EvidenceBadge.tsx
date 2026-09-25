import type { EvidenceKind } from "@shared/repo";
import { cn } from "@/lib/cn";

const STYLE: Record<EvidenceKind, { cls: string; glyph: string; label: string; long: string; title: string }> = {
  verified: { cls: "border-ok/45 text-ok bg-ok/10", glyph: "●", label: "VERIFIED", long: "VERIFIED · repository fact", title: "Read directly from the repository (file, line or manifest entry)" },
  heuristic: { cls: "border-warn/45 text-warn bg-warn/10", glyph: "◆", label: "INFERRED", long: "INFERRED · heuristic rule", title: "Derived by a deterministic rule from verified facts" },
  ai: { cls: "border-sim/45 text-sim bg-sim/10", glyph: "◇", label: "AI-INFERRED", long: "AI-INFERRED · model output", title: "Proposed by the model and checked against the repository index" },
};

export function EvidenceBadge({ kind, compact, className }: { kind: EvidenceKind; compact?: boolean; className?: string }) {
  const s = STYLE[kind];
  return (
    <span title={s.title} className={cn("mono inline-flex items-center gap-1.5 rounded-md border px-1.5 h-5 text-[10px] tracking-[0.12em] uppercase whitespace-nowrap", s.cls, className)}>
      <span aria-hidden="true">{s.glyph}</span>
      {compact ? s.label : s.long}
    </span>
  );
}

export function EvidenceDot({ kind, className }: { kind: EvidenceKind; className?: string }) {
  const s = STYLE[kind];
  return (
    <span aria-label={s.label.toLowerCase()} title={s.title} className={cn("mono text-[10px] leading-none", kind === "verified" ? "text-ok" : kind === "heuristic" ? "text-warn" : "text-sim", className)}>
      {s.glyph}
    </span>
  );
}
