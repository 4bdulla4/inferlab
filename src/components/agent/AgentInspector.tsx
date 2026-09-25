import { Pause, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { DataSource } from "@shared/llm";
import type { AgentStateSnapshot, MessageSummary } from "@shared/agent";
import type { NodeState } from "@/types/execution";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { AGENT_NODES, AGENT_STATUS_LABEL, TOOL_CATEGORY_LABEL } from "@/labs/agent/stages";
import type { AgentGraphNode, AgentRunState, AgentVisualState, ToolCallInfo } from "@/labs/agent/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { Badge } from "@/components/ui/Badge";
import { NodeGlyph } from "./ToolGlyph";

/** What the three panels are all looking at right now. */
export function useInspectedNode(run: AgentRunState | undefined) {
  const selected = useAgentStore((s) => s.selectedNodeId);
  const selectNode = useAgentStore((s) => s.selectNode);
  const visual = run?.visual;
  const nodeId = (selected && visual?.nodes.some((n) => n.id === selected) ? selected : null) ?? visual?.currentNodeId ?? null;
  const node = nodeId ? visual?.nodes.find((n) => n.id === nodeId) ?? null : null;
  const def = node ? AGENT_NODES[node.kind] : null;
  const state: NodeState = nodeId ? (visual?.nodeState[nodeId] ?? "idle") : "idle";
  const source: DataSource = nodeId ? (visual?.nodeSource[nodeId] ?? def?.defaultSource ?? "live") : "live";
  const call = node?.callId ? visual?.calls[node.callId] : undefined;
  const toggleFollow = useCallback(() => {
    if (selected) selectNode(null);
    else if (nodeId) selectNode(nodeId);
  }, [selected, nodeId, selectNode]);
  return { nodeId, node, def, state, source, call, pinned: Boolean(selected), toggleFollow, visual };
}

function FollowToggle({ pinned, onToggle, disabled }: { pinned: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pinned}
      title={pinned ? "Resume following the run" : "Hold this step still so it stops changing"}
      className={cn("mono inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] uppercase tracking-[0.1em] disabled:opacity-40 disabled:cursor-not-allowed", pinned ? "border-accent/50 bg-accent/10 text-accent-soft hover:border-accent" : "border-line text-ink-dim hover:border-line-strong hover:text-ink")}
    >
      {pinned ? <PlayCircle className="size-3" aria-hidden="true" /> : <Pause className="size-3" aria-hidden="true" />}
      {pinned ? "follow" : "hold"}
    </button>
  );
}

function NodeTitle({ node, state, reducedMotion }: { node: AgentGraphNode; state: NodeState; reducedMotion: boolean }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="text-[14px] inline-flex shrink-0"><StatusIcon state={state} spin={!reducedMotion} /></span>
      <NodeGlyph kind={node.kind} category={node.category} className="size-3.5 shrink-0 text-muted" />
      <span className="mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink truncate">{node.label}</span>
      <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted truncate">{NODE_STATE_LABEL[state]}</span>
    </span>
  );
}

/* ───────────────────────────── inspector ────────────────────────────── */

