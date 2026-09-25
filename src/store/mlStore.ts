import { create } from "zustand";
import type { DatasetSummary, MLConfig, MLServiceStatus, SavedModelInfo } from "@shared/ml";
import { DEFAULT_ML_CONFIG } from "@shared/ml";
import type { PlaybackState, RunStatus } from "@/types/execution";
import type { AnyMLEvent } from "@/labs/ml/events";
import { applyMLEvent } from "@/labs/ml/reducer";
import type { MLStageId } from "@/labs/ml/stages";
import { createMLVisualState, type MLRunState } from "@/labs/ml/state";

const CONFIG_KEY = "inferlab.ml.config.v1";

function loadConfig(): MLConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MLConfig>;
      return { ...DEFAULT_ML_CONFIG, ...parsed, hyperparameters: { ...DEFAULT_ML_CONFIG.hyperparameters, ...(parsed.hyperparameters ?? {}) } };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_ML_CONFIG, hyperparameters: { ...DEFAULT_ML_CONFIG.hyperparameters } };
}

function saveConfig(config: MLConfig): void {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* preference simply will not persist */
  }
}

export interface MLStoreState {
  status: MLServiceStatus | null;
  statusError: string | null;
  datasets: DatasetSummary[];
  datasetId: string | null;
  /** Rows of the chosen dataset for the inspector table. */
  datasetRows: { id: string; columns: string[]; rows: string[][] } | null;
  config: MLConfig;
  models: Record<string, SavedModelInfo>;

  runs: Record<string, MLRunState>;
  runCounter: number;
  activeRunId: string | null;
  comparisonRunIds: string[] | null;
  starting: boolean;
  startError: string | null;
  uploading: boolean;
  uploadError: string | null;

  selectedStage: MLStageId | null;
  settingsOpen: boolean;
  /** Which column the dataset inspector is focused on. */
  focusColumn: string | null;

  setStatus: (status: MLServiceStatus | null, error?: string | null) => void;
  setDatasets: (datasets: DatasetSummary[]) => void;
  selectDataset: (id: string | null) => void;
  setDatasetRows: (rows: MLStoreState["datasetRows"]) => void;
  setConfig: (partial: Partial<MLConfig>) => void;
  setHyper: (partial: Partial<MLConfig["hyperparameters"]>) => void;
  addModel: (info: SavedModelInfo) => void;

  createRun: (run: MLRunState) => void;
  appendEvents: (runId: string, events: AnyMLEvent[]) => void;
  applyNext: (runId: string) => void;
  resetVisual: (runId: string) => void;
  setPlayback: (runId: string, state: PlaybackState) => void;
  setRunStatus: (runId: string, status: RunStatus, liveDone: boolean) => void;
  setServerRunId: (runId: string, serverRunId: string) => void;
  setActiveRun: (runId: string | null) => void;
  setComparison: (runIds: string[] | null) => void;
  clearRuns: () => void;
  setStarting: (starting: boolean, error?: string | null) => void;
  setUploading: (uploading: boolean, error?: string | null) => void;

  selectStage: (stage: MLStageId | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setFocusColumn: (column: string | null) => void;
}

export const useMLStore = create<MLStoreState>((set) => ({
  status: null,
  statusError: null,
  datasets: [],
  datasetId: "flowers",
  datasetRows: null,
  config: loadConfig(),
  models: {},

  runs: {},
  runCounter: 0,
  activeRunId: null,
  comparisonRunIds: null,
  starting: false,
  startError: null,
  uploading: false,
  uploadError: null,

  selectedStage: null,
  settingsOpen: false,
  focusColumn: null,

  setStatus: (status, error = null) => set({ status, statusError: error }),
  setDatasets: (datasets) => set((s) => ({ datasets, datasetId: s.datasetId && datasets.some((d) => d.id === s.datasetId) ? s.datasetId : datasets[0]?.id ?? null })),
  selectDataset: (datasetId) => set((s) => ({ datasetId, focusColumn: null, config: { ...s.config, target: null, excluded: [] } })),
  setDatasetRows: (datasetRows) => set({ datasetRows }),
  setConfig: (partial) =>
    set((s) => {
      const config = { ...s.config, ...partial };
      saveConfig(config);
      return { config };
    }),
  setHyper: (partial) =>
    set((s) => {
      const config = { ...s.config, hyperparameters: { ...s.config.hyperparameters, ...partial } };
      saveConfig(config);
      return { config };
    }),
  addModel: (info) => set((s) => ({ models: { ...s.models, [info.modelId]: info } })),

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
      return { runs: { ...s.runs, [runId]: { ...run, cursor: run.cursor + 1, visual: applyMLEvent(run.visual, event) } } };
    }),
  resetVisual: (runId) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return { runs: { ...s.runs, [runId]: { ...run, cursor: 0, visual: createMLVisualState() } } };
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
  setServerRunId: (runId, serverRunId) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run || run.serverRunId === serverRunId) return s;
      return { runs: { ...s.runs, [runId]: { ...run, serverRunId } } };
    }),
  setActiveRun: (activeRunId) => set({ activeRunId }),
  setComparison: (comparisonRunIds) => set({ comparisonRunIds }),
  clearRuns: () => set({ runs: {}, activeRunId: null, comparisonRunIds: null, selectedStage: null }),
  setStarting: (starting, error = null) => set({ starting, startError: error }),
  setUploading: (uploading, error = null) => set({ uploading, uploadError: error }),

  selectStage: (selectedStage) => set({ selectedStage }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setFocusColumn: (focusColumn) => set({ focusColumn }),
}));

export const selectActiveMLRun = (s: MLStoreState): MLRunState | undefined => (s.activeRunId ? s.runs[s.activeRunId] : undefined);
export const selectDataset = (s: MLStoreState): DatasetSummary | undefined => s.datasets.find((d) => d.id === s.datasetId);
