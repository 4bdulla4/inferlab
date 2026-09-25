import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ChevronDown, FolderSearch, PanelRightClose, PanelRightOpen } from "lucide-react";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useScrollOnRun } from "@/hooks/useScrollOnRun";
import { cn } from "@/lib/cn";
import { selectActiveAgentRun, useAgentStore } from "@/store/agentStore";
import { useRagStore } from "@/store/ragStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AgentApprovalBar } from "@/components/agent/AgentApprovalBar";
import { AgentCodeAnalyzer } from "@/components/agent/AgentCodeAnalyzer";
import { AgentComposer } from "@/components/agent/AgentComposer";
import { AgentConfigDrawer } from "@/components/agent/AgentConfigDrawer";
import { AgentGraph } from "@/components/agent/AgentGraph";
import { AgentInspectorPanel, AgentStatePanel, AgentStepPanel } from "@/components/agent/AgentInspector";
import { AgentPlaybackControls } from "@/components/agent/AgentPlaybackControls";
import { AgentResponsePanel } from "@/components/agent/AgentResponsePanel";
import { AgentTimeline } from "@/components/agent/AgentTimeline";
import type { NodeState } from "@/types/execution";

const STATES: NodeState[] = ["idle", "queued", "active", "processing", "completed", "error"];

/**
 * The Agent Engineering lab. A goal and its settings lead the page; the stage
 * follows with three panels (what the step is, what went in and out, and the
 * agent's whole state), then the graph that grows as the agent works, with the
 * event log beside it and playback beneath. The answer surfaces at the end.
 */
