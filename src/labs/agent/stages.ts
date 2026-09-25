import type { DataSource } from "@shared/llm";
import type { AgentStatus, ToolCategory } from "@shared/agent";

/**
 * Kinds of node the agent graph can grow. Unlike the LLM and RAG labs the graph
 * is not fixed: a run adds a planning, decision and observation node per
 * iteration and one node per tool call, so these are kinds, not stages.
 */
export type AgentNodeKind = "goal" | "init" | "instructions" | "context" | "plan" | "decision" | "approval" | "tool" | "fallback" | "observation" | "response" | "done";

export interface AgentNodeDefinition {
  kind: AgentNodeKind;
  label: string;
  defaultSource: DataSource;
  beginner: string;
  advanced: string;
  /** Sentence explaining what is LIVE vs SIMULATED for this kind of node. */
  sourceNote: string;
}

export const AGENT_NODES: Record<AgentNodeKind, AgentNodeDefinition> = {
  goal: {
    kind: "goal",
    label: "User Goal",
    defaultSource: "live",
    beginner: "You tell the agent what you want done. Everything that follows exists to reach this.",
    advanced: "The goal becomes the first user message. Its character and token counts are recorded, and it is never rewritten.",
    sourceNote: "Live: your goal exactly as typed.",
  },
  init: {
    kind: "init",
    label: "Agent Initialization",
    defaultSource: "live",
    beginner: "The agent is set up: which model will think, and which tools it is allowed to use.",
    advanced: "The provider client is built with this session's key, and the tool definitions (name, description, JSON schema) that will be sent with every request are fixed.",
    sourceNote: "Live: the real model id and the exact tool list offered to it.",
  },
  instructions: {
    kind: "instructions",
    label: "System Instructions",
    defaultSource: "live",
    beginner: "The agent is given its standing orders: use tools for facts, never invent results, stop when done.",
    advanced: "The system prompt the lab sends, including the iteration cap, any memory and files already in the workspace, approval rules, and your extra instructions.",
    sourceNote: "Live: this is the verbatim system prompt.",
  },
  context: {
    kind: "context",
    label: "Context / Memory",
    defaultSource: "live",
    beginner: "Before thinking, the agent loads what it already knows: past memory, files in its workspace, and any knowledge base attached.",
    advanced: "The message list starts with the system prompt and the goal. Memory entries and workspace files from earlier runs in this session are real; token estimates use the o200k_base BPE.",
    sourceNote: "Live: real memory, real files, real knowledge-base counts from the server.",
  },
  plan: {
    kind: "plan",
    label: "Planning",
    defaultSource: "live",
    beginner: "The model reads everything so far and decides what to do next. This box is active while the request is in flight.",
    advanced: "One model request carrying the full message history and tool schemas. What comes back is either text (an answer) or tool_use blocks (a plan to act). The model's private reasoning is not available and is not shown; the label 'planning' names the observable phase, not its content.",
    sourceNote: "Live: request size, latency, token usage and the response's stop reason are the API's own. Nothing about the model's internal reasoning is inferred.",
  },
  decision: {
    kind: "decision",
    label: "Decision",
    defaultSource: "live",
    beginner: "Did the model ask to use tools, or did it answer? That fork is the decision.",
    advanced: "Derived from the response content: tool_use blocks mean 'call tools' (in parallel when allowed), text alone means 'respond'. At the iteration or budget cap the lab forces a final answer.",
    sourceNote: "Live: read directly off the API response. The reason text is the lab describing that response, not the model's thoughts.",
  },
  approval: {
    kind: "approval",
    label: "Human Approval",
    defaultSource: "live",
    beginner: "A tool with real consequences waits for you to say yes or no before it runs.",
    advanced: "The runner suspends the call and holds a promise until the approval endpoint is hit or the timeout expires. A rejection is fed back to the model as the tool's result.",
    sourceNote: "Live: a real person decided, and how long they took is measured.",
  },
  tool: {
    kind: "tool",
    label: "Tool Call",
    defaultSource: "live",
    beginner: "The agent uses a tool: searching, calculating, running code, reading a database, saving a file, asking you.",
    advanced: "Arguments come from the model verbatim and are validated by the tool. Attempts, retries with exponential backoff, latency and the truncated result handed back are all recorded.",
    sourceNote: "Live for tools that really act (network, code, database, files, memory, human). Simulated for the external service, the flaky service and custom tools, which have no real backend.",
  },
  fallback: {
    kind: "fallback",
    label: "Fallback Tool",
    defaultSource: "live",
    beginner: "The first tool kept failing, so the agent tried the backup tool configured for it.",
    advanced: "After every retry failed the runner substitutes the configured fallback, carrying over matching arguments. The fallback's result is what the model sees.",
    sourceNote: "Follows the fallback tool's own label.",
  },
  observation: {
    kind: "observation",
    label: "Observation / State Update",
    defaultSource: "live",
    beginner: "Tool results are added to the conversation, so the next round of thinking can build on them. The agent's state is updated.",
    advanced: "Each result becomes a tool message with its call id. Context tokens, cumulative usage, error and retry counters and the memory/file lists are recomputed.",
    sourceNote: "Live: every number is a real count or measurement.",
  },
  response: {
    kind: "response",
    label: "Final Response",
    defaultSource: "live",
    beginner: "The agent writes its answer to your goal.",
    advanced: "A response with no tool calls ends the loop. Text streams as the provider sends it; the finish reason and usage are the API's.",
    sourceNote: "Live: the model's own words. With the offline planner the text is scripted and labelled a simulation.",
  },
  done: {
    kind: "done",
    label: "Task Completion",
    defaultSource: "live",
    beginner: "The run ends, and the lab says why: the agent finished, hit its limit, was stopped, or failed.",
    advanced: "Termination reasons: completed, max_iterations, token_budget, timeout, stopped, error. Totals for iterations, tool calls, errors, retries and tokens are final.",
    sourceNote: "Live: the real reason the loop ended.",
  },
};

/** How the observable phases read in the state panel. */
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  initializing: "Initializing",
  planning: "Planning",
  selecting_tool: "Selecting tool",
  awaiting_human: "Waiting for you",
  executing_tool: "Executing tool",
  evaluating_result: "Evaluating result",
  responding: "Responding",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  web: "Web",
  compute: "Compute",
  data: "Data",
  files: "Files",
  knowledge: "Knowledge",
  memory: "Memory",
  system: "System",
  external: "External",
  human: "Human",
  custom: "Custom",
};
