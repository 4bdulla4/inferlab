import type { AgentConfig, AgentEvent } from "@shared/agent";
import type { RepoAnalysis } from "@shared/repo";
import { DEFAULT_AGENT_CONFIG } from "../../../shared/agent";
import { INVESTIGATION_LIMITS } from "../../../shared/repo";
import { AgentRunner, type RunOutcome } from "../../agent/AgentRunner";
import { AgentSession } from "../../agent/session";
import type { AgentModel } from "../../agent/types";
import { buildIndex } from "../ai";
import { checkEvidence } from "./evidence";
import { buildInvestigatorTools } from "./tools";
import type { RepoWorkspace } from "./workspace";

export { RepoWorkspace } from "./workspace";
export { OfflineInvestigatorModel } from "./offlinePlanner";

/** Characters of scan index placed in the instructions. The rest is one get_facts call away. */
const INDEX_BUDGET = 14_000;

export function investigatorInstructions(analysis: RepoAnalysis): string {
  return `You are the investigator for the repository ${analysis.meta.fullName} at commit ${analysis.meta.sha.slice(0, 10)}. A static scan has already mapped it; its index is below. Answer the user's question about how this product works by reading the actual code.

How to work:
- Use the index to pick likely entry points (routes, modules, symbols), then follow the path through the code with search_code, find_symbol and read_file. Read a function's body before describing what it does; the index only says where things are.
- Ask for several independent tool calls in the same round when you can.
- search_code only covers loaded files. When the trail leads to a file that is not loaded, open it with read_file.
- Stop when you can answer, or when another read would not change the answer.

How to answer:
- Open with a direct answer in two to four sentences.
- Then list the steps in order as a numbered list. Each step has a short bold title, one or two sentences, and its evidence as path:line or path:start-end, with paths exactly as the tools print them.
- Cite only lines a tool result showed you. Code checks every citation after you answer and flags any you were never shown.
- If part of the flow is not in the code you could read, say so under a final "Gaps" heading rather than guessing.
- Secrets appear as <REDACTED>. Never try to infer or reconstruct them.

REPOSITORY INDEX (from the static scan)
${buildIndex(analysis, INDEX_BUDGET)}`;
}

export function investigatorConfig(provider: AgentConfig["llmProvider"], analysis: RepoAnalysis): AgentConfig {
  return {
    ...DEFAULT_AGENT_CONFIG,
    llmProvider: provider,
    tools: [],
    customTools: [],
    maxIterations: INVESTIGATION_LIMITS.maxIterations,
    parallelToolCalls: true,
    retry: { maxAttempts: 2, backoffMs: 400 },
    approvalRequired: [],
    fallbacks: {},
    ragKbId: null,
    tokenBudget: INVESTIGATION_LIMITS.tokenBudget,
    timeoutMs: INVESTIGATION_LIMITS.timeoutMs,
    temperature: 0.1,
    maxOutputTokens: 2048,
    systemPrompt: investigatorInstructions(analysis),
  };
}

export interface InvestigationOptions {
  runId: string;
  question: string;
  workspace: RepoWorkspace;
  model: AgentModel;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

/**
 * Runs the agent loop over the repository. The runner is the Agents lab's own,
 * so the run streams the same events and draws on the same graph. One event is
 * added: before the run completes, code checks every citation in the answer
 * against the repository and against what the agent was shown.
 */
export async function investigateRepository(o: InvestigationOptions): Promise<{ runner: AgentRunner; done: Promise<RunOutcome> }> {
  const { workspace: ws } = o;
  let answer = "";
  const emit = (e: AgentEvent) => {
    if (e.type === "final_response") answer = e.text;
    if (e.type === "run_completed" && answer) {
      const citations = checkEvidence(answer, ws);
      const verified = citations.filter((c) => c.status === "verified").length;
      o.emit({ type: "evidence_checked", at: Date.now(), citations, verified, total: citations.length });
      if (ws.redactions > 0) o.emit({ type: "notice", at: Date.now(), level: "info", message: `Redacted ${ws.redactions} line${ws.redactions === 1 ? "" : "s"} with credential-like values in the loaded files, so no tool could return them.` });
    }
    o.emit(e);
  };
  const runner = new AgentRunner({
    runId: o.runId,
    goal: o.question,
    config: investigatorConfig(o.model.id, ws.analysis),
    scenarioId: null,
    model: o.model,
    tools: buildInvestigatorTools(ws),
    session: emptySession(o.runId),
    keys: {},
    knowledgeBases: null,
    emit,
    signal: o.signal,
  });
  return { runner, done: runner.run() };
}

/** The runner expects a workspace session; an investigation has no memory or files of its own. */
function emptySession(runId: string): AgentSession {
  const session = new AgentSession(`investigation-${runId}`);
  session.files.clear();
  return session;
}
