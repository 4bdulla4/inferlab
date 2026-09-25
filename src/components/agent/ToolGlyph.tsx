import type { ComponentType } from "react";
import { Bot, Brain, Calculator, CheckCircle2, Cpu, Database, FileText, Flag, GitFork, Globe, LifeBuoy, ListChecks, MessageSquare, Plug, Puzzle, ScrollText, Search, Target, UserCheck, Wrench, Eye, Send } from "lucide-react";
import type { ToolCategory } from "@shared/agent";
import type { AgentNodeKind } from "@/labs/agent/stages";

const CATEGORY_ICON: Record<ToolCategory, ComponentType<{ className?: string }>> = {
  web: Globe,
  compute: Calculator,
  data: Database,
  files: FileText,
  knowledge: Search,
  memory: Brain,
  system: Cpu,
  external: Plug,
  human: UserCheck,
  custom: Puzzle,
};

const KIND_ICON: Record<AgentNodeKind, ComponentType<{ className?: string }>> = {
  goal: Target,
  init: Bot,
  instructions: ScrollText,
  context: Brain,
  plan: Cpu,
  decision: GitFork,
  approval: UserCheck,
  tool: Wrench,
  fallback: LifeBuoy,
  observation: Eye,
  response: Send,
  done: Flag,
};

/** Icon for a graph node: the tool's category when it has one, otherwise the node kind. */
export function NodeGlyph({ kind, category, className }: { kind: AgentNodeKind; category?: ToolCategory; className?: string }) {
  const Icon = (kind === "tool" || kind === "fallback") && category ? CATEGORY_ICON[category] : KIND_ICON[kind];
  return <Icon className={className} aria-hidden="true" />;
}

export function ToolIcon({ category, className }: { category: ToolCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return <Icon className={className} aria-hidden="true" />;
}

export { CheckCircle2, ListChecks, MessageSquare };
