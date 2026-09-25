/**
 * Shared contract for the "analyze my agent's backend" feature: what the
 * server can honestly say about uploaded or fetched code without running it.
 *
 * Everything here is static analysis. Findings point at file and line so they
 * can be checked. The flow is *inferred* from the code and is labelled as such;
 * only a real run in the lab produces observed events.
 */
import type { UsageInfo } from "./llm";

export interface CodeFile {
  /** Relative path inside the upload or repository. */
  path: string;
  content: string;
}

export interface Evidence {
  file: string;
  line: number;
  /** The matching line, trimmed and with any secret-looking value redacted. */
  snippet: string;
}

export type Confidence = "high" | "medium" | "low";

export interface Finding {
  id: string;
  title: string;
  detail: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface DetectedTool {
  name: string;
  description: string | null;
  /** How it was declared, e.g. "@tool decorator", "Anthropic tool schema", "Vercel AI SDK tool()". */
  declaredWith: string;
  file: string;
  line: number;
  /** Best guess of what the tool does, from its name and description. */
  category: "web" | "compute" | "data" | "files" | "knowledge" | "memory" | "system" | "external" | "human" | "custom";
}

export interface DetectedModel {
  provider: string;
  models: string[];
  evidence: Evidence[];
}

export interface PromptExcerpt {
  file: string;
  line: number;
  /** First characters of the prompt text. */
  excerpt: string;
  role: "system" | "instructions" | "template";
}

export interface SecurityNote {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  file: string;
  line: number;
}

/** One step of how a request moves through the backend, in the lab's own vocabulary. */
export interface FlowStep {
  id: string;
  kind: "goal" | "init" | "instructions" | "context" | "plan" | "decision" | "tool" | "observation" | "response" | "done" | "approval" | "fallback";
  label: string;
  detail: string;
  evidence: Evidence[];
  /** True when the step is implied by the framework or by convention rather than seen in the code. */
  inferred: boolean;
  /** For tool steps. */
  tool?: string;
  category?: DetectedTool["category"];
  iteration?: number;
}

export interface ReportGraphNode {
  id: string;
  kind: FlowStep["kind"];
  label: string;
  sublabel?: string;
  iteration?: number;
  tool?: string;
  category?: DetectedTool["category"];
}

export interface ReportGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "flow" | "fallback" | "parallel";
}

export interface AgentBackendReport {
  source: {
    kind: "upload" | "github";
    name: string;
    files: number;
    bytes: number;
    /** Files skipped for size, type or location (node_modules and the like). */
    skipped: number;
    languages: Record<string, number>;
    truncated: boolean;
  };
  /** Whether this looks like an agent at all. */
  verdict: "agent" | "possible" | "not-agent";
  summary: string;
  frameworks: Finding[];
  models: DetectedModel[];
  tools: DetectedTool[];
  loop: Finding | null;
  prompts: PromptExcerpt[];
  memory: Finding[];
  retrieval: Finding[];
  resilience: Finding[];
  humanInLoop: Finding[];
  parallelism: Finding[];
  termination: Finding[];
  streaming: Finding[];
  observability: Finding[];
  entryPoints: Finding[];
  /** Environment variable names the code reads (names only, never values). */
  envVars: string[];
  security: SecurityNote[];
  flow: FlowStep[];
  graph: { nodes: ReportGraphNode[]; edges: ReportGraphEdge[] };
  narrative: { text: string; source: "ai" | "heuristic"; model?: string; usage?: UsageInfo | null };
  warnings: string[];
  analyzedAt: number;
  ms: number;
}

export interface AnalyzeCodeBody {
  files: CodeFile[];
  /** A display name for the upload, e.g. the folder name. */
  name?: string;
  /** Provider to write the narrative with; the report itself needs no model. */
  llmProvider?: string;
}

export interface AnalyzeRepoBody {
  url: string;
  llmProvider?: string;
}

export const CODE_ANALYSIS_LIMITS = {
  maxFiles: 600,
  maxFileBytes: 400 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxRepoFiles: 300,
};