/** Explanation, the reason a tool was chosen, key facts and data source for the step in view. */
export function AgentInspectorPanel({ run, className }: { run: AgentRunState | undefined; className?: string }) {
  const mode = useUIStore((s) => s.mode);
  const reducedMotion = useReducedMotion();
  const { nodeId, node, def, state, source, call, pinned, toggleFollow, visual } = useInspectedNode(run);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pinned) bodyRef.current?.scrollTo({ top: 0 });
  }, [pinned, nodeId]);

  return (
    <GlassPanel
      bodyRef={bodyRef}
      title="Inspector"
      subtitle={node ? <NodeTitle node={node} state={state} reducedMotion={reducedMotion} /> : undefined}
      actions={
        <>
          {node ? <SourceBadge source={source} compact /> : null}
          <FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!nodeId} />
        </>
      }
      className={className}
      bodyClassName="px-3.5 py-3 grid gap-2.5 overflow-y-auto panel-scroll content-start"
    >
      {!node || !def || !visual ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Click any node in the graph or any row in the timeline to inspect it. While a run plays the inspector follows the newest step.</p>
      ) : (
        <>
          <div className="rounded-lg border border-line surface-1 p-3 grid gap-1">
            <p className="label-caps">What is happening?</p>
            <p className="text-[13px] leading-relaxed text-ink">{mode === "advanced" ? def.advanced : def.beginner}</p>
            {node.kind === "plan" ? <p className="text-[11px] leading-snug text-muted">The model's private reasoning is not available to this lab and is never invented. What you see is the observable phase and the response it produced.</p> : null}
          </div>
          {call && (node.kind === "tool" || node.kind === "fallback" || node.kind === "approval") ? <WhyThisTool call={call} node={node} /> : null}
          <NodeFacts node={node} visual={visual} call={call} />
          <div className="rounded-lg border border-line p-3 grid gap-1">
            <p className="label-caps">Data source</p>
            <p className="flex items-center gap-2 text-[12px] text-ink-dim">
              <SourceBadge source={source} />
              <span>{source === "live" ? "Observed from a real API, tool or person" : "Scripted planner, injected failure or a tool with no real backend"}</span>
            </p>
            <p className="text-[11.5px] leading-snug text-muted">{call && (node.kind === "tool" || node.kind === "fallback") ? call.tool.sourceNote : def.sourceNote}</p>
          </div>
          {visual.notices.length ? (
            <ul className="grid gap-1">
              {visual.notices.slice(-3).map((n) => (
                <li key={n.at + n.message} className={cn("text-[11px] leading-snug rounded-md border px-2.5 py-1.5", n.level === "warn" ? "border-warn/40 text-warn bg-warn/[0.06]" : "border-line text-muted")}>
                  {n.message}
                </li>
              ))}
            </ul>
          ) : null}
          {visual.error ? <p className="rounded-md border border-err/40 bg-err/[0.06] px-2.5 py-1.5 text-[11.5px] text-err whitespace-pre-wrap">{visual.error.message}</p> : null}
        </>
      )}
    </GlassPanel>
  );
}

/** The only "why" the lab can prove: what the model was offered, what it wrote, what it passed, and what it did not pick. */
function WhyThisTool({ call, node }: { call: ToolCallInfo; node: AgentGraphNode }) {
  const toolName = node.kind === "fallback" ? call.fallback?.to ?? call.name : call.name;
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/[0.04] p-3 grid gap-1.5">
      <p className="label-caps text-accent-soft">Why {toolName}?</p>
      {node.kind === "fallback" ? (
        <p className="text-[12px] leading-snug text-ink-dim">
          Not the model's choice: <span className="text-ink">{call.name}</span> failed every attempt ({call.fallback?.reason}), and the run's settings name <span className="text-ink">{toolName}</span> as its fallback.
        </p>
      ) : (
        <>
          <p className="text-[12px] leading-snug text-ink-dim">
            The model chose <span className="text-ink">{call.name}</span> from {call.rationale.alternatives.length + 1} tools it was offered. The description it saw:
          </p>
          <p className="rounded-md border border-line bg-bg-elevated/60 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-dim">{call.rationale.offeredDescription}</p>
          {call.rationale.modelText ? (
            <p className="text-[12px] leading-snug text-ink-dim">
              Alongside the call it wrote: <span className="text-ink">“{call.rationale.modelText.slice(0, 240)}{call.rationale.modelText.length > 240 ? "…" : ""}”</span>
            </p>
          ) : (
            <p className="text-[11.5px] leading-snug text-muted">It wrote no text alongside the call.</p>
          )}
          {call.rationale.alternatives.length ? <p className="text-[11px] leading-snug text-muted">Not chosen this time: {call.rationale.alternatives.join(", ")}.</p> : null}
        </>
      )}
    </div>
  );
}

