import type { ExecutionEvent } from "@/types/execution";
import { PlaybackController, type PlaybackHost } from "@/engine/execution/PlaybackController";
import { useRepoStore } from "@/store/repoStore";
import { useUIStore } from "@/store/uiStore";

/**
 * Drives step-by-step animation of a code-path trace with the same
 * PlaybackController the LLM lab uses. Each trace step becomes one execution
 * event; the cursor lives in the repo store.
 */
let controller: PlaybackController | null = null;
let currentTraceId: string | null = null;

const STEP_DURATION = 1700;

function eventsFor(traceId: string): ExecutionEvent[] {
  const trace = useRepoStore.getState().trace;
  if (!trace || trace.id !== traceId) return [];
  return trace.steps.map((s, i) => ({
    id: `${traceId}:${i}`,
    seq: i,
    type: "TRACE_STEP",
    timestamp: trace.createdAt,
    stage: s.nodeId ?? "unknown",
    status: "completed",
    source: s.kind === "verified" ? "live" : "simulation",
    duration: STEP_DURATION,
    label: s.title,
    data: s,
  }));
}

function ensureController(traceId: string): PlaybackController {
  if (controller && currentTraceId === traceId) return controller;
  controller?.dispose();
  currentTraceId = traceId;
  const host: PlaybackHost = {
    getLogLength: () => eventsFor(traceId).length,
    getCursor: () => useRepoStore.getState().traceCursor + 1,
    isLiveDone: () => true,
    getEvent: (i) => eventsFor(traceId)[i],
    applyNext: () => useRepoStore.getState().setTraceCursor(useRepoStore.getState().traceCursor + 1),
    resetVisual: () => useRepoStore.getState().setTraceCursor(-1),
    setPlaybackState: (s) => useRepoStore.getState().setTracePlaying(s === "playing"),
    getSpeed: () => useUIStore.getState().speed,
    onLogGrow: () => () => {},
  };
  controller = new PlaybackController(host, { onFinish: () => useRepoStore.getState().setTracePlaying(false) });
  return controller;
}

export const tracePlayer = {
  play(traceId: string): void {
    ensureController(traceId).play();
  },
  pause(traceId: string): void {
    ensureController(traceId).pause();
  },
  toggle(traceId: string): void {
    ensureController(traceId).toggle();
  },
  step(traceId: string): void {
    ensureController(traceId).step();
  },
  restart(traceId: string): void {
    ensureController(traceId).replay();
  },
  jumpTo(traceId: string, index: number): void {
    const c = ensureController(traceId);
    c.pause();
    useRepoStore.getState().setTraceCursor(index);
  },
  dispose(): void {
    controller?.dispose();
    controller = null;
    currentTraceId = null;
  },
};
