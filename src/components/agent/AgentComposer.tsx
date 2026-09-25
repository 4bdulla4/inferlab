import { useState } from "react";
import { Loader2, Play, SlidersHorizontal, Sparkles } from "lucide-react";
import { AGENT_SCENARIOS } from "@shared/agent";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import { cn } from "@/lib/cn";
import { useAgentStore } from "@/store/agentStore";
import { useRagStore } from "@/store/ragStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge, SourceDot } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { agentConfigSummary } from "./AgentConfigDrawer";
import { AgentDescribe } from "./AgentDescribe";
import { Segmented } from "@/components/ui/Segmented";

/**
 * Where a run begins: pick a scenario or write a goal, glance at the tools the
 * agent will have, and press RUN. Settings live in a drawer so this stays small.
 */
export function AgentComposer({ className, onOpenSettings }: { className?: string; onOpenSettings: () => void }) {
  const goal = useAgentStore((s) => s.goal);
  const setGoal = useAgentStore((s) => s.setGoal);
  const scenarioId = useAgentStore((s) => s.scenarioId);
  const applyScenario = useAgentStore((s) => s.applyScenario);
  const config = useAgentStore((s) => s.config);
  const setConfig = useAgentStore((s) => s.setConfig);
  const status = useAgentStore((s) => s.status);
  const statusError = useAgentStore((s) => s.statusError);
  const starting = useAgentStore((s) => s.starting);
  const setStarting = useAgentStore((s) => s.setStarting);
  const startError = useAgentStore((s) => s.startError);
  const runs = useAgentStore((s) => s.runs);
  const activeRunId = useAgentStore((s) => s.activeRunId);
  const kb = useRagStore((s) => s.kb);
  const composerMode = useAgentStore((s) => s.composerMode);
  const setComposerMode = useAgentStore((s) => s.setComposerMode);
  const [showAll, setShowAll] = useState(false);

  const active = activeRunId ? runs[activeRunId] : undefined;
  const running = active?.status === "running";
  const provider = status?.providers.find((p) => p.id === config.llmProvider);
  const providerOk = Boolean(provider?.configured);
  const toolsById = new Map((status?.tools ?? []).map((t) => [t.id, t]));
  const enabledTools = config.tools.map((id) => toolsById.get(id) ?? config.customTools.find((c) => `custom:${c.slug}` === id) ?? null);
  const scenario = scenarioId ? AGENT_SCENARIOS.find((s) => s.id === scenarioId) : undefined;
  const kbReady = Boolean(kb && kb.documents.length > 0 && kb.index && !kb.stale);
  const kbBlocked = Boolean(scenario?.needsKnowledgeBase && !config.ragKbId);
  const canRun = goal.trim().length > 0 && !starting && !running && providerOk && !kbBlocked;

  const run = async () => {
    if (!canRun) return;
    setStarting(true);
    try {
      await agentRuntime.start(goal.trim(), config, scenarioId);
      setStarting(false);
    } catch (err) {
      setStarting(false, err instanceof Error ? err.message : "The run could not start.");
    }
  };

  const scenarios = showAll ? AGENT_SCENARIOS : AGENT_SCENARIOS.slice(0, 4);

  return (
    <GlassPanel
      className={className}
      title="Run an agent"
      subtitle={
        <span className="flex items-center gap-2 min-w-0">
          <Segmented<"scenarios" | "describe"> ariaLabel="How to set up the agent" size="sm" value={composerMode} onChange={setComposerMode} options={[{ value: "scenarios", label: "Scenarios" }, { value: "describe", label: "Describe your own" }]} />
          <span className="text-[11px] text-muted truncate hidden md:inline">{provider ? provider.name : statusError ? "service unavailable" : "connecting…"}</span>
        </span>
      }
      actions={
        <>
          <Button size="sm" variant="outline" icon={<SlidersHorizontal />} onClick={onOpenSettings} aria-haspopup="dialog" title={agentConfigSummary(config)}>
            Settings
          </Button>
          <SourceBadge source={config.llmProvider === "mock" ? "simulation" : "live"} compact />
        </>
      }
      bodyClassName="p-3.5 grid gap-2.5"
    >
      {composerMode === "describe" ? (
        <AgentDescribe onOpenSettings={onOpenSettings} />
      ) : (
        <>
      <div className="grid gap-1.5">
        <p className="label-caps flex items-center gap-2">
          Scenarios
          <button type="button" onClick={() => setShowAll((v) => !v)} className="ml-auto mono text-[10px] normal-case tracking-normal text-faint hover:text-muted">
            {showAll ? "fewer" : `all ${AGENT_SCENARIOS.length}`}
          </button>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => applyScenario(s.id)}
              aria-pressed={scenarioId === s.id}
              title={`${s.tagline} · teaches ${s.teaches.join(", ")}`}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] transition-colors", scenarioId === s.id ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink")}
            >
              {s.name}
              {s.needsKnowledgeBase ? <span className="mono text-[9.5px] text-faint">kb</span> : null}
            </button>
          ))}
          <button type="button" onClick={() => applyScenario(null)} aria-pressed={!scenarioId} className={cn("inline-flex h-7 items-center rounded-lg border px-2.5 text-[11.5px]", !scenarioId ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink")}>
            Custom
          </button>
        </div>
        {scenario ? <p className="text-[11px] leading-snug text-muted">{scenario.tagline} · teaches {scenario.teaches.join(", ")}</p> : null}
      </div>

      <form
        className="grid gap-2 min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <textarea
          value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
            if (scenario && e.target.value !== scenario.goal) applyScenario(null);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
          }}
          rows={3}
          maxLength={2000}
          placeholder="What should the agent accomplish? e.g. Find the population of Lahore and Karachi, then tell me the difference."
          aria-label="Agent goal"
          className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13.5px] leading-normal text-ink placeholder:text-faint focus:border-accent/60"
        />
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Button type="submit" variant="primary" icon={starting ? <Loader2 className="animate-spin" /> : <Play />} disabled={!canRun} className="min-w-[104px]">
            RUN
          </Button>
          <span className="mono text-[10.5px] text-muted">⌘/Ctrl + Enter</span>
          <div className="ml-auto flex flex-wrap items-center gap-1 justify-end">
            {enabledTools.slice(0, 7).map((t, i) =>
              t ? (
                <span key={"id" in t ? t.id : t.slug} className="mono inline-flex h-5 items-center gap-1 rounded-md border border-line px-1.5 text-[10px] text-ink-dim" title={"description" in t ? t.description : ""}>
                  <SourceDot source={"source" in t ? t.source : "simulation"} />
                  {"name" in t ? t.name : t.slug}
                </span>
              ) : (
                <span key={i} className="mono h-5 rounded-md border border-line px-1.5 text-[10px] text-faint">?</span>
              ),
            )}
            {enabledTools.length > 7 ? <Badge>+{enabledTools.length - 7}</Badge> : null}
            {enabledTools.length === 0 ? <Badge tone="warn">no tools</Badge> : null}
          </div>
        </div>
        <button type="button" onClick={onOpenSettings} className="mono text-left text-[10px] text-faint hover:text-muted truncate" title="Open agent settings">
          {agentConfigSummary(config)}
        </button>
        {!providerOk && provider ? (
          <p className="text-[11.5px] leading-snug text-warn">
            {provider.name} has no API key. Add one in Settings, or pick a configured provider in the agent settings.
            {status?.providers.some((p) => p.mock) ? (
              <>
                {" "}
                <button type="button" onClick={() => setConfig({ llmProvider: "mock" })} className="underline decoration-dotted hover:text-ink">
                  Use the offline planner
                </button>
                .
              </>
            ) : null}
          </p>
        ) : null}
        {kbBlocked ? (
          <p className="text-[11.5px] leading-snug text-warn">
            This scenario searches a knowledge base. {kbReady ? "Attach the RAG lab's knowledge base in the agent settings." : "Add documents in the RAG lab first, then attach the knowledge base in the agent settings."}
          </p>
        ) : null}
        {statusError ? <p className="text-[12px] leading-snug text-err">{statusError}</p> : null}
        {startError ? <p className="text-[12px] leading-snug text-err">{startError}</p> : null}
      </form>
      {!active ? (
        <p className="mono text-[10.5px] text-faint flex items-center gap-1.5">
          <Sparkles className="size-3" aria-hidden="true" />
          Every step below is driven by the real run: model calls, tool executions, timings and tokens.
        </p>
      ) : null}
        </>
      )}
    </GlassPanel>
  );
}
