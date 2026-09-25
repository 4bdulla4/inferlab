import { create } from "zustand";
import type { AgentBlueprint, AgentConfig, AgentServiceStatus, MemoryEntry } from "@shared/agent";
import type { AgentBackendReport } from "@shared/agentReport";
import { AGENT_SCENARIOS, DEFAULT_AGENT_CONFIG } from "@shared/agent";
import type { PlaybackState, RunStatus } from "@/types/execution";
import type { AnyAgentEvent } from "@/labs/agent/events";
import { applyAgentEvent } from "@/labs/agent/reducer";
import { createAgentVisualState, type AgentRunState } from "@/labs/agent/state";

const CONFIG_KEY = "inferlab.agent.config.v1";

function loadConfig(): AgentConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_AGENT_CONFIG, ...(JSON.parse(raw) as Partial<AgentConfig>) };
  } catch {
    /* fall through */
  }
  const first = AGENT_SCENARIOS[0]!;
  return { ...DEFAULT_AGENT_CONFIG, ...first.config };
}

function saveConfig(config: AgentConfig): void {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* preference simply will not persist */
  }
}

export interface AgentStoreState {
  status: AgentServiceStatus | null;
  statusError: string | null;
  goal: string;
  scenarioId: string | null;
  config: AgentConfig;
  workspace: { memory: MemoryEntry[]; files: { path: string; chars: number }[] } | null;

  runs: Record<string, AgentRunState>;
  runCounter: number;
  activeRunId: string | null;
  starting: boolean;
  startError: string | null;

  /** Node held still in the inspector; null follows execution. */
  selectedNodeId: string | null;
  configOpen: boolean;

  /** "scenarios" picks a preset; "describe" writes the agent in plain words and lets the analyzer plan it. */
  composerMode: "scenarios" | "describe";
  description: string;
  blueprint: { loading: boolean; result: AgentBlueprint | null; hits: { capability: string; score: number }[]; error: string | null; forDescription: string | null };
  /** The "analyze my backend" report and its progress. */
  codeReport: { loading: boolean; stage: string | null; result: AgentBackendReport | null; error: string | null };
  codeAnalyzerOpen: boolean;

  setStatus: (status: AgentServiceStatus | null, error?: string | null) => void;
  setGoal: (goal: string) => void;
  applyScenario: (scenarioId: string | null) => void;
  setConfig: (partial: Partial<AgentConfig>) => void;
  setWorkspace: (workspace: AgentStoreState["workspace"]) => void;

  createRun: (run: AgentRunState) => void;
  appendEvents: (runId: string, events: AnyAgentEvent[]) => void;
  applyNext: (runId: string) => void;
  resetVisual: (runId: string) => void;
  setPlayback: (runId: string, state: PlaybackState) => void;
  setRunStatus: (runId: string, status: RunStatus, liveDone: boolean) => void;
  setServerRunId: (runId: string, serverRunId: string) => void;
  setActiveRun: (runId: string | null) => void;
  clearRuns: () => void;
  setStarting: (starting: boolean, error?: string | null) => void;

  selectNode: (nodeId: string | null) => void;
  setConfigOpen: (open: boolean) => void;
  setComposerMode: (mode: "scenarios" | "describe") => void;
  setDescription: (description: string) => void;
  setBlueprint: (partial: Partial<AgentStoreState["blueprint"]>) => void;
  /** Adopts a plan: goal, tools and policy, keeping the provider and knowledge base already chosen. */
  applyBlueprint: (blueprint: AgentBlueprint, toolIds: string[]) => void;
  setCodeReport: (partial: Partial<AgentStoreState["codeReport"]>) => void;
  setCodeAnalyzerOpen: (open: boolean) => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  status: null,
  statusError: null,
  goal: AGENT_SCENARIOS[0]!.goal,
  scenarioId: AGENT_SCENARIOS[0]!.id,
  config: loadConfig(),
  workspace: null,

  runs: {},
  runCounter: 0,
  activeRunId: null,
  starting: false,
  startError: null,

  selectedNodeId: null,
  configOpen: false,
  composerMode: "scenarios",
  description: "",
  blueprint: { loading: false, result: null, hits: [], error: null, forDescription: null },
  codeReport: { loading: false, stage: null, result: null, error: null },
  codeAnalyzerOpen: false,

  setStatus: (status, error = null) => set({ status, statusError: error }),
  setGoal: (goal) => set({ goal }),
  applyScenario: (scenarioId) =>
    set((s) => {
      const scenario = scenarioId ? AGENT_SCENARIOS.find((x) => x.id === scenarioId) : undefined;
      if (!scenario) return { scenarioId: null };
      // A preset sets the goal and the knobs it teaches; the provider and knowledge base stay yours.
      const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...scenario.config, llmProvider: s.config.llmProvider, ragKbId: s.config.ragKbId, customTools: s.config.customTools };
      saveConfig(config);
      return { scenarioId, goal: scenario.goal, config };
    }),
  setConfig: (partial) =>
    set((s) => {
      const config = { ...s.config, ...partial };
      saveConfig(config);
      return { config };
    }),
  setWorkspace: (workspace) => set({ workspace }),

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
      return { runs: { ...s.runs, [runId]: { ...run, cursor: run.cursor + 1, visual: applyAgentEvent(run.visual, event) } } };
    }),

  resetVisual: (runId) =>
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return { runs: { ...s.runs, [runId]: { ...run, cursor: 0, visual: createAgentVisualState() } } };
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
  clearRuns: () => set({ runs: {}, activeRunId: null, selectedNodeId: null }),
  setStarting: (starting, error = null) => set({ starting, startError: error }),

  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  setConfigOpen: (configOpen) => set({ configOpen }),
  setComposerMode: (composerMode) => set({ composerMode }),
  setDescription: (description) => set({ description }),
  setBlueprint: (partial) => set((s) => ({ blueprint: { ...s.blueprint, ...partial } })),
  applyBlueprint: (b, toolIds) =>
    set((s) => {
      const tools = [...new Set(toolIds)];
      const config: AgentConfig = {
        ...s.config,
        tools,
        approvalRequired: b.approvalRequired.filter((t) => tools.includes(t)),
        fallbacks: Object.fromEntries(Object.entries(b.fallbacks).filter(([from, to]) => tools.includes(from) && tools.includes(to))),
        parallelToolCalls: b.parallelToolCalls,
        maxIterations: b.maxIterations,
        retry: b.retry,
        systemPrompt: b.systemPrompt,
      };
      saveConfig(config);
      return { config, goal: b.goal, scenarioId: null };
    }),
  setCodeReport: (partial) => set((s) => ({ codeReport: { ...s.codeReport, ...partial } })),
  setCodeAnalyzerOpen: (codeAnalyzerOpen) => set({ codeAnalyzerOpen }),
}));

export const selectActiveAgentRun = (s: AgentStoreState): AgentRunState | undefined => (s.activeRunId ? s.runs[s.activeRunId] : undefined);
