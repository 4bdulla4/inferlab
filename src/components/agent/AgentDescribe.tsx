import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Play, Sparkles, Wand2 } from "lucide-react";
import type { BlueprintTool } from "@shared/agent";
import { describeAgent } from "@/api/agentClient";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import { TOOL_CATEGORY_LABEL } from "@/labs/agent/stages";
import { cn } from "@/lib/cn";
import { useAgentStore } from "@/store/agentStore";
import { useRagStore } from "@/store/ragStore";
import { useUIStore } from "@/store/uiStore";
import { SourceBadge, SourceDot } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ToolIcon } from "./ToolGlyph";

const EXAMPLES = [
  "Find out when the Eiffel Tower was built and how many years ago that was",
  "Check the weather in Lahore and save a short note about it to a file",
  "Which product category made the most money in the orders database? Write a report",
  "Ask me which city I'm in, then tell me one interesting fact about it",
  "Remember my favourite colour is green, and send me a message confirming it",
];

/**
 * Describe the agent in ordinary words; the analyzer turns it into a plan you
 * can read, adjust and run. Every tool it picks shows the words that earned it,
 * anything it cannot do for real is named, and the run itself is the proof.
 */
export function AgentDescribe({ onOpenSettings }: { onOpenSettings: () => void }) {
  const description = useAgentStore((s) => s.description);
  const setDescription = useAgentStore((s) => s.setDescription);
  const blueprint = useAgentStore((s) => s.blueprint);
  const setBlueprint = useAgentStore((s) => s.setBlueprint);
  const applyBlueprint = useAgentStore((s) => s.applyBlueprint);
  const config = useAgentStore((s) => s.config);
  const status = useAgentStore((s) => s.status);
  const setStarting = useAgentStore((s) => s.setStarting);
  const starting = useAgentStore((s) => s.starting);
  const kb = useRagStore((s) => s.kb);
  const mode = useUIStore((s) => s.mode);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const result = blueprint.result;
  const stale = Boolean(result && blueprint.forDescription !== description.trim());
  const provider = status?.providers.find((p) => p.id === config.llmProvider);
  const toolsById = useMemo(() => new Map((status?.tools ?? []).map((t) => [t.id, t])), [status]);

  useEffect(() => {
    if (!result) return;
    setEnabled(Object.fromEntries(result.tools.map((t) => [t.id, t.confidence >= 0.5 || t.from === "both"])));
  }, [result]);

  const analyze = async () => {
    const text = description.trim();
    if (!text) return;
    setBlueprint({ loading: true, error: null });
    try {
      const r = await describeAgent({ description: text, llmProvider: config.llmProvider }, config.ragKbId);
      setBlueprint({ loading: false, result: r.blueprint, hits: r.hits, forDescription: text });
    } catch (err) {
      setBlueprint({ loading: false, error: err instanceof Error ? err.message : "The description could not be analyzed." });
    }
  };

  const chosenIds = result ? result.tools.filter((t) => enabled[t.id]).map((t) => t.id) : [];
  const kbReady = Boolean(kb && kb.documents.length > 0 && kb.index && !kb.stale);
  const needsKb = chosenIds.includes("rag_retrieve");
  const kbBlocked = needsKb && !config.ragKbId;
  const providerOk = Boolean(provider?.configured);

  const useAndRun = async () => {
    if (!result) return;
    applyBlueprint(result, chosenIds);
    if (kbBlocked || !providerOk) return;
    setStarting(true);
    try {
      const s = useAgentStore.getState();
      await agentRuntime.start(s.goal, s.config, null);
      setStarting(false);
    } catch (err) {
      setStarting(false, err instanceof Error ? err.message : "The run could not start.");
    }
  };

  return (
    <div className="grid gap-2.5 min-w-0">
      <form
        className="grid gap-2 min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          void analyze();
        }}
      >
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void analyze();
          }}
          rows={3}
          maxLength={2000}
          placeholder="Describe what your agent should do, in your own words. Spelling does not have to be perfect."
          aria-label="Describe your agent"
          className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13.5px] leading-normal text-ink placeholder:text-faint focus:border-accent/60"
        />
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Button type="submit" variant="primary" icon={blueprint.loading ? <Loader2 className="animate-spin" /> : <Wand2 />} disabled={!description.trim() || blueprint.loading} className="min-w-[124px]">
            {result && !stale ? "Analyze again" : "Analyze"}
          </Button>
          <span className="mono text-[10.5px] text-muted">⌘/Ctrl + Enter</span>
          <span className="ml-auto mono text-[10px] text-faint hidden sm:inline">
            rules always run · {provider && provider.configured && !provider.mock ? `${provider.name} refines, code validates` : "add a key for model refinement"}
          </span>
        </div>
        {!description.trim() ? (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setDescription(ex)} className="rounded-lg border border-line px-2.5 h-7 text-[11.5px] text-ink-dim hover:border-line-strong hover:text-ink truncate max-w-full">
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        {blueprint.error ? <p className="text-[12px] leading-snug text-err">{blueprint.error}</p> : null}
      </form>

      {result ? (
        <div className={cn("rounded-xl border p-3 grid gap-2.5 min-w-0", stale ? "border-line opacity-70" : "border-accent/35 bg-accent/[0.04]")}>
          <div className="flex flex-wrap items-start gap-2 min-w-0">
            <Sparkles className="size-4 shrink-0 mt-0.5 text-accent-soft" aria-hidden="true" />
            <div className="min-w-0 flex-1 grid gap-0.5">
              <p className="text-[13px] leading-snug text-ink">{result.summary}</p>
              <p className="mono text-[10.5px] text-muted">
                goal → <span className="text-ink-dim">{result.goal}</span>
              </p>
            </div>
            <span className="flex items-center gap-1.5 shrink-0">
              {result.source === "ai+rules" ? <Badge tone="live">rules + {result.model ?? "model"}</Badge> : <Badge>rules only</Badge>}
              {stale ? <Badge tone="warn">description changed</Badge> : null}
            </span>
          </div>

          <div className="grid gap-1.5">
            <p className="label-caps">Tools it will get · untick any you do not want</p>
            {result.tools.length === 0 ? <p className="mono text-[11px] text-muted">None. The agent will answer from the model alone.</p> : null}
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {result.tools.map((t) => (
                <ToolRow key={t.id} tool={t} descriptor={toolsById.get(t.id)} checked={Boolean(enabled[t.id])} onToggle={(v) => setEnabled((e) => ({ ...e, [t.id]: v }))} gated={result.approvalRequired.includes(t.id)} fallbackTo={result.fallbacks[t.id]} />
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-1.5 mono text-[10.5px]">
            <Badge>{result.maxIterations} iterations</Badge>
            <Badge>{result.parallelToolCalls ? "parallel tools" : "one tool at a time"}</Badge>
            <Badge>{result.retry.maxAttempts} attempt{result.retry.maxAttempts === 1 ? "" : "s"} per call</Badge>
            {result.approvalRequired.length ? <Badge tone="warn">asks you before {result.approvalRequired.join(", ")}</Badge> : null}
            {result.needsKnowledgeBase ? <Badge tone={config.ragKbId ? "ok" : "warn"}>{config.ragKbId ? "knowledge base attached" : "needs your documents"}</Badge> : null}
          </div>

          {result.constraints.length ? (
            <div className="grid gap-1">
              <p className="label-caps">Instructions it read from your words</p>
              <ul className="grid gap-0.5">
                {result.constraints.map((c) => (
                  <li key={c} className="text-[12px] text-ink-dim flex items-start gap-1.5">
                    <Check className="size-3 mt-0.5 shrink-0 text-ok" aria-hidden="true" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.gaps.length ? (
            <div className="grid gap-1 rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5">
              <p className="label-caps text-warn flex items-center gap-1.5">
                <AlertTriangle className="size-3" aria-hidden="true" />
                Cannot be done for real here
              </p>
              <ul className="grid gap-1">
                {result.gaps.map((g) => (
                  <li key={g.capability} className="text-[12px] leading-snug text-ink-dim">
                    <span className="text-ink">{g.capability}</span>
                    {g.evidence.length ? <span className="mono text-[10px] text-muted"> · from “{g.evidence.join("”, “")}”</span> : null}
                    <span className="block text-[11px] text-muted">{g.suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.warnings.map((w) => (
            <p key={w} className="text-[11.5px] leading-snug text-muted flex items-start gap-1.5">
              <span className="mt-[5px] size-1.5 rounded-full bg-line-strong shrink-0" aria-hidden="true" />
              {w}
            </p>
          ))}

          {mode === "advanced" ? (
            <details className="rounded-lg border border-line p-2.5 text-[11px]">
              <summary className="cursor-pointer label-caps">How the analyzer scored it</summary>
              <div className="mt-2 grid gap-1 mono text-[10.5px] text-muted">
                {blueprint.hits.length ? blueprint.hits.map((h) => <span key={h.capability}>{h.capability}: {h.score}</span>) : <span>no capability words matched</span>}
                {result.systemPrompt ? <pre className="mt-1 whitespace-pre-wrap text-ink-dim">{result.systemPrompt}</pre> : null}
                {result.usage ? <span>model refinement used {result.usage.totalTokens ?? "?"} tokens</span> : null}
              </div>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" icon={starting ? <Loader2 className="animate-spin" /> : <Play />} disabled={starting || stale || kbBlocked || !providerOk} onClick={() => void useAndRun()}>
              Use this plan and run
            </Button>
            <Button variant="outline" disabled={stale} onClick={() => applyBlueprint(result, chosenIds)}>
              Use plan only
            </Button>
            <Button variant="ghost" size="sm" onClick={onOpenSettings}>
              Fine-tune in settings
            </Button>
            {kbBlocked ? <span className="text-[11.5px] text-warn">{kbReady ? "Attach the knowledge base in settings first." : "Add documents in the RAG lab, then attach the knowledge base."}</span> : null}
            {!providerOk ? <span className="text-[11.5px] text-warn">Pick a configured provider in settings before running.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ tool, descriptor, checked, onToggle, gated, fallbackTo }: { tool: BlueprintTool; descriptor?: { name: string; category: keyof typeof TOOL_CATEGORY_LABEL; source: "live" | "simulation"; description: string; available: boolean; unavailableReason?: string }; checked: boolean; onToggle: (v: boolean) => void; gated: boolean; fallbackTo?: string }) {
  const name = descriptor?.name ?? tool.id;
  return (
    <li className={cn("rounded-lg border px-2.5 py-2 grid gap-1 min-w-0", checked ? "border-line-strong surface-1" : "border-line opacity-70")}>
      <label className="flex items-center gap-2 min-w-0 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="accent-[var(--color-accent)]" aria-label={`Use ${name}`} />
        {descriptor ? <ToolIcon category={descriptor.category} className="size-3.5 shrink-0 text-muted" /> : null}
        <span className="mono text-[12px] text-ink truncate">{name}</span>
        {gated ? <Badge tone="warn">asks you</Badge> : null}
        {fallbackTo ? <Badge>→ {fallbackTo}</Badge> : null}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="mono text-[9.5px] uppercase tracking-wider text-faint" title="who chose it">{tool.from === "both" ? "rules + model" : tool.from}</span>
          {descriptor ? <SourceDot source={descriptor.source} /> : null}
        </span>
      </label>
      <div className="h-1 rounded-full surface-2 overflow-hidden" aria-label={`confidence ${Math.round(tool.confidence * 100)}%`}>
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.round(tool.confidence * 100)}%` }} />
      </div>
      <p className="text-[11px] leading-snug text-muted">
        {tool.reason}
        {tool.evidence.length ? (
          <span className="text-faint">
            {" "}
            · because you wrote “{tool.evidence.slice(0, 4).join("”, “")}”
          </span>
        ) : null}
      </p>
      {descriptor && !descriptor.available ? <p className="text-[10.5px] text-warn">{descriptor.unavailableReason}</p> : null}
      {descriptor?.source === "simulation" ? (
        <p className="text-[10.5px] text-sim flex items-center gap-1">
          <SourceBadge source="simulation" compact /> no real backend; results are labelled
        </p>
      ) : null}
    </li>
  );
}
