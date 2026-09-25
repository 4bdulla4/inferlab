import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import { mlRuntime } from "@/engine/ml/mlRuntime";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useScrollOnRun } from "@/hooks/useScrollOnRun";
import { cn } from "@/lib/cn";
import { selectActiveMLRun, useMLStore } from "@/store/mlStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MLCompare } from "@/components/ml/MLCompare";
import { MLDatasetPanel } from "@/components/ml/MLDatasetPanel";
import { MLInspectorPanel, MLVisualizationPanel } from "@/components/ml/MLInspector";
import { MLPipeline } from "@/components/ml/MLPipeline";
import { MLPlaybackControls } from "@/components/ml/MLPlaybackControls";
import { MLResultPanel } from "@/components/ml/MLResultPanel";
import { MLSettingsDrawer } from "@/components/ml/MLSettingsDrawer";
import { MLTimeline } from "@/components/ml/MLTimeline";
import { MLTrainPanel } from "@/components/ml/MLTrainPanel";
import type { NodeState } from "@/types/execution";

const STATES: NodeState[] = ["idle", "queued", "active", "processing", "completed", "error"];

/**
 * The ML Engineering lab. The dataset and the training form lead the page;
 * the stage follows: the inspector and the visualization of the step in view,
 * then the four-band pipeline with the event log and playback beneath. The
 * result, with a prediction form, surfaces at the end. Every number shown was
 * computed by the server on the real rows; the one labelled simplification is
 * a decision surface drawn on two features of a wider model.
 */
