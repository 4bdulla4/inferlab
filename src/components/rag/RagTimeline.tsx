import { memo, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { RagRunState, RagTimelineEntry } from "@/labs/rag/state";
import type { RagStageId } from "@/labs/rag/stages";
import { cn } from "@/lib/cn";
import { formatDelta, formatTime } from "@/lib/format";
import { useRagStore } from "@/store/ragStore";
import { SourceDot } from "@/components/layout/SourceBadge";

/** The ordered event log for a RAG run; `follow` keeps the newest entry in view unless the reader scrolled up. */
export function RagTimeline({ run, className, follow }: { run: RagRunState | undefined; className?: string; follow?: boolean }) {
  const selectedStage = useRagStore((s) => s.selectedStage);
  const selectStage = useRagStore((s) => s.selectStage);
  const timeline = run?.visual.timeline ?? [];
  const start = timeline[0]?.startedAt ?? run?.createdAt ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  const onSelect = useCallback((stage: RagStageId) => selectStage(stage), [selectStage]);

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
        <p className="p-4 mono text-[11px] text-muted">No execution yet. Add a document or ask a question and every step appears here; click one to inspect its stage.</p>
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

const Row = memo(function Row({ entry, start, selected, onSelect }: { entry: RagTimelineEntry; start: number; selected: boolean; onSelect: (stage: RagStageId) => void }) {
  const Icon = entry.status === "error" ? AlertTriangle : entry.status === "completed" ? CheckCircle2 : Loader2;
  return (
    <li>
      <button type="button" onClick={() => onSelect(entry.stage)} aria-pressed={selected} className={cn("w-full text-left px-4 py-2 grid grid-cols-[16px_1fr_auto] items-center gap-x-3 hover:surface-1", selected && "surface-2")}>
        <Icon aria-label={entry.status} className={cn("size-3.5", entry.status === "error" ? "text-err" : entry.status === "completed" ? "text-ok" : "text-warn animate-spin")} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink truncate">
            {entry.label}
            <SourceDot source={entry.source} />
            {entry.count > 1 ? <span className="mono text-[10px] text-faint">×{entry.count}</span> : null}
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
