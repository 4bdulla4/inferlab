import type { UsageInfo } from "@shared/llm";
import type { AgentConfig, AgentStateSnapshot, AgentToolDescriptor, MemoryEntry, MessageSummary, TerminationReason, ToolCallRequest, ToolRationale, ToolResult } from "@shared/agent";
import type { ExecutionEvent } from "@/types/execution";
import type { AgentNodeKind } from "./stages";

/**
 * The agent lab's execution vocabulary. Because the graph grows, every event
 * names the node it lands on (`nodeId`) as well as the kind of node (`stage`).
 */
export interface AgentEventDataMap {
  RUN_STARTED: { nodeId: string; goal: string; config: AgentConfig; scenarioId: string | null };
  AGENT_INITIALIZED: { nodeId: string; provider: string; model: string; vendor: string; mock: boolean; tools: AgentToolDescriptor[] };
  INSTRUCTIONS_SET: { nodeId: string; text: string; tokenEstimate: number };
  CONTEXT_LOADED: { nodeId: string; messages: MessageSummary[]; memory: MemoryEntry[]; files: string[]; knowledgeBase: { id: string; documents: number; chunks: number } | null; tokenEstimate: number };
  ITERATION_STARTED: { nodeId: string; iteration: number };
  MODEL_REQUESTED: { nodeId: string; iteration: number; messages: number; tokenEstimate: number; tools: number; forceText: boolean };
  MODEL_RESPONDED: { nodeId: string; iteration: number; latencyMs: number; ttfbMs: number | null; usage: UsageInfo | null; stopReason: string; text: string; toolCalls: ToolCallRequest[]; model: string };
  DECIDED: { nodeId: string; iteration: number; kind: "call_tools" | "respond" | "stop"; reason: string; toolCalls: number; parallel: boolean; fromNodeId: string };
  TOOL_SELECTED: { nodeId: string; iteration: number; call: ToolCallRequest; tool: AgentToolDescriptor; rationale: ToolRationale; fromNodeId: string; parallel: boolean };
  APPROVAL_REQUESTED: { nodeId: string; callId: string; tool: string; args: Record<string, unknown>; prompt: string; kind: "approve" | "answer"; toolNodeId: string };
  APPROVAL_RESOLVED: { nodeId: string; callId: string; approved: boolean; input: string | null; waitedMs: number; timedOut: boolean };
  TOOL_STARTED: { nodeId: string; callId: string; tool: string; attempt: number; maxAttempts: number };
  TOOL_ATTEMPT_FAILED: { nodeId: string; callId: string; tool: string; attempt: number; error: string; willRetry: boolean; retryInMs: number | null };
  TOOL_FALLBACK: { nodeId: string; callId: string; from: string; to: string; reason: string; fromNodeId: string };
  TOOL_COMPLETED: { nodeId: string; callId: string; tool: string; result: ToolResult; attempts: number; iteration: number };
  OBSERVED: { nodeId: string; callId: string; tool: string; summary: string; chars: number; tokenEstimate: number; isError: boolean; iteration: number; leafNodeIds: string[] };
  STATE_UPDATED: { nodeId: string; iteration: number; state: AgentStateSnapshot; cause: string };
  MEMORY_UPDATED: { nodeId: string; op: "remember" | "forget"; key: string; entries: MemoryEntry[] };
  /** Text streamed during a model turn. It belongs to that turn's planning node until the decision says it is the answer. */
  MODEL_TEXT_DELTA: { nodeId: string; iteration: number; text: string; index: number };
  FINAL_RESPONSE: { nodeId: string; text: string; iteration: number; fromNodeId: string };
  RUN_COMPLETED: { nodeId: string; reason: TerminationReason; iterations: number; totalMs: number; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; toolCalls: number; errors: number; retries: number; state: AgentStateSnapshot; fromNodeId: string };
  NOTICE: { nodeId: string; level: "info" | "warn"; message: string };
  EXECUTION_ERROR: { nodeId: string; message: string; status?: number; retryable: boolean };
  EXECUTION_STOPPED: { nodeId: string };
}

export type AgentEventType = keyof AgentEventDataMap;

export type AgentLabEvent<T extends AgentEventType = AgentEventType> = Omit<ExecutionEvent<T, AgentNodeKind, AgentEventDataMap[T]>, "data"> & { data: AgentEventDataMap[T] };

export type AnyAgentEvent = { [K in AgentEventType]: AgentLabEvent<K> }[AgentEventType];