export function MLLab() {
  const run = useMLStore(selectActiveMLRun);
  const runs = useMLStore((s) => s.runs);
  const comparisonRunIds = useMLStore((s) => s.comparisonRunIds);
  const selectStage = useMLStore((s) => s.selectStage);
  const settingsOpen = useMLStore((s) => s.settingsOpen);
  const setSettingsOpen = useMLStore((s) => s.setSettingsOpen);
  const status = useMLStore((s) => s.status);
  const legendOpen = useUIStore((s) => s.legendOpen);
  const setLegendOpen = useUIStore((s) => s.setLegendOpen);
  const timelineOpen = useUIStore((s) => s.timelineOpen);
  const setTimelineOpen = useUIStore((s) => s.setTimelineOpen);
  const reduced = useReducedMotion();
  const stageRef = useScrollOnRun<HTMLDivElement>(run?.id);

  useEffect(() => {
    void mlRuntime.refreshStatus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.key === "Escape") selectStage(null);
      if (!run) return;
      if (e.key === " ") {
        e.preventDefault();
        mlRuntime.toggle(run.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        mlRuntime.step(run.id);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        mlRuntime.replay(run.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run, selectStage]);

  const comparisonRuns = comparisonRunIds?.map((id) => runs[id]).filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];
  const v = run?.visual;
  const resulting = Boolean(v && (v.validation || v.test || v.completion || v.error || v.stopped));

  return (
    <div className="@container mx-auto max-w-[1720px] p-4 grid gap-4 content-start">
      <div className="grid gap-4 min-w-0 @5xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-stretch">
        <MLDatasetPanel className="h-full" />
        <MLTrainPanel className="h-full" onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      {comparisonRuns.length > 1 ? <MLCompare runs={comparisonRuns} /> : null}

      {/* The stage: what a run lights up, scrolled to when one begins. */}
      <div ref={stageRef} className="scroll-mt-20 grid gap-4 min-w-0">
        <AnimatePresence initial={false}>
          {run ? (
            <motion.div key="inspectors" initial={reduced ? false : { opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }} className="min-w-0">
              {/*
                max-h rather than h: a stage like "saved model" has four lines
                to show, and a fixed height left most of the panel empty and
                pushed the pipeline below the fold. These now shrink to their
                content and only scroll once a rich stage (metrics, a tree)
                needs the room. items-stretch keeps the pair the same height.
              */}
              <div className="grid gap-4 min-w-0 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-stretch">
                <MLInspectorPanel run={run} className="min-h-[164px] max-h-[min(44vh,380px)]" />
                <MLVisualizationPanel run={run} className="min-h-[164px] max-h-[min(44vh,380px)]" />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <motion.div initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: run ? 1 : 0.6, y: 0 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }} className="min-w-0">
          <GlassPanel
            title="Live ML pipeline"
            subtitle={run ? run.label : "pick a dataset, a target and an algorithm, then press RUN"}
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
                <MLLegend />
              </div>
            ) : null}
            <div className={cn("grid gap-3 min-w-0", timelineOpen && "@4xl:grid-cols-[minmax(0,1fr)_320px]")}>
              <div className="min-w-0">
                <MLPipeline run={run} dimmed={!run} />
              </div>
              {timelineOpen ? (
                <div className="relative min-w-0">
                  <div className="flex flex-col overflow-hidden rounded-lg border border-line surface-1 max-h-[380px] @4xl:absolute @4xl:inset-0 @4xl:max-h-none">
                    <p className="label-caps px-3 h-9 flex items-center border-b border-line shrink-0">
                      Execution timeline
                      {run ? (
                        <span className="ml-auto mono text-[10px] text-muted">
                          {run.cursor.toLocaleString()}/{run.log.length.toLocaleString()}
                        </span>
                      ) : null}
                    </p>
                    <MLTimeline run={run} follow className="flex-1 min-h-0 overflow-y-auto panel-scroll" />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="border-t border-line pt-3">
              <MLPlaybackControls run={run} />
            </div>
          </GlassPanel>
        </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {resulting && comparisonRuns.length < 2 ? (
          <motion.div key="result" initial={reduced ? false : { opacity: 0, y: 26, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 28 }} className="min-w-0 rounded-xl shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent),0_18px_50px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]">
            <MLResultPanel run={run} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!run && status ? (
        <p className="mono text-[11px] text-faint flex items-center gap-2 justify-center py-1">
          <Sparkles className="size-3" aria-hidden="true" />
          Start with a sample table or drop your own CSV. Training happens on this machine; nothing leaves it, and uploads are gone two hours after you stop.
        </p>
      ) : null}

      <MLSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/** What the marks on the graph mean, in this lab's terms. */
function MLLegend() {
  return (
    <div className="grid gap-4 text-[12px]">
      <div>
        <p className="label-caps mb-2">Data source</p>
        <ul className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
          <li className="contents">
            <SourceBadge source="live" className="mt-px" />
            <span className="text-ink-dim leading-snug min-w-0">Real computation on your rows: every parsed value, statistic, fitted parameter, loss, gradient, weight update, tree split, neighbour distance, metric and prediction. Nothing is invented to look good.</span>
          </li>
          <li className="contents">
            <SourceBadge source="simulation" className="mt-px" />
            <span className="text-ink-dim leading-snug min-w-0">A labelled simplification: the 2-D decision surface when the model has more than two features (the others are held at their mean). The sample tables are synthetic, generated with a known recipe, and say so.</span>
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
          <li>Solid arrows follow execution. The dashed return edge under the training band is the loop: one pass per mini-batch (or per tree node, per query row, per class).</li>
          <li>Dimmed, dashed boxes are stages this algorithm never visits: trees have no gradients, KNN has no training loop, Naive Bayes fits in one pass.</li>
          <li>Long trainings draw every nth step; the count on the loop edge and the timeline's ×n show how many were computed.</li>
        </ul>
      </div>
      <div>
        <p className="label-caps mb-2">Keyboard</p>
        <ul className="grid gap-1 text-ink-dim mono text-[11px]">
          <li>
            <kbd className="px-1 border border-line rounded">Space</kbd> play / pause · <kbd className="px-1 border border-line rounded">→</kbd> step · <kbd className="px-1 border border-line rounded">R</kbd> replay · <kbd className="px-1 border border-line rounded">Esc</kbd> follow again
          </li>
          <li>
            <kbd className="px-1 border border-line rounded">Tab</kbd> / arrow keys move between stages · <kbd className="px-1 border border-line rounded">Enter</kbd> inspect
          </li>
        </ul>
      </div>
    </div>
  );
}
