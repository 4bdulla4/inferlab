import { Bot, Target } from "lucide-react";
import type { AgentRunState } from "@/labs/agent/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";

/** The goal and the agent's final answer, with the run's real totals and every tool it used beneath. */
export function AgentResponsePanel({ run, className }: { run: AgentRunState | undefined; className?: string }) {
  const v = run?.visual;
  const selectNode = useAgentStore((s) => s.selectNode);
  const streaming = Boolean(v && !v.final && !v.error && !v.stopped && run?.status === "running");
  const source = v?.final?.source ?? (v?.agent?.mock ? "simulation" : "live");
  const calls = v ? Object.values(v.calls).sort((a, b) => a.iteration - b.iteration) : [];

  return (
    <GlassPanel
      title="Final response"
      subtitle={v?.agent?.vendor}
      actions={
        <>
          {v?.completion ? <Badge tone={v.completion.reason === "completed" ? "ok" : v.completion.reason === "error" || v.completion.reason === "stopped" ? "err" : "warn"}>{v.completion.reason.replace(/_/g, " ")}</Badge> : null}
          <SourceBadge source={source} compact />
        </>
      }
      className={className}
      bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll"
    >
      {!run || !v ? (
        <p className="mono text-[11px] text-muted">The agent's answer appears here once it stops calling tools.</p>
      ) : (
        <>
          <div className="flex gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line surface-1">
              <Target className="size-3.5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 rounded-xl rounded-tl-sm border border-line surface-1 px-3 py-2 text-[13px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words">{run.goal}</div>
          </div>
          <div className="flex gap-3">
            <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border", streaming ? "border-live/50 bg-live/10" : "border-accent/50 bg-accent/10")}>
              <Bot className={cn("size-3.5", streaming ? "text-live" : "text-accent-soft")} aria-hidden="true" />
            </span>
            <div className={cn("min-w-0 flex-1 rounded-xl rounded-tl-sm border px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words min-h-[44px]", streaming ? "border-live/30 bg-live/[0.04]" : source === "simulation" ? "border-sim/30 bg-sim/[0.05]" : "border-accent/25 bg-accent/[0.05]")}>
              {v.finalText ? v.finalText : v.error ? <span className="text-err text-[12.5px]">{v.error.message}</span> : v.stopped ? <span className="mono text-[12px] text-muted">Stopped before an answer.</span> : <span className="shimmer-text mono text-[12px]">{v.pendingApproval ? "waiting for you…" : "the agent is working…"}</span>}
              {streaming && v.finalText ? <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" /> : null}
            </div>
          </div>
          {calls.length ? (
            <div className="grid gap-1.5">
              <p className="label-caps">Tools used · click one to inspect</p>
              <ul className="flex flex-wrap gap-1.5">
                {calls.map((c) => (
                  <li key={c.callId}>
                    <button type="button" onClick={() => selectNode(c.fallback?.nodeId ?? c.nodeId)} className={cn("mono inline-flex items-center gap-1.5 rounded-md border px-2 h-6 text-[10.5px] hover:border-line-strong", c.result && !c.result.ok ? "border-err/40 text-err" : "border-line text-ink-dim")}>
                      <span className="text-faint">#{c.iteration}</span>
                      {c.completedTool ?? c.name}
                      {c.result ? <span className={c.result.source === "live" ? "text-live" : "text-sim"}>{c.result.source === "live" ? "●" : "◇"}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {v.completion ? (
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 mono text-[11px]">
              <Stat k="iterations" v={String(v.completion.iterations)} />
              <Stat k="tool calls" v={String(v.completion.toolCalls)} />
              <Stat k="errors · retries" v={`${v.completion.errors} · ${v.completion.retries}`} />
              <Stat k="tokens" v={formatNumber(v.completion.usage.totalTokens)} />
              <Stat k="total time" v={formatMs(v.completion.totalMs)} />
            </dl>
          ) : null}
          {v.agent?.mock ? <p className="text-[11px] leading-snug text-muted">Offline demo: the planner and this text are scripted, so they are labelled a simulation. The tool results above were real.</p> : null}
        </>
      )}
    </GlassPanel>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line surface-1 px-2.5 py-1.5 min-w-0">
      <dt className="text-muted text-[9.5px] uppercase tracking-[0.12em]">{k}</dt>
      <dd className="text-ink text-[12.5px] truncate">{v}</dd>
    </div>
  );
}
