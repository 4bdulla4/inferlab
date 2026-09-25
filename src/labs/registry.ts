import type { ComponentType } from "react";

export type LabId = "llm" | "pipelines" | "repo" | "history" | "settings" | "rag" | "ml" | "agents";

export interface LabDefinition {
  id: LabId;
  name: string;
  title: string;
  description: string;
  status: "active" | "coming-soon";
  /** Dashboard component. Each lab owns its visualizer but shares the event/playback engine. */
  Dashboard?: ComponentType;
}

/**
 * Registry of labs. V1 ships the LLM lab; the others are placeholders wired to
 * the same shell so they can plug into the shared event, store and animation
 * systems later.
 */
export const LABS: LabDefinition[] = [
  {
    id: "history",
    name: "Dashboard",
    title: "Usage Dashboard",
    description: "Everything analyzed and every model call, with token usage over time.",
    status: "active",
  },
  {
    id: "pipelines",
    name: "Pipelines",
    title: "Provider Pipelines",
    description: "How the Claude, OpenAI and Gemini request paths actually differ, stage by stage.",
    status: "active",
  },
  {
    id: "repo",
    name: "GitHub Analyzer",
    title: "GitHub Product Analyzer",
    description: "Scan a public repository and see how the product works end to end.",
    status: "active",
  },
  {
    id: "llm",
    name: "LLM",
    title: "LLM Visualizer",
    description: "Watch a language-model request execute from input to response.",
    status: "active",
  },
  {
    id: "settings",
    name: "Settings",
    title: "Settings",
    description: "API keys, provider capabilities, appearance and where your data is kept.",
    status: "active",
  },
  {
    id: "rag",
    name: "RAG",
    title: "RAG Visualizer",
    description: "Upload documents and watch retrieval-augmented generation run: chunks, vectors, search, context and a cited answer.",
    status: "active",
  },
  {
    id: "ml",
    name: "ML",
    title: "ML Engineering Lab",
    description: "Upload a table and watch a model train for real: cleaning, encoding, splitting, the loss falling, weights moving, trees growing, then a scored, saved model you can query.",
    status: "active",
  },
  {
    id: "agents",
    name: "Agents",
    title: "Agent Engineering Lab",
    description: "Run an agent and watch it plan, pick tools, act, observe and answer, step by real step.",
    status: "active",
  },
];
