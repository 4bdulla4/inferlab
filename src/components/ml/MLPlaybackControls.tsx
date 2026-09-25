import { Pause, Play, RotateCcw, SkipForward, Square } from "lucide-react";
import { PLAYBACK_SPEEDS } from "@/types/execution";
import { mlRuntime } from "@/engine/ml/mlRuntime";
import type { MLRunState } from "@/labs/ml/state";
import { useUIStore } from "@/store/uiStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";

/** Play, pause, step and replay for a training run. Training on the server keeps going whatever playback does. */
export function MLPlaybackControls({ run }: { run: MLRunState | undefined }) {
  const speed = useUIStore((s) => s.speed);
  const setSpeed = useUIStore((s) => s.setSpeed);
  const playing = run?.playback === "playing";
  const total = run?.log.length ?? 0;
  const cursor = run?.cursor ?? 0;
  const finished = run ? run.liveDone && cursor >= total : false;
  const running = run?.status === "running";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={playing ? "outline" : "live"} icon={playing ? <Pause /> : <Play />} disabled={!run} onClick={() => run && mlRuntime.toggle(run.id)} title="Space">
        {playing ? "Pause" : finished ? "Play again" : "Play"}
      </Button>
      <Button size="sm" icon={<SkipForward />} disabled={!run || cursor >= total} onClick={() => run && mlRuntime.step(run.id)} title="→ · apply one event">
        Step
      </Button>
      <Button size="sm" icon={<RotateCcw />} disabled={!run || cursor === 0} onClick={() => run && mlRuntime.replay(run.id)} title="R · replay the same execution log">
        Replay
      </Button>
      {running ? (
        <Button size="sm" variant="danger" icon={<Square />} onClick={() => run && mlRuntime.stop(run.id)}>
          Stop
        </Button>
      ) : null}
      <Segmented size="sm" ariaLabel="Playback speed" value={speed} onChange={setSpeed} options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} className="ml-1" />
      <span className="ml-auto flex items-center gap-2 mono text-[10.5px] text-muted">
        {run ? (
          <>
            event <span className="text-ink">{cursor.toLocaleString()}</span> / {total.toLocaleString()}
            {run.liveDone ? <Badge tone={run.status === "error" ? "err" : run.status === "stopped" ? "warn" : "ok"}>{finished ? "done" : "playback"}</Badge> : <Badge tone="live">training</Badge>}
          </>
        ) : (
          "pick a dataset and press RUN"
        )}
      </span>
    </div>
  );
}
