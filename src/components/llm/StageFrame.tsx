import { BookOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { motion } from "motion/react";
import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Legend } from "@/components/layout/Legend";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Button } from "@/components/ui/Button";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { Pipeline } from "./Pipeline";
import { PlaybackControls } from "./PlaybackControls";

/**
 * The stage: the diagram and the event log live in one frame so the drawing and
 * the evidence for it are read together, with playback across the bottom.
 */
export function StageFrame({
  run, onNewRun, reduced, dimmed,
}: {
  run: RunState | undefined;
  onNewRun: () => void;
  reduced: boolean;
  /** Idle preview before anything has run. */
  dimmed?: boolean;
}) {
  const legendOpen = useUIStore((s) => s.legendOpen);
  const setLegendOpen = useUIStore((s) => s.setLegendOpen);
  const timelineOpen = useUIStore((s) => s.timelineOpen);
  const setTimelineOpen = useUIStore((s) => s.setTimelineOpen);

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: dimmed ? 0.55 : 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
      className="min-w-0"
    >
      <GlassPanel
        title="Live LLM pipeline"
        subtitle={run ? run.provider.name : "press RUN to execute"}
        actions={
          <>
            <SourceBadge source="live" compact />
            <SourceBadge source="simulation" compact />
            <Button size="sm" variant="ghost" icon={<BookOpen />} onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}>
              Legend
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={timelineOpen ? <PanelRightClose /> : <PanelRightOpen />}
              onClick={() => setTimelineOpen(!timelineOpen)}
              aria-expanded={timelineOpen}
              title={timelineOpen ? "Hide the event log" : "Show the event log"}
            >
              Timeline
            </Button>
          </>
        }
        bodyClassName="p-3 grid gap-3"
      >
        {legendOpen ? (
          <div className="rounded-lg border border-line surface-1 p-3">
            <Legend />
          </div>
        ) : null}

        <div className={cn("grid gap-3 min-w-0", timelineOpen && "@4xl:grid-cols-[minmax(0,1fr)_320px]")}>
          <div className="min-w-0">
            <Pipeline run={run} />
          </div>
          {timelineOpen ? (
            // The log never sets the frame's height: beside the diagram it fills
            // the cell the diagram sized and scrolls, and stacked below it is
            // capped. Either way the stage stays as tall as the drawing.
            <div className="relative min-w-0">
              <div className="flex flex-col overflow-hidden rounded-lg border border-line surface-1 max-h-[380px] @4xl:absolute @4xl:inset-0 @4xl:max-h-none">
                <p className="label-caps px-3 h-9 flex items-center border-b border-line shrink-0">
                  Execution timeline
                  {run ? <span className="ml-auto mono text-[10px] text-muted">{run.cursor}/{run.log.length}</span> : null}
                </p>
                <ExecutionTimeline run={run} bare follow className="flex-1 min-h-0 overflow-y-auto panel-scroll" />
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-line pt-3">
          <PlaybackControls run={run} onNewRun={onNewRun} />
        </div>
      </GlassPanel>
    </motion.div>
  );
}
