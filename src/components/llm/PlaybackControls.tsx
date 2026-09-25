import { Pause, Play, RotateCcw, SkipForward, Sparkles, Square } from "lucide-react";
import { PLAYBACK_SPEEDS } from "@/types/execution";
import { runtime } from "@/engine/execution/runtime";
import type { RunState } from "@/labs/llm/state";
import { useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Badge } from "@/components/ui/Badge";

export function PlaybackControls({ run, onNewRun }: { run: RunState | undefined; onNewRun: () => void }) {
  const speed = useUIStore((s) => s.speed);
  const setSpeed = useUIStore((s) => s.setSpeed);
  const playing = run?.playback === "playing";
  const total = run?.log.length ?? 0;
  const cursor = run?.cursor ?? 0;
  const finished = run ? run.liveDone && cursor >= total : false;
  const waitingLive = run ? !run.liveDone && cursor >= total : false;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={playing ? "outline" : "live"}
          icon={playing ? <Pause /> : <Play />}
          disabled={!run || (finished && !playing)}
          onClick={() => run && runtime.toggle(run.id)}
          aria-label={playing ? "Pause playback" : "Play"}
          title="Space"
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <Button size="sm" icon={<SkipForward />} disabled={!run || cursor >= total} onClick={() => run && runtime.step(run.id)} title="→ · apply exactly one execution event">
          Step
        </Button>
        <Button size="sm" icon={<RotateCcw />} disabled={!run || cursor === 0} onClick={() => run && runtime.replay(run.id)} title="R · replay the same execution log">
          Replay
        </Button>
        {run && run.status === "running" ? (
          <Button size="sm" variant="danger" icon={<Square />} onClick={() => runtime.stopRun(run.id)} title="Abort the provider request">
            Stop
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={onNewRun} title="Clear this execution and start again">
          New run
        </Button>
      </div>

      <Segmented size="sm" ariaLabel="Playback speed" value={speed} onChange={setSpeed} options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} />

      <div className="ml-auto flex items-center gap-2 mono text-[11px] text-muted">
        {run ? (
          <>
            <span aria-live="polite">
              event <span className="text-ink-dim">{cursor}</span> / {total}
            </span>
            {waitingLive ? <Badge tone="live">waiting for provider…</Badge> : null}
            {run.status === "running" && !waitingLive ? <Badge tone="live">live</Badge> : null}
            {run.status === "completed" && !finished ? <Badge tone="sim">playback</Badge> : null}
            {finished ? <Badge tone="ok">done</Badge> : null}
          </>
        ) : (
          <span>press RUN to execute</span>
        )}
      </div>
    </div>
  );
}
