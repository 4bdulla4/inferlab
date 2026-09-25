import type { DataSource, UsageInfo } from "@shared/llm";
import type { AgentConfig, AgentStateSnapshot, AgentToolDescriptor, MemoryEntry, MessageSummary, TerminationReason, ToolCallRequest, ToolCategory, ToolRationale, ToolResult } from "@shared/agent";
import type { EventStatus, NodeState, PlaybackState, RunStatus } from "@/types/execution";
import type { AnyAgentEvent } from "./events";
import type { AgentNodeKind } from "./stages";

export interface AgentGraphNode {
  id: string;
  kind: AgentNodeKind;
  label: string;
  /** One line under the label, derived from the events that touched the node. */
  sublabel?: string;
  iteration?: number;
  callId?: string;
  /** Tool name for tool, approval and fallback nodes. */
  tool?: string;
  category?: ToolCategory;
  /** Set when a tool node waits on a person (approval gate or ask_human). */
  human?: boolean;
}

export interface AgentGraphEdge {
  id: string;
  from: string;
  to: string;
  /** "flow" follows execution; "fallback" is the substitution after failures; "parallel" fans out to calls run at once. */
  kind: "flow" | "fallback" | "parallel";
}

export interface AgentTimelineEntry {
  id: string;
  nodeId: string;
  kind: AgentNodeKind;
  label: string;
  status: EventStatus;
  source: DataSource;
  startedAt: number;
  endedAt?: number;
  count: number;
}

export interface IterationInfo {
  n: number;
  planNodeId: string;
  requestedAt?: number;
  request?: { messages: number; tokenEstimate: number; tools: number; forceText: boolean };
  response?: { latencyMs: number; ttfbMs: number | null; usage: UsageInfo | null; stopReason: string; text: string; toolCalls: ToolCallRequest[]; model: string; source: DataSource };
  decision?: { kind: "call_tools" | "respond" | "stop"; reason: string; toolCalls: number; parallel: boolean };
  callIds: string[];
  observationNodeId?: string;
  /** Text streamed during this turn, before the response arrived. */
  streamText?: string;
  streamPieces?: number;
}

export interface ToolCallInfo {
  callId: string;
  nodeId: string;
  iteration: number;
  name: string;
  args: Record<string, unknown>;
  tool: AgentToolDescriptor;
  rationale: ToolRationale;
  parallel: boolean;
  approval?: { nodeId: string; prompt: string; kind: "approve" | "answer"; requestedAt: number; resolved?: { approved: boolean; input: string | null; waitedMs: number; timedOut: boolean } };
  attempts: { attempt: number; maxAttempts: number; startedAt: number; error?: string; willRetry?: boolean; retryInMs?: number | null; tool: string }[];
  fallback?: { nodeId: string; to: string; reason: string; at: number };
  result?: ToolResult;
  /** The tool that produced the result: the original or its fallback. */
  completedTool?: string;
  observation?: { summary: string; chars: number; tokenEstimate: number; isError: boolean };
}

/** Everything the visualizer draws for one run, rebuilt purely from applied events. */
export interface AgentVisualState {
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  nodeState: Record<string, NodeState>;
  nodeSource: Record<string, DataSource>;
  pulses: Record<string, number>;
  currentNodeId: string | null;

  goal?: string;
  config?: AgentConfig;
  scenarioId?: string | null;
  agent?: { provider: string; model: string; vendor: string; mock: boolean; tools: AgentToolDescriptor[] };
  instructions?: { text: string; tokenEstimate: number };
  context?: { messages: MessageSummary[]; memory: MemoryEntry[]; files: string[]; knowledgeBase: { id: string; documents: number; chunks: number } | null; tokenEstimate: number };
  iterations: Record<number, IterationInfo>;
  calls: Record<string, ToolCallInfo>;
  memory: MemoryEntry[];
  memoryOps: { op: "remember" | "forget"; key: string; at: number }[];
  /** The latest full state, and the state as it stood after each node's step. */
  snapshot: AgentStateSnapshot | null;
  snapshots: Record<string, AgentStateSnapshot>;
  finalText: string;
  finalPieces: number;
  final?: { text: string; iteration: number; source: DataSource };
  completion?: { reason: TerminationReason; iterations: number; totalMs: number; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; toolCalls: number; errors: number; retries: number };
  pendingApproval?: { callId: string; nodeId: string; tool: string; prompt: string; kind: "approve" | "answer"; args: Record<string, unknown> };

  notices: { level: "info" | "warn"; message: string; at: number }[];
  error?: { message: string; status?: number };
  stopped: boolean;
  timeline: AgentTimelineEntry[];
  appliedEvents: number;
  lastEvent?: AnyAgentEvent;
}

export interface AgentRunState {
  id: string;
  /** The server's run id, known once the first event lands. */
  serverRunId: string | null;
  goal: string;
  config: AgentConfig;
  scenarioId: string | null;
  createdAt: number;
  status: RunStatus;
  liveDone: boolean;
  log: AnyAgentEvent[];
  cursor: number;
  visual: AgentVisualState;
  playback: PlaybackState;
}

export function createAgentVisualState(): AgentVisualState {
  return {
    nodes: [],
    edges: [],
    nodeState: {},
    nodeSource: {},
    pulses: {},
    currentNodeId: null,
    iterations: {},
    calls: {},
    memory: [],
    memoryOps: [],
    snapshot: null,
    snapshots: {},
    finalText: "",
    finalPieces: 0,
    notices: [],
    stopped: false,
    timeline: [],
    appliedEvents: 0,
  };
}

export function createAgentRun(params: { id: string; goal: string; config: AgentConfig; scenarioId: string | null }): AgentRunState {
  return {
    id: params.id,
    serverRunId: null,
    goal: params.goal,
    config: params.config,
    scenarioId: params.scenarioId,
    createdAt: Date.now(),
    status: "running",
    liveDone: false,
    log: [],
    cursor: 0,
    visual: createAgentVisualState(),
    playback: "paused",
  };
}
