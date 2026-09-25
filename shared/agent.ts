/**
 * Shared contract for the Agent Engineering lab: how an agent run is
 * configured, what the server can honestly report about it step by step, and
 * what the browser may treat as LIVE.
 *
 * The same rule as the other labs applies. `DataSource` on a value means:
 *   - "live"        → observed from a real provider API, a real tool execution
 *                     (network, code, database, files), or a real human
 *   - "simulation"  → a stand-in: the offline demo planner, an injected
 *                     failure, or a tool with no real backend behind it
 *
 * One more rule is specific to agents. The model's private reasoning is never
 * exposed or invented. What the lab shows between a request and a response is
 * an observable state ("planning", "selecting a tool", "evaluating a result"),
 * derived from what the API actually returned, and it is labelled as such.
 */
import type { DataSource, ProviderId, UsageInfo } from "./llm";

export type { DataSource };

/* ─────────────────────────────── tools ──────────────────────────────── */

/** Built-in tools. Custom tools use ids of the form `custom:<slug>`. */
export type BuiltinToolId =
  | "web_search"
  | "web_fetch"
  | "http_api"
  | "calculator"
  | "code_exec"
  | "database"
  | "file_ops"
  | "rag_retrieve"
  | "memory"
  | "clock"
  | "external_service"
  | "unreliable_service"
  | "ask_human";

export type ToolCategory = "web" | "compute" | "data" | "files" | "knowledge" | "memory" | "system" | "external" | "human" | "custom";

/** A minimal JSON Schema for tool inputs: flat objects of primitive fields. */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, { type: "string" | "number" | "integer" | "boolean"; description: string; enum?: string[] }>;
  required: string[];
}

/** What the browser needs to draw and explain a tool, and what the model is offered. */
export interface AgentToolDescriptor {
  id: string;
  /** Function name given to the model. */
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: ToolInputSchema;
  /** How results from this tool are labelled. */
  source: DataSource;
  sourceNote: string;
  /** Whether this tool has side effects worth a human's approval. */
  sideEffects: boolean;
  /** Whether the tool can run at all right now (for example the knowledge base has documents). */
  available: boolean;
  unavailableReason?: string;
}

/** A tool the user defines in the UI. It has no real backend, so its results are a labelled simulation. */
export interface CustomToolSpec {
  /** Lowercase slug, letters, digits and underscores. */
  slug: string;
  description: string;
  parameters: { name: string; type: "string" | "number" | "boolean"; description: string; required: boolean }[];
  /** Returned verbatim, with `{{param}}` placeholders filled from the arguments. */
  response: string;
}

/* ─────────────────────────────── config ─────────────────────────────── */

export interface AgentConfig {
  llmProvider: ProviderId;
  /** Enabled tool ids, built-in or `custom:<slug>`. */
  tools: string[];
  customTools: CustomToolSpec[];
  maxIterations: number;
  /** Let the model request several tools in one turn and run them at once. */
  parallelToolCalls: boolean;
  retry: { maxAttempts: number; backoffMs: number };
  /** Tool ids whose calls wait for a human to approve them. */
  approvalRequired: string[];
  /** When a tool fails every attempt, the tool to try instead. */
  fallbacks: Record<string, string>;
  /** Knowledge base the `rag_retrieve` tool searches. */
  ragKbId: string | null;
  /** Stop once input + output tokens across all model calls pass this. */
  tokenBudget: number | null;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
  /** Extra instructions appended to the lab's system prompt. */
  systemPrompt: string;
  /** How many attempts the injected-failure tool rejects before succeeding. */
  unreliableFailures: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  llmProvider: "claude",
  tools: ["web_search", "calculator", "clock"],
  customTools: [],
  maxIterations: 6,
  parallelToolCalls: true,
  retry: { maxAttempts: 2, backoffMs: 400 },
  approvalRequired: [],
  fallbacks: {},
  ragKbId: null,
  tokenBudget: null,
  timeoutMs: 180_000,
  temperature: 0.2,
  maxOutputTokens: 900,
  systemPrompt: "",
  unreliableFailures: 2,
};

