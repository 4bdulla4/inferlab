import { create } from "zustand";
import type { ExplainResult, KnowledgeBaseSnapshot, RagServiceStatus, RagSettings } from "@shared/rag";
import { DEFAULT_RAG_SETTINGS } from "@shared/rag";
import type { PlaybackState, RunStatus } from "@/types/execution";
import type { AnyRagEvent } from "@/labs/rag/events";
import { applyRagEvent } from "@/labs/rag/reducer";
import type { RagStageId } from "@/labs/rag/stages";
import { createRagVisualState, type RagRunState } from "@/labs/rag/state";

export type KbStatus = "idle" | "loading" | "ready" | "error";

export interface RagStoreState {
  kb: KnowledgeBaseSnapshot | null;
  kbStatus: KbStatus;
  kbError: string | null;
  service: RagServiceStatus | null;
  /** Editable copy of the knowledge base settings; saved to the server on change. */
  settings: RagSettings;
  question: string;

  runs: Record<string, RagRunState>;
  runCounter: number;
  /** Run shown on the stage. */
  activeRunId: string | null;
  /** Two query runs shown side by side. */
  comparisonRunIds: string[] | null;
  /** True while a document is being added or the index rebuilt. */
  ingesting: boolean;

  selectedStage: RagStageId | null;
  selectedChunkId: string | null;
  explain: { loading: boolean; question: string; result: ExplainResult | null; error: string | null };

  setKb: (kb: KnowledgeBaseSnapshot | null) => void;
  setKbStatus: (status: KbStatus, error?: string | null) => void;
  setService: (service: RagServiceStatus | null) => void;
  setSettings: (partial: Partial<RagSettings>) => void;
  setQuestion: (question: string) => void;

  createRun: (run: RagRunState) => void;
  appendEvents: (runId: string, events: AnyRagEvent[]) => void;
  applyNext: (runId: string) => void;
  resetVisual: (runId: string) => void;
  setPlayback: (runId: string, state: PlaybackState) => void;
  setRunStatus: (runId: string, status: RunStatus, liveDone: boolean) => void;
  setActiveRun: (runId: string | null) => void;
  setComparison: (runIds: string[] | null) => void;
  clearRuns: () => void;
  setIngesting: (ingesting: boolean) => void;

  selectStage: (stage: RagStageId | null) => void;
  selectChunk: (chunkId: string | null) => void;
  setExplain: (partial: Partial<RagStoreState["explain"]>) => void;
}

export const useRagStore = create<RagStoreState>((set) => ({
  kb: null,
  kbStatus: "idle",
  kbError: null,
  service: null,
  settings: { ...DEFAULT_RAG_SETTINGS },
  question: "",

  runs: {},
  runCounter: 0,
  activeRunId: null,
  comparisonRunIds: null,
  ingesting: false,

  selectedStage: null,
  selectedChunkId: null,
  explain: { loading: false, question: "", result: null, error: null },

  setKb: (kb) => set(kb ? { kb, settings: kb.settings, kbStatus: "ready", kbError: null } : { kb: null }),
  setKbStatus: (kbStatus, error = null) => set({ kbStatus, kbError: error }),
  setService: (service) => set({ service }),
  setSettings: (partial) => set((s) => ({ settings: { ...s.settings, ...partial } })),
  setQuestion: (question) => set({ question }),

  createRun: (run) => set((s) => ({ runs: { ...s.runs, [run.id]: run }, runCounter: s.runCounter + 1 })),

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
      return { runs: { ...s.runs, [runId]: { ...run, cursor: run.cursor + 1, visual: applyRagEvent(run.visual, event) } } };
    }),

  resetVisual: (runId) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return { runs: { ...s.runs, [runId]: { ...run, cursor: 0, visual: createRagVisualState(run.kbSnapshot) } } };
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

  setActiveRun: (activeRunId) => set({ activeRunId }),
  setComparison: (comparisonRunIds) => set({ comparisonRunIds }),
  clearRuns: () => set({ runs: {}, activeRunId: null, comparisonRunIds: null, selectedStage: null, selectedChunkId: null }),
  setIngesting: (ingesting) => set({ ingesting }),

  selectStage: (selectedStage) => set({ selectedStage }),
  selectChunk: (selectedChunkId) => set({ selectedChunkId }),
  setExplain: (partial) => set((s) => ({ explain: { ...s.explain, ...partial } })),
}));

export const selectActiveRagRun = (s: RagStoreState): RagRunState | undefined => (s.activeRunId ? s.runs[s.activeRunId] : undefined);

/** The most recent query run, whether or not it is the one on the stage. */
export const selectLatestQueryRun = (s: RagStoreState): RagRunState | undefined =>
  Object.values(s.runs)
    .filter((r) => r.kind === "query")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
