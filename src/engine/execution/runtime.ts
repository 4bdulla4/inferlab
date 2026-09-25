import type { GenerationSettings, ProviderDescriptor } from "@shared/llm";
import type { AnyLLMEvent } from "@/labs/llm/events";
import { createRun } from "@/labs/llm/state";
import { useExecutionStore } from "@/store/executionStore";
import { useUIStore } from "@/store/uiStore";
import { EventBus } from "../events/EventBus";
import { ExecutionEngine } from "./ExecutionEngine";
import { PlaybackController, type PlaybackHost } from "./PlaybackController";

interface RunHandle {
  engine: ExecutionEngine;
  controller: PlaybackController<AnyLLMEvent>;
  bus: EventBus<AnyLLMEvent>;
}

/**
 * Non-serializable runtime objects (engines, timers) live here, outside the
 * store. The store only holds data; this module holds behaviour.
 */
const handles = new Map<string, RunHandle>();

function createHost(runId: string): PlaybackHost<AnyLLMEvent> {
  const store = useExecutionStore;
  return {
    getLogLength: () => store.getState().runs[runId]?.log.length ?? 0,
    getCursor: () => store.getState().runs[runId]?.cursor ?? 0,
    isLiveDone: () => store.getState().runs[runId]?.liveDone ?? true,
    getEvent: (i) => store.getState().runs[runId]?.log[i],
    applyNext: () => store.getState().applyNext(runId),
    resetVisual: () => store.getState().resetVisual(runId),
    setPlaybackState: (s) => store.getState().setPlayback(runId, s),
    getSpeed: () => useUIStore.getState().speed,
    onLogGrow: (listener) =>
      store.subscribe((state, prev) => {
        const a = state.runs[runId];
        const b = prev.runs[runId];
        if (!a) return;
        if (a.log.length !== (b?.log.length ?? 0) || a.liveDone !== (b?.liveDone ?? false)) listener();
      }),
  };
}

function nextRunId(): string {
  const n = useExecutionStore.getState().runCounter + 1;
  return `run-${n}-${Date.now().toString(36)}`;
}

function launch(provider: ProviderDescriptor, input: string, settings: GenerationSettings): string {
  const store = useExecutionStore.getState();
  const runId = nextRunId();
  store.createRun(createRun({ id: runId, provider, input, settings }));

  const bus = new EventBus<AnyLLMEvent>();
  bus.on("*", (event) => useExecutionStore.getState().appendEvents(runId, [event]));

  const controller = new PlaybackController<AnyLLMEvent>(createHost(runId));
  const engine = new ExecutionEngine({
    runId,
    provider,
    input,
    settings,
    bus,
    onLiveDone: (status) => useExecutionStore.getState().setRunStatus(runId, status, true),
  });

  handles.set(runId, { engine, controller, bus });
  engine.start();
  controller.play();
  return runId;
}

export const runtime = {
  /** Start a single run and make it the active one. */
  startRun(provider: ProviderDescriptor, input: string, settings: GenerationSettings): string {
    this.resetAll();
    const id = launch(provider, input, settings);
    useExecutionStore.getState().setActiveRun(id);
    return id;
  },

  /** Start one run per provider and show them side by side. */
  startComparison(providers: ProviderDescriptor[], input: string, settings: GenerationSettings): string[] {
    this.resetAll();
    const ids = providers.map((p) => launch(p, input, settings));
    const store = useExecutionStore.getState();
    store.setComparison(ids);
    store.setActiveRun(ids[0] ?? null);
    return ids;
  },

  stopRun(runId: string): void {
    handles.get(runId)?.engine.stop();
  },

  stopAll(): void {
    for (const h of handles.values()) h.engine.stop();
  },

  play(runId: string): void {
    handles.get(runId)?.controller.play();
  },
  pause(runId: string): void {
    handles.get(runId)?.controller.pause();
  },
  toggle(runId: string): void {
    handles.get(runId)?.controller.toggle();
  },
  step(runId: string): void {
    handles.get(runId)?.controller.step();
  },
  replay(runId: string): void {
    handles.get(runId)?.controller.replay();
  },

  /** Re-run a finished/failed run with identical parameters. */
  retry(runId: string): string | null {
    const run = useExecutionStore.getState().runs[runId];
    if (!run) return null;
    return this.startRun(run.provider, run.input, run.settings);
  },

  /** Stop every engine, dispose controllers and clear the store. */
  resetAll(): void {
    for (const h of handles.values()) {
      h.engine.stop();
      h.controller.dispose();
      h.bus.clear();
    }
    handles.clear();
    useExecutionStore.getState().clearRuns();
  },

  isFinished(runId: string): boolean {
    return handles.get(runId)?.controller.isFinished() ?? true;
  },
};