export const AGENT_LIMITS = {
  maxIterations: 12,
  maxGoalChars: 2000,
  maxSystemPromptChars: 3000,
  maxCustomTools: 6,
  maxToolResultChars: 6000,
  approvalTimeoutMs: 10 * 60 * 1000,
};

/* ───────────────────────────── scenarios ────────────────────────────── */

export interface AgentScenario {
  id: string;
  name: string;
  tagline: string;
  /** What this scenario is meant to teach. */
  teaches: string[];
  goal: string;
  config: Partial<AgentConfig>;
  /** The scenario needs a knowledge base with documents. */
  needsKnowledgeBase?: boolean;
}

export const AGENT_SCENARIOS: AgentScenario[] = [
  {
    id: "research",
    name: "Research assistant",
    tagline: "search → read → calculate → answer",
    teaches: ["tool selection", "chaining results", "grounded answer"],
    goal: "Find out in which year the Eiffel Tower was completed, then work out how many years ago that was using today's date. Answer in two sentences and name your sources.",
    config: { tools: ["web_search", "web_fetch", "calculator", "clock"], parallelToolCalls: true, maxIterations: 6 },
  },
  {
    id: "analyst",
    name: "Data analyst",
    tagline: "query a database → compute → write a report",
    teaches: ["structured tools", "multi-step reasoning", "file side effects"],
    goal: "Using the orders database, find which product category earned the most revenue and by how much it beat the runner-up. Then write a short markdown report to report.md and tell me what it says.",
    config: { tools: ["database", "calculator", "file_ops"], parallelToolCalls: false, maxIterations: 7 },
  },
  {
    id: "coder",
    name: "Code runner",
    tagline: "write code → execute it → save the output",
    teaches: ["code execution", "verifying results", "iteration on errors"],
    goal: "Write JavaScript that prints the first 15 Fibonacci numbers and their sum, run it, then save the printed output to fib.txt and report the sum.",
    config: { tools: ["code_exec", "file_ops"], parallelToolCalls: false, maxIterations: 6 },
  },
  {
    id: "knowledge",
    name: "Knowledge base agent",
    tagline: "retrieve from your documents → remember key facts",
    teaches: ["RAG as a tool", "memory writes", "citing retrieved text"],
    goal: "Search the knowledge base for its main topics, then store the three most important facts you find in memory with short keys, and summarise what the documents cover.",
    config: { tools: ["rag_retrieve", "memory"], parallelToolCalls: false, maxIterations: 6 },
    needsKnowledgeBase: true,
  },
  {
    id: "resilient",
    name: "Retries and fallback",
    tagline: "a flaky service fails → retry → fall back",
    teaches: ["retry policy", "fallback tools", "error handling"],
    goal: "Get the current status report from the status service and summarise it in one sentence. If the service is unavailable, use whatever fallback you have.",
    config: {
      tools: ["unreliable_service", "external_service"],
      fallbacks: { unreliable_service: "external_service" },
      retry: { maxAttempts: 2, backoffMs: 500 },
      unreliableFailures: 3,
      parallelToolCalls: false,
      maxIterations: 4,
    },
  },
  {
    id: "approval",
    name: "Human in the loop",
    tagline: "a side effect waits for your approval",
    teaches: ["approval gates", "side-effect tools", "human decisions"],
    goal: "Work out 17 × 23 and today's date, then send a notification to the on-call channel with both values. Confirm what was sent.",
    config: { tools: ["calculator", "clock", "external_service"], approvalRequired: ["external_service"], parallelToolCalls: true, maxIterations: 5 },
  },
  {
    id: "parallel",
    name: "Parallel lookups",
    tagline: "three searches at once → rank the results",
    teaches: ["parallel tool calls", "aggregation", "comparison"],
    goal: "Look up the population of Tokyo, Delhi and São Paulo, then rank the three cities from largest to smallest with the figures you found.",
    config: { tools: ["web_search", "web_fetch"], parallelToolCalls: true, maxIterations: 5 },
  },
  {
    id: "clarify",
    name: "Ask the human",
    tagline: "the agent asks you a question before acting",
    teaches: ["human input as a tool", "conditional decisions"],
    goal: "Ask me which city I am in, then tell me the current time and one interesting fact about that city found on the web.",
    config: { tools: ["ask_human", "clock", "web_search"], parallelToolCalls: false, maxIterations: 6 },
  },
];

