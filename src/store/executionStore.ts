import { create } from "zustand";
import type { PlaybackState, RunStatus } from "@/types/execution";
import type { AnyLLMEvent } from "@/labs/llm/events";
import { applyLLMEvent } from "@/labs/llm/reducer";
import { createVisualState, type RunState } from "@/labs/llm/state";

export interface ExecutionStoreState {
  runs: Record<string, RunState>;
  /** Run shown in the main pipeline. */
  activeRunId: string | null;
  /** Runs shown side-by-side in comparison mode. */
  comparisonRunIds: string[] | null;
  /** Monotonic counter to give runs stable ids. */
  runCounter: number;

  createRun: (run: RunState) => void;
  appendEvents: (runId: string, events: AnyLLMEvent[]) => void;
  applyNext: (runId: string) => void;
  resetVisual: (runId: string) => void;
  setPlayback: (runId: string, state: PlaybackState) => void;
  setRunStatus: (runId: string, status: RunStatus, liveDone: boolean) => void;
  setActiveRun: (runId: string | null) => void;
  setComparison: (runIds: string[] | null) => void;
  removeRun: (runId: string) => void;
  clearRuns: () => void;
}

export const useExecutionStore = create<ExecutionStoreState>((set) => ({
  runs: {},
  activeRunId: null,
  comparisonRunIds: null,
  runCounter: 0,

  createRun: (run) =>
    set((s) => ({ runs: { ...s.runs, [run.id]: run }, runCounter: s.runCounter + 1 })),

  appendEvents: (runId, events) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run || events.length === 0) return s;
      return { runs: { ...s.runs, [runId]: { ...run, log: [...run.log, ...events] } } };
    }),

  applyNext: (runId) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      const event = run.log[run.cursor];
      if (!event) return s;
      return {
        runs: {
          ...s.runs,
          [runId]: { ...run, cursor: run.cursor + 1, visual: applyLLMEvent(run.visual, event) },
        },
      };
    }),

  resetVisual: (runId) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return { runs: { ...s.runs, [runId]: { ...run, cursor: 0, visual: createVisualState(run.input.length) } } };
    }),

  setPlayback: (runId, state) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run || run.playback === state) return s;
      return { runs: { ...s.runs, [runId]: { ...run, playback: state } } };
    }),

  setRunStatus: (runId, status, liveDone) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return { runs: { ...s.runs, [runId]: { ...run, status, liveDone } } };
    }),

  setActiveRun: (runId) => set({ activeRunId: runId }),

  setComparison: (runIds) => set({ comparisonRunIds: runIds }),

  removeRun: (runId) =>
    set((s) => {
      const { [runId]: _removed, ...rest } = s.runs;
      void _removed;
      return {
        runs: rest,
        activeRunId: s.activeRunId === runId ? null : s.activeRunId,
        comparisonRunIds: s.comparisonRunIds?.filter((id) => id !== runId) ?? null,
      };
    }),

  clearRuns: () => set({ runs: {}, activeRunId: null, comparisonRunIds: null }),
}));

export const selectActiveRun = (s: ExecutionStoreState): RunState | undefined =>
  s.activeRunId ? s.runs[s.activeRunId] : undefined;

export const selectRun = (runId: string | null | undefined) => (s: ExecutionStoreState): RunState | undefined =>
  runId ? s.runs[runId] : undefined;
