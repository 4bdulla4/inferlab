import { create } from "zustand";
import type { AnalyzeEvent, RepoAnalysis, RepoServiceStatus, SummarizeResult, TraceResult } from "@shared/repo";

export type RepoStatus = "idle" | "analyzing" | "ready" | "error";

export interface RepoPhase {
  phase: string;
  detail: string;
  progress: number;
  at: number;
}

export interface RepoSelection {
  kind: "node" | "file" | "edge";
  id: string;
}

export interface RepoState {
  url: string;
  status: RepoStatus;
  phases: RepoPhase[];
  progress: number;
  error: string | null;
  analysis: RepoAnalysis | null;
  serviceStatus: RepoServiceStatus | null;
  selection: RepoSelection | null;
  hoveredNodeId: string | null;
  categoryFilter: Set<string> | null;

  summarizing: boolean;
  summarizeError: string | null;
  startSummarize: () => void;
  applySummaries: (result: SummarizeResult) => void;
  failSummarize: (message: string) => void;

  question: string;
  asking: boolean;
  askError: string | null;
  trace: TraceResult | null;
  traceHistory: TraceResult[];
  /** Index of the trace step currently highlighted (-1 = none). */
  traceCursor: number;
  tracePlaying: boolean;

  setUrl: (url: string) => void;
  setServiceStatus: (s: RepoServiceStatus | null) => void;
  startAnalysis: (url: string) => void;
  applyAnalyzeEvent: (e: AnalyzeEvent) => void;
  finishAnalysis: (analysis: RepoAnalysis) => void;
  failAnalysis: (message: string) => void;
  reset: () => void;
  select: (sel: RepoSelection | null) => void;
  setHovered: (id: string | null) => void;
  toggleCategory: (category: string) => void;
  clearCategoryFilter: () => void;

  setQuestion: (q: string) => void;
  startAsk: () => void;
  finishAsk: (trace: TraceResult) => void;
  failAsk: (message: string) => void;
  setTraceCursor: (i: number) => void;
  setTracePlaying: (playing: boolean) => void;
  showTrace: (trace: TraceResult) => void;
}

export const useRepoStore = create<RepoState>((set) => ({
  url: "https://github.com/vercel/ai-chatbot",
  status: "idle",
  phases: [],
  progress: 0,
  error: null,
  analysis: null,
  serviceStatus: null,
  selection: null,
  hoveredNodeId: null,
  categoryFilter: null,
  summarizing: false,
  summarizeError: null,
  startSummarize: () => set({ summarizing: true, summarizeError: null }),
  applySummaries: (result) =>
    set((s) => {
      if (!s.analysis) return { summarizing: false };
      const byId = new Map(result.nodes.map((n) => [n.id, n.aiSummary]));
      return {
        summarizing: false,
        analysis: {
          ...s.analysis,
          overview: result.overview,
          ai: result.ai,
          graph: { ...s.analysis.graph, nodes: s.analysis.graph.nodes.map((n) => (byId.has(n.id) ? { ...n, aiSummary: byId.get(n.id) } : n)) },
        },
      };
    }),
  failSummarize: (message) => set({ summarizing: false, summarizeError: message }),
  question: "",
  asking: false,
  askError: null,
  trace: null,
  traceHistory: [],
  traceCursor: -1,
  tracePlaying: false,

  setUrl: (url) => set({ url }),
  setServiceStatus: (serviceStatus) => set({ serviceStatus }),
  // The previous result stays on screen while the next scan runs, clearly marked
  // as stale, so starting an analysis never empties the page for half a minute.
  startAnalysis: (url) => set({ url, status: "analyzing", phases: [], progress: 0, error: null, askError: null, tracePlaying: false }),
  applyAnalyzeEvent: (e) =>
    set((s) => {
      if (e.type === "phase") return { phases: [...s.phases, { phase: e.phase, detail: e.detail, progress: e.progress, at: e.at }].slice(-40), progress: e.progress };
      if (e.type === "log") return { phases: [...s.phases, { phase: "log", detail: e.message, progress: s.progress, at: e.at }].slice(-40) };
      return s;
    }),
  // Selections and traces point at node ids from the old graph, so they go when
  // the new one lands rather than when the scan starts.
  finishAnalysis: (analysis) =>
    set({ analysis, status: "ready", progress: 1, error: null, selection: null, trace: null, traceHistory: [], traceCursor: -1, tracePlaying: false }),
  failAnalysis: (message) => set({ status: "error", error: message }),
  reset: () => set({ status: "idle", phases: [], progress: 0, error: null, analysis: null, selection: null, trace: null, traceHistory: [], traceCursor: -1, tracePlaying: false, askError: null, categoryFilter: null }),
  select: (selection) => set({ selection }),
  setHovered: (hoveredNodeId) => set({ hoveredNodeId }),
  toggleCategory: (category) =>
    set((s) => {
      const next = new Set(s.categoryFilter ?? []);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return { categoryFilter: next.size ? next : null };
    }),
  clearCategoryFilter: () => set({ categoryFilter: null }),

  setQuestion: (question) => set({ question }),
  startAsk: () => set({ asking: true, askError: null }),
  finishAsk: (trace) => set((s) => ({ asking: false, trace, traceHistory: [trace, ...s.traceHistory].slice(0, 12), traceCursor: -1, tracePlaying: true })),
  failAsk: (message) => set({ asking: false, askError: message }),
  setTraceCursor: (traceCursor) => set({ traceCursor }),
  setTracePlaying: (tracePlaying) => set({ tracePlaying }),
  showTrace: (trace) => set({ trace, traceCursor: -1, tracePlaying: true, selection: null }),
}));