/* ──────────────────────────── run-time facts ────────────────────────── */

export interface ToolCallRequest {
  /** Provider-issued id when there is one, otherwise synthesized. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** What the model receives, already truncated to the lab's limit. */
  content: string;
  /** Structured detail for the inspector, when the tool has any. */
  data?: unknown;
  source: DataSource;
  latencyMs: number;
  /** Where the result came from, e.g. "Wikipedia search API" or "injected failure (simulation)". */
  note: string;
  truncated: boolean;
}

export interface MemoryEntry {
  key: string;
  value: string;
  at: number;
}

export interface MessageSummary {
  role: "system" | "user" | "assistant" | "tool";
  /** First characters of the content, for the context view. */
  preview: string;
  chars: number;
  tokenEstimate: number;
  toolCalls?: string[];
  /** For tool results: which call each belongs to. */
  callIds?: string[];
}

/**
 * Observable phases of an agent. These are derived from what the API and the
 * tools did, never from the model's hidden reasoning.
 */
export type AgentStatus =
  | "initializing"
  | "planning"
  | "selecting_tool"
  | "awaiting_human"
  | "executing_tool"
  | "evaluating_result"
  | "responding"
  | "completed"
  | "failed"
  | "stopped";

/** The complete agent state after a step. Every field is a real count or a real value. */
export interface AgentStateSnapshot {
  status: AgentStatus;
  goal: string;
  iteration: number;
  maxIterations: number;
  messages: MessageSummary[];
  /** o200k_base estimate of everything the next model call would read. */
  contextTokens: number;
  availableTools: string[];
  /** Tools the model asked for in the current iteration. */
  selectedTools: string[];
  lastTool?: { name: string; ok: boolean; preview: string };
  memory: MemoryEntry[];
  files: string[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  modelMs: number;
  toolMs: number;
  toolCalls: number;
  errors: number;
  retries: number;
  pendingApproval?: { callId: string; tool: string };
}

export interface ToolRationale {
  /** The tool description the model was shown; it is the only "why" the lab can prove. */
  offeredDescription: string;
  /** Text the model wrote in the same turn as the call, if any. */
  modelText: string | null;
  argsSummary: string;
  /** Other tools that were available but not chosen. */
  alternatives: string[];
}

export type TerminationReason = "completed" | "max_iterations" | "token_budget" | "timeout" | "stopped" | "error";

/* ─────────────────────────────── events ─────────────────────────────── */

export type AgentEvent =
  | { type: "run_started"; at: number; runId: string; goal: string; config: AgentConfig; scenarioId: string | null }
  | { type: "agent_initialized"; at: number; provider: ProviderId; model: string; vendor: string; mock: boolean; tools: AgentToolDescriptor[] }
  | { type: "system_instructions"; at: number; text: string; tokenEstimate: number }
  | { type: "context_loaded"; at: number; messages: MessageSummary[]; memory: MemoryEntry[]; files: string[]; knowledgeBase: { id: string; documents: number; chunks: number } | null; tokenEstimate: number }
  | { type: "iteration_started"; at: number; iteration: number }
  | { type: "model_request"; at: number; iteration: number; messages: number; tokenEstimate: number; tools: number; forceText: boolean }
  | {
      type: "model_response";
      at: number;
      iteration: number;
      latencyMs: number;
      ttfbMs: number | null;
      usage: UsageInfo | null;
      stopReason: string;
      text: string;
      toolCalls: ToolCallRequest[];
      model: string;
      source: DataSource;
    }
  | { type: "decision"; at: number; iteration: number; kind: "call_tools" | "respond" | "stop"; reason: string; toolCalls: number; parallel: boolean; source: DataSource }
  | { type: "tool_selected"; at: number; iteration: number; call: ToolCallRequest; tool: AgentToolDescriptor; rationale: ToolRationale; source: DataSource }
  | { type: "approval_requested"; at: number; callId: string; tool: string; args: Record<string, unknown>; prompt: string; kind: "approve" | "answer" }
  | { type: "approval_resolved"; at: number; callId: string; approved: boolean; input: string | null; waitedMs: number; timedOut: boolean }
  | { type: "tool_started"; at: number; callId: string; tool: string; attempt: number; maxAttempts: number }
  | { type: "tool_attempt_failed"; at: number; callId: string; tool: string; attempt: number; error: string; willRetry: boolean; retryInMs: number | null; source: DataSource }
  | { type: "tool_fallback"; at: number; callId: string; from: string; to: string; reason: string }
  | { type: "tool_completed"; at: number; callId: string; tool: string; result: ToolResult; attempts: number; iteration: number }
  | { type: "observation"; at: number; callId: string; tool: string; summary: string; chars: number; tokenEstimate: number; isError: boolean }
  | { type: "state_updated"; at: number; iteration: number; state: AgentStateSnapshot; cause: string }
  | { type: "memory_updated"; at: number; op: "remember" | "forget"; key: string; entries: MemoryEntry[] }
  | { type: "final_text_delta"; at: number; text: string; index: number }
  | { type: "final_response"; at: number; text: string; iteration: number; source: DataSource }
  | {
      type: "run_completed";
      at: number;
      reason: TerminationReason;
      iterations: number;
      totalMs: number;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      toolCalls: number;
      errors: number;
      retries: number;
      state: AgentStateSnapshot;
    }
  | { type: "notice"; at: number; level: "info" | "warn"; message: string }
  | { type: "error"; at: number; message: string; status?: number; retryable: boolean };

/* ───────────────────────────── blueprints ───────────────────────────── */

/** One tool the analyzer picked, with the words in the description that earned it. */
export interface BlueprintTool {
  id: string;
  /** 0–1: how strongly the description asked for this. */
  confidence: number;
  reason: string;
  evidence: string[];
  /** "rules" for the deterministic analyzer, "ai" when only the model proposed it, "both" when they agreed. */
  from: "rules" | "ai" | "both";
}

/** Something the description asks for that no tool here can do for real. */
export interface BlueprintGap {
  capability: string;
  evidence: string[];
  suggestion: string;
}

/**
 * What a plain-language description turns into: a runnable configuration plus
 * the reasoning behind every choice, so the person can check and change it.
 */
export interface AgentBlueprint {
  goal: string;
  summary: string;
  tools: BlueprintTool[];
  approvalRequired: string[];
  fallbacks: Record<string, string>;
  parallelToolCalls: boolean;
  maxIterations: number;
  retry: { maxAttempts: number; backoffMs: number };
  needsKnowledgeBase: boolean;
  systemPrompt: string;
  /** Constraints found in the description, in the person's own words. */
  constraints: string[];
  gaps: BlueprintGap[];
  warnings: string[];
  /** "rules" when only the deterministic analyzer ran; "ai+rules" when a model refined it and code validated the result. */
  source: "rules" | "ai+rules";
  model?: string;
  usage?: UsageInfo | null;
}

export interface DescribeAgentBody {
  description: string;
  /** Provider to refine with; the rule analyzer runs regardless. */
  llmProvider?: ProviderId;
}

/* ─────────────────────────── request bodies ─────────────────────────── */

export interface StartAgentRunBody {
  goal: string;
  config: Partial<AgentConfig>;
  scenarioId?: string | null;
  /** Browser session; memory and files persist across runs in it. */
  sessionId: string;
}

export interface ResolveApprovalBody {
  approved: boolean;
  /** For `ask_human`: the human's answer. */
  input?: string;
}

export interface AgentServiceStatus {
  providers: { id: ProviderId; name: string; vendor: string; model: string; configured: boolean; mock: boolean }[];
  tools: AgentToolDescriptor[];
  scenarios: AgentScenario[];
  limits: typeof AGENT_LIMITS;
}

/** A finished run kept on the server for a while so the browser can re-fetch it. */
export interface AgentRunRecord {
  runId: string;
  sessionId: string;
  at: number;
  goal: string;
  config: AgentConfig;
  scenarioId: string | null;
  events: AgentEvent[];
  finished: boolean;
  reason: TerminationReason | null;
}
