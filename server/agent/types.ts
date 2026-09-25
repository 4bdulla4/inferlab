import type { DataSource, ProviderId, UsageInfo } from "@shared/llm";
import type { AgentConfig, AgentToolDescriptor, ToolCallRequest, ToolResult } from "@shared/agent";
import type { KnowledgeBaseStore } from "../rag/KnowledgeBase";
import type { EmbeddingKeys } from "../rag/embeddings";
import type { AgentSession } from "./session";

/**
 * Provider-neutral conversation. Each model adapter maps this onto its own
 * wire format and back, so the runner never sees a provider-specific shape.
 */
export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCallRequest[] }
  | { role: "tool"; results: { callId: string; name: string; content: string; isError: boolean }[] };

export interface ModelTurnRequest {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolDescriptor[];
  temperature: number;
  maxOutputTokens: number;
  /** Ask for a plain answer with no tool calls (used to wrap up at the iteration cap). */
  forceText: boolean;
  parallelToolCalls: boolean;
  signal: AbortSignal;
  onTextDelta?: (text: string) => void;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCallRequest[];
  usage: UsageInfo | null;
  latencyMs: number;
  ttfbMs: number | null;
  stopReason: string;
  model: string;
  /** "simulation" only for the offline planner. */
  source: DataSource;
}

export interface AgentModel {
  readonly id: ProviderId;
  readonly model: string;
  readonly vendor: string;
  readonly mock: boolean;
  complete(req: ModelTurnRequest): Promise<ModelTurn>;
}

/** Everything a tool may reach while it runs. */
export interface ToolContext {
  runId: string;
  callId: string;
  attempt: number;
  config: AgentConfig;
  session: AgentSession;
  signal: AbortSignal;
  keys: EmbeddingKeys & { anthropic?: string; anthropicWorkspace?: string };
  knowledgeBases: KnowledgeBaseStore | null;
  /**
   * Hands control to a human and resolves with their decision. Used by
   * `ask_human`; approval gates for other tools are applied by the runner.
   */
  askHuman: (prompt: string) => Promise<{ approved: boolean; input: string | null; waitedMs: number; timedOut: boolean }>;
  /** Lets a tool report a side effect the inspector should show (memory writes). */
  emitMemory: (op: "remember" | "forget", key: string) => void;
}

export interface ToolImpl {
  descriptor: AgentToolDescriptor;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** A tool failure that should be retried or fall back, as opposed to a bad-argument error. */
export class ToolExecutionError extends Error {
  constructor(message: string, public readonly source: DataSource = "live", public readonly retryable = true) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
