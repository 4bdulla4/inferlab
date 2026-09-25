import { memo, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { AgentRunState, AgentTimelineEntry } from "@/labs/agent/state";
import { cn } from "@/lib/cn";
import { formatDelta, formatTime } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";
import { SourceDot } from "@/components/layout/SourceBadge";

/** The ordered event log for an agent run; `follow` keeps the newest entry in view unless the reader scrolled up. */
export function AgentTimeline({ run, className, follow }: { run: AgentRunState | undefined; className?: string; follow?: boolean }) {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const selectNode = useAgentStore((s) => s.selectNode);
  const timeline = run?.visual.timeline ?? [];
  const start = timeline[0]?.startedAt ?? run?.createdAt ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  const onSelect = useCallback((nodeId: string) => selectNode(nodeId), [selectNode]);

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
        <p className="p-4 mono text-[11px] text-muted">No execution yet. Run an agent and every step appears here; click one to inspect it.</p>
      ) : (
        <ol className="divide-y divide-line" aria-label="Execution events">
          {timeline.map((entry) => (
            <Row key={entry.id} entry={entry} start={start} selected={selectedNodeId === entry.nodeId} onSelect={onSelect} />
          ))}
          {run && !run.liveDone && run.cursor >= run.log.length ? (
            <li className="px-4 py-2 mono text-[11px] text-live flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> {run.visual.pendingApproval ? "waiting for you…" : "waiting for the agent…"}
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

const Row = memo(function Row({ entry, start, selected, onSelect }: { entry: AgentTimelineEntry; start: number; selected: boolean; onSelect: (nodeId: string) => void }) {
  const Icon = entry.status === "error" ? AlertTriangle : entry.status === "completed" ? CheckCircle2 : Loader2;
  return (
    <li>
      <button type="button" onClick={() => onSelect(entry.nodeId)} aria-pressed={selected} className={cn("w-full text-left px-4 py-2 grid grid-cols-[16px_1fr_auto] items-center gap-x-3 hover:surface-1", selected && "surface-2")}>
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
