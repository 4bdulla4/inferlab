import { memo, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { RunState, TimelineEntry } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { formatDelta, formatTime } from "@/lib/format";
import { useUIStore } from "@/store/uiStore";
import { SourceDot } from "@/components/layout/SourceBadge";
import { GlassPanel } from "@/components/layout/GlassPanel";

/**
 * The ordered event log. `bare` drops the panel chrome so the list can sit
 * inside another frame, such as beside the pipeline diagram; `follow` keeps the
 * newest entry in view unless the reader has scrolled back to look at something.
 */
export function ExecutionTimeline({
  run, className, bare, follow,
}: {
  run: RunState | undefined;
  className?: string;
  bare?: boolean;
  follow?: boolean;
}) {
  const selectedStage = useUIStore((s) => s.selectedStage);
  const selectStage = useUIStore((s) => s.selectStage);
  const timeline = run?.visual.timeline ?? [];
  const start = run?.visual.timeline[0]?.startedAt ?? run?.createdAt ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  const onSelect = useCallback((stage: TimelineEntry["stage"]) => selectStage(stage), [selectStage]);

  // Stay pinned to the live edge, but yield the moment someone scrolls up.
  useEffect(() => {
    if (!follow) return;
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [follow, timeline.length, run?.cursor]);

  const body = (
    <>
      {timeline.length === 0 ? (
        <p className="p-4 mono text-[11px] text-muted">No execution yet. Events appear here as the pipeline runs; click one to focus its node.</p>
      ) : (
        <ol className="divide-y divide-line" aria-label="Execution events">
          {timeline.map((entry) => (
            <TimelineRow
              key={entry.id}
              entry={entry}
              start={start}
              selected={selectedStage === entry.stage}
              onSelect={onSelect}
            />
          ))}
          {run && !run.liveDone && run.cursor >= run.log.length ? (
            <li className="px-4 py-2 mono text-[11px] text-live flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> waiting for provider…
            </li>
          ) : null}
        </ol>
      )}
    </>
  );

  if (bare) {
    return (
      <div ref={scroller} className={className} aria-label="Execution timeline">
        {body}
      </div>
    );
  }

  return (
    <GlassPanel
      title="Execution timeline"
      subtitle={run ? `${timeline.length} stages · ${run.cursor}/${run.log.length} events` : undefined}
      className={className}
      bodyClassName="p-0 overflow-y-auto panel-scroll"
    >
      {body}
    </GlassPanel>
  );
}

/** One row per stage; memoized so a 150-event run does not redraw the whole log. */
const TimelineRow = memo(function TimelineRow({ entry, start, selected, onSelect }: { entry: TimelineEntry; start: number; selected: boolean; onSelect: (stage: TimelineEntry["stage"]) => void }) {
  const Icon = entry.status === "error" ? AlertTriangle : entry.status === "completed" ? CheckCircle2 : Loader2;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry.stage)}
        aria-pressed={selected}
        className={cn("w-full text-left px-4 py-2 grid grid-cols-[16px_1fr_auto] items-center gap-x-3 hover:surface-1", selected && "surface-2")}
      >
        <Icon
          aria-label={entry.status}
          className={cn(
            "size-3.5",
            entry.status === "error" ? "text-err" : entry.status === "completed" ? "text-ok" : "text-warn animate-spin",
          )}
        />
        <span className="min-w-0 flex items-center gap-2">
          <span className="text-[12.5px] text-ink truncate">{entry.label}</span>
          <SourceDot source={entry.source} />
          {entry.count > 1 ? <span className="mono text-[10px] text-muted">×{entry.count}</span> : null}
        </span>
        <span className="mono text-[10.5px] text-muted text-right leading-tight">
          <span className="block">+{formatDelta(start, entry.startedAt)}</span>
          <span className="block text-faint">
            {entry.source === "simulation" ? "conceptual" : entry.endedAt ? formatDelta(entry.startedAt, entry.endedAt) : formatTime(entry.startedAt)}
          </span>
        </span>
      </button>
    </li>
  );
});