/** The step's numbers: ids, counts, timings, straight from the events. */
function NodeFacts({ node, visual: v, call }: { node: AgentGraphNode; visual: AgentVisualState; call?: ToolCallInfo }) {
  const rows: [string, string][] = [];
  const push = (k: string, val: string | number | null | undefined) => {
    if (val !== undefined && val !== null && val !== "") rows.push([k, String(val)]);
  };
  const it = node.iteration !== undefined ? v.iterations[node.iteration] : undefined;
  switch (node.kind) {
    case "goal":
      push("characters", v.goal?.length);
      push("scenario", v.scenarioId ?? "custom");
      push("provider", v.config?.llmProvider);
      push("max iterations", v.config?.maxIterations);
      push("parallel tool calls", v.config ? (v.config.parallelToolCalls ? "allowed" : "one at a time") : undefined);
      break;
    case "init":
      push("provider", v.agent?.vendor);
      push("model", v.agent?.model);
      push("planner", v.agent?.mock ? "offline demo (simulation)" : "real model");
      push("tools offered", v.agent?.tools.length);
      v.agent?.tools.forEach((t) => push(t.name, `${TOOL_CATEGORY_LABEL[t.category]} · ${t.source}`));
      break;
    case "instructions":
      push("characters", v.instructions?.text.length);
      push("tokens (o200k_base)", v.instructions?.tokenEstimate);
      break;
    case "context":
      push("messages", v.context?.messages.length);
      push("context tokens", v.context?.tokenEstimate);
      push("memory entries", v.context?.memory.length);
      push("workspace files", v.context?.files.length);
      push("knowledge base", v.context?.knowledgeBase ? `${v.context.knowledgeBase.documents} docs · ${v.context.knowledgeBase.chunks} chunks` : "none attached");
      break;
    case "plan":
      push("iteration", node.iteration);
      push("messages sent", it?.request?.messages);
      push("context tokens (estimate)", it?.request?.tokenEstimate);
      push("tools offered", it?.request?.tools);
      push("answer only", it?.request?.forceText ? "yes, no tool calls allowed" : undefined);
      push("latency", it?.response ? formatMs(it.response.latencyMs) : undefined);
      push("first token", it?.response?.ttfbMs != null ? formatMs(it.response.ttfbMs) : undefined);
      push("input tokens", it?.response?.usage?.inputTokens ?? undefined);
      push("output tokens", it?.response?.usage?.outputTokens ?? undefined);
      push("stop reason", it?.response?.stopReason);
      push("tool calls", it?.response ? it.response.toolCalls.length : undefined);
      push("model", it?.response?.model);
      break;
    case "decision":
      push("iteration", node.iteration);
      push("kind", it?.decision?.kind.replace(/_/g, " "));
      push("tool calls", it?.decision?.toolCalls);
      push("parallel", it?.decision ? (it.decision.parallel ? "yes" : "no") : undefined);
      push("reason", it?.decision?.reason);
      break;
    case "approval":
      push("tool", call?.name);
      push("asked", call?.approval?.prompt);
      push("decision", call?.approval?.resolved ? (call.approval.resolved.timedOut ? "timed out" : call.approval.resolved.approved ? "approved" : "rejected") : "waiting");
      push("waited", call?.approval?.resolved ? formatMs(call.approval.resolved.waitedMs) : undefined);
      push("note", call?.approval?.resolved?.input ?? undefined);
      break;
    case "tool":
    case "fallback": {
      push("call id", call?.callId);
      push("iteration", call?.iteration);
      push("tool", node.kind === "fallback" ? call?.fallback?.to : call?.name);
      push("category", call?.tool.category ? TOOL_CATEGORY_LABEL[call.tool.category] : undefined);
      push("side effects", call?.tool.sideEffects ? "yes" : undefined);
      push("attempts", call?.attempts.length || undefined);
      push("retries", call ? Math.max(0, call.attempts.filter((a) => a.error && a.willRetry).length) || undefined : undefined);
      push("result", call?.result ? (call.result.ok ? "ok" : "failed") : undefined);
      push("latency", call?.result ? formatMs(call.result.latencyMs) : undefined);
      push("result chars", call?.result?.content.length);
      push("result tokens (estimate)", call?.observation?.tokenEstimate);
      push("truncated", call?.result?.truncated ? "yes" : undefined);
      push("note", call?.result?.note);
      break;
    }
    case "observation":
      push("iteration", node.iteration);
      push("tool results", it?.callIds.length);
      push("errors", it ? it.callIds.filter((id) => v.calls[id]?.result && !v.calls[id]!.result!.ok).length || undefined : undefined);
      push("context tokens after", v.snapshots[node.id]?.contextTokens);
      push("tokens used so far", v.snapshots[node.id]?.usage.totalTokens);
      break;
    case "response":
      push("characters", v.finalText.length || undefined);
      push("streamed pieces", v.finalPieces || undefined);
      push("iteration", v.final?.iteration);
      break;
    case "done":
      push("reason", v.completion?.reason.replace(/_/g, " "));
      push("iterations", v.completion?.iterations);
      push("tool calls", v.completion?.toolCalls);
      push("errors", v.completion?.errors);
      push("retries", v.completion?.retries);
      push("total time", v.completion ? formatMs(v.completion.totalMs) : undefined);
      push("tokens", v.completion ? `${formatNumber(v.completion.usage.inputTokens)} in · ${formatNumber(v.completion.usage.outputTokens)} out` : undefined);
      break;
  }
  if (rows.length === 0) return null;
  return (
    <dl className="rounded-lg border border-line p-3 grid gap-1 mono text-[11px]">
      {rows.map(([k, val], i) => (
        <div key={`${k}-${i}`} className="grid grid-cols-[150px_minmax(0,1fr)] gap-2 items-baseline">
          <dt className="text-muted truncate">{k}</dt>
          <dd className="text-ink-dim break-words">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─────────────────────────── step detail ────────────────────────────── */

/** The step's actual input and output: prompts, arguments, results, answers. */
export function AgentStepPanel({ run, className }: { run: AgentRunState | undefined; className?: string }) {
  const reducedMotion = useReducedMotion();
  const { nodeId, node, state, source, call, pinned, toggleFollow, visual } = useInspectedNode(run);
  return (
    <GlassPanel
      title="Step detail"
      subtitle={node ? <NodeTitle node={node} state={state} reducedMotion={reducedMotion} /> : undefined}
      actions={
        <>
          {node ? <SourceBadge source={source} compact /> : null}
          <FollowToggle pinned={pinned} onToggle={toggleFollow} disabled={!nodeId} />
        </>
      }
      className={className}
      bodyClassName="px-3.5 py-3 grid gap-2.5 content-start overflow-y-auto panel-scroll"
    >
      {!node || !visual ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Each step shows what went in and what came out here: the system prompt, the model's request and response, tool arguments and results, the final answer.</p>
      ) : (
        <StepDetail node={node} visual={visual} call={call} />
      )}
    </GlassPanel>
  );
}

function StepDetail({ node, visual: v, call }: { node: AgentGraphNode; visual: AgentVisualState; call?: ToolCallInfo }) {
  const it = node.iteration !== undefined ? v.iterations[node.iteration] : undefined;
  switch (node.kind) {
    case "goal":
      return (
        <div className="grid gap-2">
          <Block label="goal">
            <p className="text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap">{v.goal}</p>
          </Block>
          {v.config ? <Block label="run settings"><Mono>{`provider: ${v.config.llmProvider}\ntools: ${v.config.tools.join(", ") || "none"}\nmax iterations: ${v.config.maxIterations}\nparallel: ${v.config.parallelToolCalls}\nretries: ${v.config.retry.maxAttempts} attempts, ${v.config.retry.backoffMs} ms backoff\napprovals: ${v.config.approvalRequired.join(", ") || "none"}\nfallbacks: ${Object.entries(v.config.fallbacks).map(([a, b]) => `${a} → ${b}`).join(", ") || "none"}\ntoken budget: ${v.config.tokenBudget ?? "none"}`}</Mono></Block> : null}
        </div>
      );
    case "init":
      return v.agent ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="provider" value={v.agent.vendor} />
            <Tile label="model" value={v.agent.model} />
          </div>
          {v.agent.mock ? <p className="rounded-md border border-sim/40 bg-sim/[0.06] px-2.5 py-1.5 text-[11.5px] text-sim">Offline demo: a scripted planner picks the tools. Everything it says about itself is a simulation; the tools it calls are real.</p> : null}
          <Block label={`tools offered to the model (${v.agent.tools.length})`}>
            <ul className="grid gap-1">
              {v.agent.tools.map((t) => (
                <li key={t.id} className="rounded-md border border-line surface-1 px-2.5 py-1.5 grid gap-0.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="mono text-[11.5px] text-ink">{t.name}</span>
                    <Badge>{TOOL_CATEGORY_LABEL[t.category]}</Badge>
                    {t.sideEffects ? <Badge tone="warn">side effects</Badge> : null}
                    <SourceBadge source={t.source} compact className="ml-auto" />
                  </span>
                  <span className="text-[11px] leading-snug text-muted line-clamp-2">{t.description}</span>
                </li>
              ))}
            </ul>
          </Block>
        </div>
      ) : (
        <Empty>Waiting for the agent to initialize.</Empty>
      );
    case "instructions":
      return v.instructions ? <Block label={`system prompt · ${v.instructions.tokenEstimate} tokens`}><Mono>{v.instructions.text}</Mono></Block> : <Empty>The system prompt appears here.</Empty>;
    case "context":
      return v.context ? (
        <div className="grid gap-2">
          <Messages messages={v.context.messages} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Block label={`memory (${v.context.memory.length})`}>{v.context.memory.length ? <ul className="grid gap-1">{v.context.memory.map((m) => <li key={m.key} className="mono text-[11px] text-ink-dim break-words"><span className="text-ink">{m.key}</span>: {m.value}</li>)}</ul> : <Empty>Nothing remembered yet.</Empty>}</Block>
            <Block label={`workspace files (${v.context.files.length})`}>{v.context.files.length ? <ul className="grid gap-0.5">{v.context.files.map((f) => <li key={f} className="mono text-[11px] text-ink-dim">{f}</li>)}</ul> : <Empty>Empty.</Empty>}</Block>
          </div>
          {v.context.knowledgeBase ? <p className="mono text-[11px] text-muted">knowledge base {v.context.knowledgeBase.id} · {v.context.knowledgeBase.documents} documents · {v.context.knowledgeBase.chunks} chunks</p> : null}
        </div>
      ) : (
        <Empty>Context loads here.</Empty>
      );
    case "plan":
      return it ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="messages in" value={it.request ? String(it.request.messages) : "—"} />
            <Tile label="context tokens" value={it.request ? `~${it.request.tokenEstimate}` : "—"} />
            <Tile label="latency" value={it.response ? formatMs(it.response.latencyMs) : it.request ? "…" : "—"} />
            <Tile label="in / out tokens" value={it.response?.usage ? `${it.response.usage.inputTokens ?? "?"} / ${it.response.usage.outputTokens ?? "?"}` : "—"} />
          </div>
          {it.response ? (
            <>
              <Block label={`response · stop reason ${it.response.stopReason}`}>
                {it.response.text ? <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap break-words">{it.response.text}</p> : <Empty>No text in this response; only tool calls.</Empty>}
              </Block>
              {it.response.toolCalls.length ? (
                <Block label={`tool calls requested (${it.response.toolCalls.length})`}>
                  <ul className="grid gap-1">
                    {it.response.toolCalls.map((c) => (
                      <li key={c.id} className="rounded-md border border-line surface-1 px-2.5 py-1.5">
                        <span className="mono text-[11.5px] text-ink">{c.name}</span>
                        <Mono small>{JSON.stringify(c.args, null, 2)}</Mono>
                      </li>
                    ))}
                  </ul>
                </Block>
              ) : null}
            </>
          ) : it.streamText ? (
            <Block label={`response so far · ${it.streamPieces ?? 0} pieces`}>
              <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap break-words">
                {it.streamText}
                <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" />
              </p>
            </Block>
          ) : (
            <p className="shimmer-text mono text-[12px]">the model is working on it…</p>
          )}
        </div>
      ) : (
        <Empty>Planning details appear here.</Empty>
      );
    case "decision":
      return it?.decision ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="decision" value={it.decision.kind.replace(/_/g, " ")} />
            <Tile label="tool calls" value={String(it.decision.toolCalls)} />
            <Tile label="parallel" value={it.decision.parallel ? "yes" : "no"} />
          </div>
          <Block label="how the lab read the response">
            <p className="text-[12.5px] leading-relaxed text-ink-dim">{it.decision.reason}</p>
          </Block>
        </div>
      ) : (
        <Empty>The decision appears once the model responds.</Empty>
      );
    case "approval":
      return call?.approval ? (
        <div className="grid gap-2">
          <Block label="asked of you">
            <p className="text-[13px] text-ink">{call.approval.prompt}</p>
          </Block>
          <Block label="arguments the tool would run with"><Mono>{JSON.stringify(call.args, null, 2)}</Mono></Block>
          <Block label="outcome">
            <p className="text-[12.5px] text-ink-dim">{call.approval.resolved ? (call.approval.resolved.timedOut ? "No decision arrived before the timeout, so the call was not made." : call.approval.resolved.approved ? `Approved after ${formatMs(call.approval.resolved.waitedMs)}.` : `Rejected after ${formatMs(call.approval.resolved.waitedMs)}${call.approval.resolved.input ? `: ${call.approval.resolved.input}` : "."}`) : "Waiting for your decision in the bar below the graph."}</p>
          </Block>
        </div>
      ) : (
        <Empty>Approval details appear here.</Empty>
      );
    case "tool":
    case "fallback":
      return call ? <ToolDetail call={call} fallback={node.kind === "fallback"} /> : <Empty>Tool details appear here.</Empty>;
    case "observation":
      return it ? (
        <div className="grid gap-2">
          <Block label={`results added to the context (${it.callIds.length})`}>
            <ul className="grid gap-1">
              {it.callIds.map((id) => {
                const c = v.calls[id];
                if (!c) return null;
                return (
                  <li key={id} className={cn("rounded-md border px-2.5 py-1.5 grid gap-0.5", c.result && !c.result.ok ? "border-err/40 bg-err/[0.04]" : "border-line surface-1")}>
                    <span className="flex items-center gap-2"><span className="mono text-[11.5px] text-ink">{c.completedTool ?? c.name}</span>{c.result ? <SourceBadge source={c.result.source} compact className="ml-auto" /> : <span className="mono text-[10px] text-muted ml-auto">pending</span>}</span>
                    <span className="mono text-[11px] text-muted truncate">{c.observation?.summary ?? c.result?.content.split("\n")[0] ?? "…"}</span>
                    {c.observation ? <span className="mono text-[10px] text-faint">{c.observation.chars} chars · ~{c.observation.tokenEstimate} tokens</span> : null}
                  </li>
                );
              })}
            </ul>
          </Block>
          {v.snapshots[node.id] ? <Messages messages={v.snapshots[node.id]!.messages} /> : null}
        </div>
      ) : (
        <Empty>Observations appear here.</Empty>
      );
    case "response":
      return <AnswerText text={v.finalText} streaming={!v.final && !v.error && !v.stopped} source={v.final?.source} />;
    case "done":
      return v.completion ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Tile label="reason" value={v.completion.reason.replace(/_/g, " ")} />
            <Tile label="iterations" value={String(v.completion.iterations)} />
            <Tile label="tool calls" value={String(v.completion.toolCalls)} />
            <Tile label="errors / retries" value={`${v.completion.errors} / ${v.completion.retries}`} />
            <Tile label="total time" value={formatMs(v.completion.totalMs)} />
            <Tile label="tokens" value={formatNumber(v.completion.usage.totalTokens)} />
          </div>
          <AnswerText text={v.finalText} streaming={false} source={v.final?.source} />
        </div>
      ) : (
        <Empty>The completion summary appears here.</Empty>
      );
  }
}

function ToolDetail({ call, fallback }: { call: ToolCallInfo; fallback: boolean }) {
  const attempts = fallback ? call.attempts.filter((a) => a.tool === call.fallback?.to) : call.attempts.filter((a) => a.tool === call.name);
  const showResult = fallback ? call.completedTool === call.fallback?.to : call.completedTool === call.name || (!call.fallback && call.result);
  return (
    <div className="grid gap-2">
      <Block label={`arguments from the model → ${fallback ? call.fallback?.to : call.name}`}>
        <Mono>{JSON.stringify(call.args, null, 2)}</Mono>
      </Block>
      {attempts.length ? (
        <Block label={`attempts (${attempts.length})`}>
          <ul className="grid gap-1">
            {attempts.map((a) => (
              <li key={`${a.tool}-${a.attempt}`} className={cn("mono text-[11px] rounded-md border px-2.5 py-1.5", a.error ? "border-err/40 text-err bg-err/[0.04]" : "border-line text-ink-dim surface-1")}>
                attempt {a.attempt} of {a.maxAttempts}: {a.error ? `${a.error}${a.willRetry ? ` · retrying in ${formatMs(a.retryInMs ?? 0)}` : ""}` : showResult && call.result ? (call.result.ok ? "succeeded" : "returned an error") : "running…"}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {call.fallback && !fallback ? <p className="rounded-md border border-warn/40 bg-warn/[0.06] px-2.5 py-1.5 text-[11.5px] text-warn">Every attempt failed; the run fell back to {call.fallback.to}. Its result is on the fallback node.</p> : null}
      {showResult && call.result ? (
        <Block label={`result · ${call.result.ok ? "ok" : "error"} · ${formatMs(call.result.latencyMs)}${call.result.truncated ? " · truncated" : ""}`} trailing={<SourceBadge source={call.result.source} compact />}>
          <Mono>{call.result.content}</Mono>
          <p className="text-[10.5px] leading-snug text-muted mt-1">{call.result.note}</p>
        </Block>
      ) : !call.result ? (
        <p className="shimmer-text mono text-[12px]">{call.approval && !call.approval.resolved ? "waiting for you…" : "running…"}</p>
      ) : null}
      {call.tool.category === "human" && call.approval?.resolved?.input ? (
        <Block label="your answer">
          <p className="text-[13px] text-ink">{call.approval.resolved.input}</p>
        </Block>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── agent state ────────────────────────────── */

/** The complete agent state after the step in view (or the latest, when following). */
export function AgentStatePanel({ run, className }: { run: AgentRunState | undefined; className?: string }) {
  const { nodeId, visual, pinned } = useInspectedNode(run);
  const snap: AgentStateSnapshot | null = (pinned && nodeId ? visual?.snapshots[nodeId] ?? nearestSnapshot(visual, nodeId) : visual?.snapshot) ?? null;
  const status = snap ? AGENT_STATUS_LABEL[snap.status] : run ? "Starting" : "Idle";
  const tone = snap?.status === "failed" ? "err" : snap?.status === "awaiting_human" ? "warn" : snap?.status === "completed" ? "ok" : run?.status === "running" ? "live" : "neutral";
  return (
    <GlassPanel
      title="Agent state"
      subtitle={snap ? (pinned ? "after the selected step" : "live") : undefined}
      actions={<Badge tone={tone}>{status}</Badge>}
      className={className}
      bodyClassName="px-3.5 py-3 grid gap-2.5 content-start overflow-y-auto panel-scroll"
    >
      {!snap ? (
        <p className="text-[12.5px] leading-relaxed text-muted">Goal, iteration, context, tools, memory, tokens, latency, errors and retries: the agent's complete state after every step.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="iteration" value={`${snap.iteration} / ${snap.maxIterations}`} />
            <Tile label="tokens" value={formatNumber(snap.usage.totalTokens)} hint={`${formatNumber(snap.usage.inputTokens)} in · ${formatNumber(snap.usage.outputTokens)} out`} />
            <Tile label="context" value={`~${formatNumber(snap.contextTokens)}`} hint="tokens the next call reads" />
            <Tile label="model time" value={formatMs(snap.modelMs)} />
            <Tile label="tool time" value={formatMs(snap.toolMs)} />
            <Tile label="calls · errors · retries" value={`${snap.toolCalls} · ${snap.errors} · ${snap.retries}`} />
          </div>
          {snap.pendingApproval ? <p className="rounded-md border border-warn/40 bg-warn/[0.06] px-2.5 py-1.5 text-[11.5px] text-warn">Waiting for you on {snap.pendingApproval.tool}.</p> : null}
          <Block label="tools">
            <div className="flex flex-wrap gap-1">
              {snap.availableTools.map((t) => (
                <span key={t} className={cn("mono rounded-md border px-1.5 h-5 inline-flex items-center text-[10.5px]", snap.selectedTools.includes(t) ? "border-live/50 text-live bg-live/10" : "border-line text-muted")}>
                  {t}
                </span>
              ))}
              {snap.availableTools.length === 0 ? <Empty>none</Empty> : null}
            </div>
            {snap.lastTool ? <p className="mono text-[10.5px] text-muted mt-1 truncate">last: {snap.lastTool.name} · {snap.lastTool.ok ? "ok" : "failed"} · {snap.lastTool.preview.split("\n")[0]}</p> : null}
          </Block>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Block label={`memory (${snap.memory.length})`}>{snap.memory.length ? <ul className="grid gap-0.5">{snap.memory.map((m) => <li key={m.key} className="mono text-[11px] text-ink-dim break-words line-clamp-2"><span className="text-ink">{m.key}</span>: {m.value}</li>)}</ul> : <Empty>empty</Empty>}</Block>
            <Block label={`files (${snap.files.length})`}>{snap.files.length ? <ul className="grid gap-0.5">{snap.files.map((f) => <li key={f} className="mono text-[11px] text-ink-dim">{f}</li>)}</ul> : <Empty>empty</Empty>}</Block>
          </div>
          <Messages messages={snap.messages} />
        </>
      )}
    </GlassPanel>
  );
}

/** When a node has no snapshot of its own, the closest earlier one still describes the state it saw. */
function nearestSnapshot(v: AgentVisualState | undefined, nodeId: string): AgentStateSnapshot | undefined {
  if (!v) return undefined;
  const idx = v.nodes.findIndex((n) => n.id === nodeId);
  for (let i = idx; i >= 0; i--) {
    const snap = v.snapshots[v.nodes[i]!.id];
    if (snap) return snap;
  }
  return undefined;
}

/* ─────────────────────────────── bits ───────────────────────────────── */

function Messages({ messages }: { messages: MessageSummary[] }) {
  const ROLE: Record<MessageSummary["role"], string> = { system: "border-line text-muted", user: "border-accent/40 text-accent-soft", assistant: "border-live/40 text-live", tool: "border-ok/40 text-ok" };
  return (
    <Block label={`context · ${messages.length} message${messages.length === 1 ? "" : "s"} · ~${messages.reduce((n, m) => n + m.tokenEstimate, 0)} tokens`}>
      <ol className="grid gap-1">
        {messages.map((m, i) => (
          <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-line surface-1 px-2 py-1">
            <span className={cn("mono mt-0.5 inline-flex h-4 items-center justify-center rounded border text-[9.5px] uppercase tracking-wider", ROLE[m.role])}>{m.role}</span>
            <span className="text-[11.5px] leading-snug text-ink-dim break-words line-clamp-2">{m.preview || (m.toolCalls?.length ? `→ ${m.toolCalls.join(", ")}` : "(empty)")}</span>
            <span className="mono text-[10px] text-faint whitespace-nowrap">~{m.tokenEstimate} tok</span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

function Block({ label, children, trailing }: { label: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-bg-elevated/60 p-2.5 grid gap-1.5 min-w-0">
      <p className="label-caps flex items-center gap-2">
        <span className="truncate">{label}</span>
        {trailing ? <span className="ml-auto">{trailing}</span> : null}
      </p>
      {children}
    </div>
  );
}

function Mono({ children, small }: { children: string; small?: boolean }) {
  return <pre className={cn("mono leading-relaxed text-ink-dim whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto panel-scroll", small ? "text-[10.5px]" : "text-[11px]")}>{children}</pre>;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line surface-1 px-2.5 py-2 min-w-0">
      <p className="label-caps text-[9.5px]">{label}</p>
      <p className="mono text-[13px] text-ink truncate mt-0.5">{value}</p>
      {hint ? <p className="mono text-[9.5px] text-faint truncate">{hint}</p> : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mono text-[11px] text-muted">{children}</p>;
}

export function AnswerText({ text, streaming, source }: { text: string; streaming: boolean; source?: DataSource }) {
  return (
    <div className={cn("rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words min-h-[44px]", streaming ? "border-live/30 bg-live/[0.04]" : source === "simulation" ? "border-sim/30 bg-sim/[0.05]" : "border-accent/25 bg-accent/[0.05]")}>
      {text ? text : streaming ? <span className="shimmer-text mono text-[12px]">waiting for the model…</span> : <span className="mono text-[11px] text-muted">The answer streams here.</span>}
      {streaming && text ? <span className="inline-block w-[2px] h-[1em] align-[-0.15em] bg-live ml-0.5 animate-pulse" aria-hidden="true" /> : null}
    </div>
  );
}
