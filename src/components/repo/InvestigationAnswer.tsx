import { Fragment, type ReactNode } from "react";
import type { EvidenceCitation } from "@shared/agent";
import type { RepoAnalysis } from "@shared/repo";
import type { AgentRunState } from "@/labs/agent/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useRepoStore } from "@/store/repoStore";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { EvidenceList, evidenceSummary } from "@/components/agent/EvidenceList";

const PROVIDER_NAME: Record<string, string> = { claude: "Claude", openai: "OpenAI", gemini: "Gemini" };

/** Same shape the server's checker reads, so the two agree on what a citation is. */
const CITATION = /([\w@.~+\-[\]()/]+):(\d{1,6})(?:\s*[-–]\s*(\d{1,6}))?/g;

export function githubLineUrl(analysis: RepoAnalysis, c: Pick<EvidenceCitation, "file" | "startLine" | "endLine">): string {
  const path = c.file.split("/").map(encodeURIComponent).join("/");
  return `${analysis.meta.htmlUrl}/blob/${analysis.meta.sha}/${path}#L${c.startLine}${c.endLine > c.startLine ? `-L${c.endLine}` : ""}`;
}

/**
 * The investigator's answer as it streams, then with each citation marked by
 * code's verdict. Clicking a citation opens the file in the repository
 * inspector; the list below links each one to the source on GitHub.
 */
export function InvestigationAnswer({ run, analysis }: { run: AgentRunState; analysis: RepoAnalysis }) {
  const select = useRepoStore((s) => s.select);
  const v = run.visual;
  const streaming = !v.final && !v.error && !v.stopped && run.status === "running";
  const byRef = new Map((v.evidence?.citations ?? []).map((c) => [c.ref, c]));
  const open = (c: Pick<EvidenceCitation, "file">) => select({ kind: "file", id: c.file });
  const text = v.finalText;

  return (
    <div className="grid gap-3 min-w-0">
      <div className={cn("rounded-lg border p-3 grid gap-2 min-w-0", v.final?.source === "simulation" ? "border-sim/30 bg-sim/[0.05]" : "border-accent/25 bg-accent/[0.04]")}>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={v.agent?.mock ? "simulation" : "live"} />
          <span className="mono text-[10.5px] text-muted">{v.agent ? (v.agent.mock ? "offline planner" : PROVIDER_NAME[v.agent.provider] ?? v.agent.vendor) : "starting…"}</span>
          {v.completion ? (
            <span className="mono text-[10.5px] text-faint">
              {v.completion.iterations} rounds · {v.completion.toolCalls} tool calls · {formatMs(v.completion.totalMs)} · {formatNumber(v.completion.usage.totalTokens)} tokens
            </span>
          ) : null}
          {v.evidence ? (
            <Badge tone={v.evidence.total === 0 ? "neutral" : v.evidence.verified === v.evidence.total ? "ok" : "warn"} className="ml-auto">
              {v.evidence.total ? `${v.evidence.verified}/${v.evidence.total} citations verified` : "no citations"}
            </Badge>
          ) : null}
        </div>
        {text ? (
          <div className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap break-words min-w-0">
            <CitedText text={text} byRef={byRef} onOpen={open} checked={Boolean(v.evidence)} />
            {streaming ? <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" /> : null}
          </div>
        ) : (
          <p className="mono text-[11.5px] text-muted">{v.error ? v.error.message : v.stopped ? "Stopped before an answer." : <span className="shimmer-text">The agent is reading the code. Its answer streams here.</span>}</p>
        )}
        {v.notices.filter((n) => n.level === "warn" || /redacted/.test(n.message)).map((n, i) => (
          <p key={i} className={cn("mono text-[10.5px] leading-snug", n.level === "warn" ? "text-warn" : "text-muted")}>
            {n.level === "warn" ? "⚠" : "ℹ"} {n.message}
          </p>
        ))}
      </div>

      {v.evidence && v.evidence.total > 0 ? (
        <div className="grid gap-2 min-w-0">
          <p className="label-caps">Evidence check · by code, after the answer</p>
          <p className="text-[12px] text-ink-dim leading-snug">{evidenceSummary(v.evidence.verified, v.evidence.total)}</p>
          <EvidenceList citations={v.evidence.citations} onOpen={open} href={(c) => (c.status === "missing" ? undefined : githubLineUrl(analysis, c))} />
        </div>
      ) : null}
    </div>
  );
}

/** Inline **bold**, `code` and citations; everything else is left as written. */
function CitedText({ text, byRef, onOpen, checked }: { text: string; byRef: Map<string, EvidenceCitation>; onOpen: (c: Pick<EvidenceCitation, "file">) => void; checked: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(CITATION)) {
    const citation = lookup(m, byRef);
    // Until the check lands, path-like citations show as neutral chips; after it, only checked ones do.
    const pending = !checked && /[/.]/.test(m[1]!) && /[A-Za-z]/.test(m[1]!);
    if (!citation && !pending) continue;
    const at = m.index!;
    // Keep any bracket the path pattern swallowed outside the chip.
    const lead = citation ? m[0].slice(0, m[0].indexOf(citation.ref.split(":")[0]!)) : "";
    parts.push(<Fragment key={key++}>{inline(text.slice(last, at) + lead, key)}</Fragment>);
    const label = citation ? m[0].slice(lead.length) : m[0];
    parts.push(
      citation ? (
        <button
          key={key++}
          type="button"
          onClick={() => onOpen(citation)}
          title={`${citation.status === "verified" ? "Verified" : citation.status === "unseen" ? "Not read by the agent" : citation.status === "missing" ? "No such file" : "Line out of range"}: ${citation.note}`}
          disabled={citation.status === "missing"}
          className={cn(
            "mono text-[11.5px] rounded px-1 border align-baseline",
            citation.status === "verified" ? "border-ok/35 text-ok bg-ok/[0.06] hover:bg-ok/[0.12]" : citation.status === "unseen" ? "border-warn/40 text-warn bg-warn/[0.06]" : "border-err/40 text-err bg-err/[0.06] line-through decoration-err/60",
          )}
        >
          {label}
        </button>
      ) : (
        <span key={key++} className="mono text-[11.5px] rounded px-1 border border-line text-ink-dim">
          {label}
        </span>
      ),
    );
    last = at + m[0].length;
  }
  parts.push(<Fragment key={key++}>{inline(text.slice(last), key)}</Fragment>);
  return <>{parts}</>;
}

function lookup(m: RegExpMatchArray, byRef: Map<string, EvidenceCitation>): EvidenceCitation | undefined {
  const suffix = `:${m[2]}${m[3] && Number(m[3]) > Number(m[2]) ? `-${m[3]}` : ""}`;
  let candidate = m[1]!;
  while (candidate) {
    const hit = byRef.get(`${candidate}${suffix}`);
    if (hit) return hit;
    if (!/^[([]/.test(candidate)) return undefined;
    candidate = candidate.slice(1);
  }
  return undefined;
}

function inline(text: string, seed: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={`${seed}-${i++}`} className="font-semibold text-ink">{m[1]}</strong> : <code key={`${seed}-${i++}`} className="mono text-[11.5px] rounded bg-bg-elevated px-1">{m[2]}</code>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