export function AgentLab() {
  const run = useAgentStore(selectActiveAgentRun);
  const selectNode = useAgentStore((s) => s.selectNode);
  const configOpen = useAgentStore((s) => s.configOpen);
  const codeAnalyzerOpen = useAgentStore((s) => s.codeAnalyzerOpen);
  const setCodeAnalyzerOpen = useAgentStore((s) => s.setCodeAnalyzerOpen);
  const codeReport = useAgentStore((s) => s.codeReport.result);
  const setConfigOpen = useAgentStore((s) => s.setConfigOpen);
  const config = useAgentStore((s) => s.config);
  const kb = useRagStore((s) => s.kb);
  const legendOpen = useUIStore((s) => s.legendOpen);
  const setLegendOpen = useUIStore((s) => s.setLegendOpen);
  const timelineOpen = useUIStore((s) => s.timelineOpen);
  const setTimelineOpen = useUIStore((s) => s.setTimelineOpen);
  const reduced = useReducedMotion();
  const stageRef = useScrollOnRun<HTMLDivElement>(run?.id);

  useEffect(() => {
    void agentRuntime.refreshStatus(config.ragKbId);
    void agentRuntime.refreshWorkspace();
  }, [config.ragKbId, kb?.chunks.length, kb?.stale]);

  // A knowledge base that vanished (expired, or a fresh session) must not stay attached.
  useEffect(() => {
    if (config.ragKbId && kb && kb.id !== config.ragKbId) useAgentStore.getState().setConfig({ ragKbId: null });
  }, [config.ragKbId, kb]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.key === "Escape") selectNode(null);
      if (!run) return;
      if (e.key === " ") {
        e.preventDefault();
        agentRuntime.toggle(run.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        agentRuntime.step(run.id);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        agentRuntime.replay(run.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run, selectNode]);

  const v = run?.visual;
  const answering = Boolean(v && (v.finalText || v.final || v.completion || v.error || v.stopped));

  return (
    <div className="@container mx-auto max-w-[1720px] p-4 grid gap-4 content-start">
      <AgentComposer onOpenSettings={() => setConfigOpen(true)} />
      <AgentConfigDrawer open={configOpen} onClose={() => setConfigOpen(false)} />

      {/* Bring your own backend: a report on how existing code processes a request. */}
      {codeAnalyzerOpen || codeReport ? (
        <AgentCodeAnalyzer />
      ) : (
        <button type="button" onClick={() => setCodeAnalyzerOpen(true)} className="glass rounded-xl px-4 h-11 flex items-center gap-2 text-left hover:border-line-strong">
          <FolderSearch className="size-4 text-accent-soft" aria-hidden="true" />
          <span className="label-caps text-ink-dim">Have your own agent?</span>
          <span className="text-[12px] text-muted truncate">Upload its backend code or a GitHub repo and get a report on how it processes a request.</span>
          <ChevronDown className="ml-auto size-4 text-muted" aria-hidden="true" />
        </button>
      )}

      {/* The stage: what a run lights up, scrolled to when one begins. */}
      <div ref={stageRef} className="scroll-mt-20 grid gap-4 min-w-0">
        <AnimatePresence initial={false}>
          {run ? (
            <motion.div key="inspectors" initial={reduced ? false : { opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }} className="min-w-0">
              <div className="grid gap-4 min-w-0 @4xl:grid-cols-2 @6xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] items-stretch">
                <AgentInspectorPanel run={run} className="h-[min(46vh,400px)]" />
                <AgentStepPanel run={run} className="h-[min(46vh,400px)]" />
                <AgentStatePanel run={run} className="h-[min(46vh,400px)] @4xl:col-span-2 @6xl:col-span-1" />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AgentApprovalBar run={run} />

        <motion.div initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: run ? 1 : 0.6, y: 0 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }} className="min-w-0">
          <GlassPanel
            title="Live agent graph"
            subtitle={run ? `${run.goal.slice(0, 80)}${run.goal.length > 80 ? "…" : ""}` : "set a goal and press RUN"}
            actions={
              <>
                <SourceBadge source="live" compact />
                <SourceBadge source="simulation" compact />
                {run ? <Badge tone={run.status === "running" ? "live" : run.status === "error" ? "err" : run.status === "stopped" ? "warn" : "ok"}>{run.status}</Badge> : null}
                <Button size="sm" variant="ghost" icon={<BookOpen />} onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}>
                  Legend
                </Button>
                <Button size="sm" variant="ghost" icon={timelineOpen ? <PanelRightClose /> : <PanelRightOpen />} onClick={() => setTimelineOpen(!timelineOpen)} aria-expanded={timelineOpen}>
                  Timeline
                </Button>
              </>
            }
            bodyClassName="p-3 grid gap-3"
          >
            {legendOpen ? (
              <div className="rounded-lg border border-line surface-1 p-3">
                <AgentLegend />
              </div>
            ) : null}
            <div className={cn("grid gap-3 min-w-0", timelineOpen && "@4xl:grid-cols-[minmax(0,1fr)_320px]")}>
              <div className="min-w-0">
                <AgentGraph run={run} dimmed={!run} />
              </div>
              {timelineOpen ? (
                <div className="relative min-w-0">
                  <div className="flex flex-col overflow-hidden rounded-lg border border-line surface-1 max-h-[380px] @4xl:absolute @4xl:inset-0 @4xl:max-h-none">
                    <p className="label-caps px-3 h-9 flex items-center border-b border-line shrink-0">
                      Execution timeline
                      {run ? (
                        <span className="ml-auto mono text-[10px] text-muted">
                          {run.cursor}/{run.log.length}
                        </span>
                      ) : null}
                    </p>
                    <AgentTimeline run={run} follow className="flex-1 min-h-0 overflow-y-auto panel-scroll" />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="border-t border-line pt-3">
              <AgentPlaybackControls run={run} />
            </div>
          </GlassPanel>
        </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {answering ? (
          <motion.div key="answer" initial={reduced ? false : { opacity: 0, y: 26, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 28 }} className="min-w-0 rounded-xl shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent),0_18px_50px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]">
            <AgentResponsePanel run={run} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** What the marks on the graph mean, in this lab's terms. */
function AgentLegend() {
  return (
    <div className="grid gap-4 text-[12px]">
      <div>
        <p className="label-caps mb-2">Data source</p>
        <ul className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
          <li className="contents">
            <SourceBadge source="live" className="mt-px" />
            <span className="text-ink-dim leading-snug min-w-0">Observed: real model requests and responses, real tool executions (network, code, database, files, memory), real human decisions, real timings and token usage.</span>
          </li>
          <li className="contents">
            <SourceBadge source="simulation" className="mt-px" />
            <span className="text-ink-dim leading-snug min-w-0">Stand-ins: the offline planner's decisions, the injected failures of the flaky service, and tools with no real backend (external service, custom tools). The model's private reasoning is never shown or invented.</span>
          </li>
        </ul>
      </div>
      <div>
        <p className="label-caps mb-2">Node states</p>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 min-w-0">
          {STATES.map((s) => (
            <li key={s} className="flex items-center gap-2 text-ink-dim">
              <span className="text-[14px] inline-flex">
                <StatusIcon state={s} spin={false} />
              </span>
              {NODE_STATE_LABEL[s]}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="label-caps mb-2">Edges and shapes</p>
        <ul className="grid gap-1 text-ink-dim">
          <li>Solid arrows follow execution. A decision fanning out to several tools means they ran in parallel.</li>
          <li>Dashed arrows mark a fallback: the tool before them failed every attempt.</li>
          <li>Dashed borders mark a step waiting on a person: an approval gate or a question for you.</li>
        </ul>
      </div>
      <div>
        <p className="label-caps mb-2">Keyboard</p>
        <ul className="grid gap-1 text-ink-dim mono text-[11px]">
          <li>
            <kbd className="px-1 border border-line rounded">Space</kbd> play / pause · <kbd className="px-1 border border-line rounded">→</kbd> step · <kbd className="px-1 border border-line rounded">R</kbd> replay · <kbd className="px-1 border border-line rounded">Esc</kbd> follow again
          </li>
          <li>
            <kbd className="px-1 border border-line rounded">Tab</kbd> / arrow keys move between nodes · <kbd className="px-1 border border-line rounded">Enter</kbd> inspect
          </li>
        </ul>
      </div>
    </div>
  );
}
