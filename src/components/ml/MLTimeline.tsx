import { memo, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { MLRunState, MLTimelineEntry } from "@/labs/ml/state";
import type { MLStageId } from "@/labs/ml/stages";
import { cn } from "@/lib/cn";
import { formatDelta, formatTime } from "@/lib/format";
import { useMLStore } from "@/store/mlStore";
import { SourceDot } from "@/components/layout/SourceBadge";

/** The ordered event log for a training run; loop stages fold into one row each with a count. */
export function MLTimeline({ run, className, follow }: { run: MLRunState | undefined; className?: string; follow?: boolean }) {
  const selectedStage = useMLStore((s) => s.selectedStage);
  const selectStage = useMLStore((s) => s.selectStage);
  const timeline = run?.visual.timeline ?? [];
  const start = timeline[0]?.startedAt ?? run?.createdAt ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  const onSelect = useCallback((stage: MLStageId) => selectStage(stage), [selectStage]);

  useEffect(() => {
    if (!follow) return;
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [follow, timeline.length, run?.cursor]);

  return (
    <div ref={scroller} className={className} aria-label="Execution timeline">
      {timeline.length === 0 ? (
        <p className="p-4 mono text-[11px] text-muted">No training yet. Pick a dataset and press RUN; every step appears here and clicking one inspects its stage.</p>
      ) : (
        <ol className="divide-y divide-line" aria-label="Execution events">
          {timeline.map((entry) => (
            <Row key={entry.id} entry={entry} start={start} selected={selectedStage === entry.stage} onSelect={onSelect} />
          ))}
          {run && !run.liveDone && run.cursor >= run.log.length ? (
            <li className="px-4 py-2 mono text-[11px] text-live flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> waiting for the server…
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

const Row = memo(function Row({ entry, start, selected, onSelect }: { entry: MLTimelineEntry; start: number; selected: boolean; onSelect: (stage: MLStageId) => void }) {
  const Icon = entry.status === "error" ? AlertTriangle : entry.status === "completed" ? CheckCircle2 : Loader2;
  return (
    <li>
      <button type="button" onClick={() => onSelect(entry.stage)} aria-pressed={selected} className={cn("w-full text-left px-4 py-2 grid grid-cols-[16px_1fr_auto] items-center gap-x-3 hover:surface-1", selected && "surface-2")}>
        <Icon aria-label={entry.status} className={cn("size-3.5", entry.status === "error" ? "text-err" : entry.status === "completed" ? "text-ok" : "text-warn animate-spin")} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink truncate">
            {entry.label}
            <SourceDot source={entry.source} />
            {entry.count > 1 ? <span className="mono text-[10px] text-faint">×{entry.count.toLocaleString()}</span> : null}
          </span>
        </span>
        <span className="mono text-[10px] text-right leading-tight text-muted">
          <span className="block">+{formatDelta(start, entry.startedAt)}</span>
          <span className="block text-faint">{entry.endedAt ? formatDelta(entry.startedAt, entry.endedAt) : formatTime(entry.startedAt)}</span>
        </span>
      </button>
    </li>
  );
});
