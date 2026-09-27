import type { EvidenceCitation } from "@shared/agent";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";

const STATUS: Record<EvidenceCitation["status"], { label: string; tone: "ok" | "warn" | "err" }> = {
  verified: { label: "verified", tone: "ok" },
  unseen: { label: "not read", tone: "warn" },
  out_of_range: { label: "bad line", tone: "err" },
  missing: { label: "no file", tone: "err" },
};

/** The ratio in one line, worded for a reader who has not seen the list. */
export function evidenceSummary(verified: number, total: number): string {
  if (total === 0) return "The answer cites no files, so there is nothing to check.";
  if (verified === total) return `All ${total} citation${total === 1 ? "" : "s"} point at lines the agent read.`;
  return `${verified} of ${total} citations point at lines the agent read; the rest are flagged below.`;
}

/**
 * Every `path:line` the answer cited, with code's verdict on it. `onOpen`
 * lets the host page jump to the file; `href` links out to the source.
 */
export function EvidenceList({ citations, onOpen, href, className }: { citations: EvidenceCitation[]; onOpen?: (c: EvidenceCitation) => void; href?: (c: EvidenceCitation) => string | undefined; className?: string }) {
  if (citations.length === 0) return null;
  return (
    <ul className={cn("grid gap-1 min-w-0", className)} aria-label="Citations checked">
      {citations.map((c) => {
        const s = STATUS[c.status];
        const link = href?.(c);
        return (
          <li key={c.ref} className={cn("rounded-md border px-2.5 py-1.5 grid gap-0.5 min-w-0", c.status === "verified" ? "border-line surface-1" : c.status === "unseen" ? "border-warn/35 bg-warn/[0.04]" : "border-err/35 bg-err/[0.04]")}>
            <span className="flex items-center gap-2 min-w-0">
              {onOpen && c.status !== "missing" ? (
                <button type="button" onClick={() => onOpen(c)} className="mono text-[11.5px] text-ink truncate text-left hover:text-accent-soft underline-offset-2 hover:underline">
                  {c.ref}
                </button>
              ) : (
                <span className="mono text-[11.5px] text-ink truncate">{c.ref}</span>
              )}
              <Badge tone={s.tone} className="ml-auto shrink-0">
                {s.label}
              </Badge>
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" className="mono text-[10px] text-muted hover:text-ink shrink-0">
                  source ↗
                </a>
              ) : null}
            </span>
            <span className="text-[11px] text-muted leading-snug">{c.note}</span>
          </li>
        );
      })}
    </ul>
  );
}
