import { useEffect, useRef } from "react";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import { useAgentStore } from "@/store/agentStore";
import { useRepoStore } from "@/store/repoStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { AgentGraph } from "@/components/agent/AgentGraph";
import { AgentInspectorPanel, AgentStepPanel } from "@/components/agent/AgentInspector";
import { AgentPlaybackControls } from "@/components/agent/AgentPlaybackControls";
import { AgentTimeline } from "@/components/agent/AgentTimeline";

/**
 * The investigator at work: the same growing graph, timeline, playback and
 * inspectors as the Agents lab, fed by the investigation's own run. Every tool
 * node is a real read of this repository.
 */
export function InvestigationPanel() {
  const ref = useRepoStore((s) => s.investigation);
  const setInvestigation = useRepoStore((s) => s.setInvestigation);
  const run = useAgentStore((s) => (ref ? s.runs[ref.runId] : undefined));
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new investigation brings the graph into view; replays of the same one do not.
  const runId = ref?.runId;
  useEffect(() => {
    if (!runId) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [runId]);

  if (!ref || !run) return null;
  const v = run.visual;
  const reads = Object.values(v.calls).filter((c) => c.name === "read_file" && c.result?.ok).length;

  return (
    <div ref={scrollRef} className="scroll-mt-20 grid gap-4 min-w-0">
      <GlassPanel
        title="Investigator agent"
        subtitle={`${ref.question.slice(0, 90)}${ref.question.length > 90 ? "…" : ""}`}
        actions={
          <>
            <SourceBadge source="live" compact />
            {v.agent?.mock ? <SourceBadge source="simulation" compact /> : null}
            {reads ? <Badge tone="neutral">{reads} file reads</Badge> : null}
            <Badge tone={run.status === "running" ? "live" : run.status === "error" ? "err" : run.status === "stopped" ? "warn" : "ok"}>{run.status}</Badge>
          </>
        }
        bodyClassName="p-3 grid gap-3"
      >
        <p className="text-[12px] text-muted leading-snug">
          The scan's facts are the agent's starting point. Each tool node is a real read of this repository at the analysed commit; secrets are redacted before the agent sees them, and the Evidence Check node is code verifying every file and line the answer cites.
          {v.agent?.mock ? " The offline planner chooses its steps by rule, so its decisions are labelled a simulation." : " The model's private reasoning is never shown; planning nodes mark the time a request was in flight."}
        </p>
        <div className="grid gap-3 min-w-0 @container">
          <div className="grid gap-3 min-w-0 @4xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <AgentGraph run={run} note="Every tool node is a real read of the repository." />
            </div>
            <div className="relative min-w-0">
              <div className="flex flex-col overflow-hidden rounded-lg border border-line surface-1 max-h-[360px] @4xl:absolute @4xl:inset-0 @4xl:max-h-none">
                <p className="label-caps px-3 h-9 flex items-center border-b border-line shrink-0">
                  Execution timeline
                  <span className="ml-auto mono text-[10px] text-muted">
                    {run.cursor}/{run.log.length}
                  </span>
                </p>
                <AgentTimeline run={run} follow className="flex-1 min-h-0 overflow-y-auto panel-scroll" />
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-line pt-3">
          <AgentPlaybackControls
            run={run}
            idleHint="ask a question to start"
            onReset={() => {
              agentRuntime.discard(run.id);
              setInvestigation(null);
            }}
          />
        </div>
      </GlassPanel>
      <div className="grid gap-4 min-w-0 @container">
        <div className="grid gap-4 min-w-0 @4xl:grid-cols-2">
          <AgentInspectorPanel run={run} title="Agent step inspector" className="h-[min(46vh,380px)]" />
          <AgentStepPanel run={run} className="h-[min(46vh,380px)]" />
        </div>
      </div>
    </div>
  );
}
