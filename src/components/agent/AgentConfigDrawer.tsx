import { useState } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { ProviderId } from "@shared/llm";
import type { AgentConfig, AgentToolDescriptor, CustomToolSpec } from "@shared/agent";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import { TOOL_CATEGORY_LABEL } from "@/labs/agent/stages";
import { cn } from "@/lib/cn";
import { useAgentStore } from "@/store/agentStore";
import { useRagStore } from "@/store/ragStore";
import { SideDrawer } from "@/components/layout/SideDrawer";
import { SourceBadge, SourceDot } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ToolIcon } from "./ToolGlyph";

/**
 * Every knob of the agent: which model plans, which tools it may use and under
 * what policy (approval, retries, fallbacks, parallelism), how long it may run,
 * what it knows (memory, files, knowledge base) and any tools you invent.
 * Changes save as they are made and apply to the next run.
 */
export function AgentConfigDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SideDrawer open={open} onClose={onClose} title="Agent settings" subtitle="saved as you change them · apply to the next run" icon={<SlidersHorizontal aria-hidden="true" />} className="w-[min(640px,96vw)]">
      <AgentConfigBody />
    </SideDrawer>
  );
}

function AgentConfigBody() {
  const config = useAgentStore((s) => s.config);
  const setConfig = useAgentStore((s) => s.setConfig);
  const status = useAgentStore((s) => s.status);
  const workspace = useAgentStore((s) => s.workspace);
  const kb = useRagStore((s) => s.kb);
  const tools = status?.tools ?? [];
  const customDescriptors = config.customTools.map(customDescriptor);
  const all: AgentToolDescriptor[] = [...tools, ...customDescriptors];
  const enabled = new Set(config.tools);

  const toggleTool = (id: string, on: boolean) => {
    const next = on ? [...config.tools, id] : config.tools.filter((t) => t !== id);
    const approvals = config.approvalRequired.filter((t) => next.includes(t));
    const fallbacks = Object.fromEntries(Object.entries(config.fallbacks).filter(([from]) => next.includes(from)));
    setConfig({ tools: [...new Set(next)], approvalRequired: approvals, fallbacks });
  };
  const toggleApproval = (id: string, on: boolean) => setConfig({ approvalRequired: on ? [...new Set([...config.approvalRequired, id])] : config.approvalRequired.filter((t) => t !== id) });
  const setFallback = (id: string, to: string) => {
    const fallbacks = { ...config.fallbacks };
    if (to) fallbacks[id] = to;
    else delete fallbacks[id];
    setConfig({ fallbacks });
  };

  const groups = new Map<string, AgentToolDescriptor[]>();
  for (const t of all) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  const kbReady = Boolean(kb && kb.documents.length > 0 && kb.index && !kb.stale);

  return (
    <div className="grid gap-5 content-start">
      <Group title="Model" note="the planner: which provider decides what to do">
        <div className="flex flex-wrap gap-1.5">
          {(status?.providers ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!p.configured}
              aria-pressed={config.llmProvider === p.id}
              onClick={() => setConfig({ llmProvider: p.id as ProviderId })}
              className={cn("inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[12.5px]", config.llmProvider === p.id ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink", !p.configured && "opacity-45 cursor-not-allowed")}
              title={p.configured ? p.model : "Add a key in Settings"}
            >
              {p.mock ? <SourceDot source="simulation" /> : <SourceDot source="live" />}
              {p.name}
              <span className="mono text-[10px] text-muted">{p.model}</span>
            </button>
          ))}
        </div>
        {config.llmProvider === "mock" ? <p className="text-[10.5px] leading-snug text-muted">The offline planner picks tools with fixed rules. Its decisions and final text are labelled a simulation; the tools it calls are real.</p> : null}
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <Range label="Temperature" value={config.temperature} min={0} max={1.5} step={0.05} digits={2} onChange={(v) => setConfig({ temperature: v })} help="Ignored by models that reject it." />
          <Range label="Max output tokens" value={config.maxOutputTokens} min={64} max={4096} step={32} onChange={(v) => setConfig({ maxOutputTokens: v })} help="Per model call." />
        </div>
        <label className="grid gap-1.5">
          <span className="label-caps text-[9.5px]">Extra instructions</span>
          <textarea value={config.systemPrompt} onChange={(e) => setConfig({ systemPrompt: e.target.value })} rows={3} maxLength={3000} placeholder="Appended to the lab's system prompt, e.g. 'Answer in British English' or 'Always cite the tool you used.'" className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[12.5px] leading-normal text-ink placeholder:text-faint focus:border-accent/60" />
        </label>
      </Group>

      <Group title="Tools" note={`${config.tools.length} enabled · each shows whether its results are live or simulated`}>
        <div className="grid gap-3">
          {[...groups.entries()].map(([category, list]) => (
            <div key={category} className="grid gap-1.5">
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-faint flex items-center gap-1.5">
                <ToolIcon category={category as AgentToolDescriptor["category"]} className="size-3" />
                {TOOL_CATEGORY_LABEL[category as AgentToolDescriptor["category"]]}
              </p>
              {list.map((t) => {
                const on = enabled.has(t.id);
                const others = all.filter((o) => o.id !== t.id && enabled.has(o.id) && o.available);
                return (
                  <div key={t.id} className={cn("rounded-lg border px-3 py-2 grid gap-1.5", on ? "border-line-strong surface-1" : "border-line", !t.available && "opacity-60")}>
                    <div className="flex items-start gap-2 min-w-0">
                      <button type="button" role="switch" aria-checked={on} disabled={!t.available} onClick={() => toggleTool(t.id, !on)} aria-label={`Enable ${t.name}`} className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed", on ? "bg-accent/80 border-accent-soft/60" : "surface-3 border-line-strong")}>
                        <span aria-hidden="true" className={cn("absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white ring-1 ring-black/10 shadow transition-transform", on ? "translate-x-4" : "translate-x-0")} />
                      </button>
                      <div className="min-w-0 flex-1 grid gap-0.5">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="mono text-[12px] text-ink">{t.name}</span>
                          {t.sideEffects ? <Badge tone="warn">side effects</Badge> : null}
                          <SourceBadge source={t.source} compact className="ml-auto" />
                        </span>
                        <span className="text-[11px] leading-snug text-muted line-clamp-2">{t.description}</span>
                        {!t.available && t.unavailableReason ? <span className="text-[10.5px] leading-snug text-warn">{t.unavailableReason}</span> : null}
                      </div>
                    </div>
                    {on ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-11">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-dim cursor-pointer">
                          <input type="checkbox" checked={config.approvalRequired.includes(t.id)} onChange={(e) => toggleApproval(t.id, e.target.checked)} className="accent-[var(--color-accent)]" />
                          ask me before it runs
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-dim">
                          fallback
                          <select value={config.fallbacks[t.id] ?? ""} onChange={(e) => setFallback(t.id, e.target.value)} className="h-6 rounded-md border border-line bg-bg-elevated/80 px-1.5 mono text-[10.5px] text-ink">
                            <option value="">none</option>
                            {others.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <Range label="Injected failures" value={config.unreliableFailures} min={0} max={6} step={1} onChange={(v) => setConfig({ unreliableFailures: v })} help="How many times the flaky service (a simulation) fails before it succeeds. Set it above the retry count to see the fallback fire." />
      </Group>

      <Group title="Execution policy" note="loops, retries, parallelism and when to stop">
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <Range label="Max iterations" value={config.maxIterations} min={1} max={12} step={1} onChange={(v) => setConfig({ maxIterations: v })} help="Tool-calling rounds before the agent must answer." />
          <Range label="Retry attempts" value={config.retry.maxAttempts} min={1} max={5} step={1} onChange={(v) => setConfig({ retry: { ...config.retry, maxAttempts: v } })} help="Per tool call, before a fallback or a failure result." />
          <Range label="Retry backoff" unit="ms" value={config.retry.backoffMs} min={0} max={3000} step={100} onChange={(v) => setConfig({ retry: { ...config.retry, backoffMs: v } })} help="Doubles on each retry." />
          <Range label="Time limit" unit="s" value={Math.round(config.timeoutMs / 1000)} min={10} max={600} step={10} onChange={(v) => setConfig({ timeoutMs: v * 1000 })} />
        </div>
        <Switch checked={config.parallelToolCalls} onChange={(v) => setConfig({ parallelToolCalls: v })} label="Parallel tool calls" description="Let the model request several tools in one turn and run them at the same time. Off runs them one after another." />
        <div className="grid gap-1.5">
          <Switch checked={config.tokenBudget !== null} onChange={(v) => setConfig({ tokenBudget: v ? 20_000 : null })} label="Token budget" description="Stop and answer once input + output tokens across all model calls pass a limit." />
          {config.tokenBudget !== null ? <Range label="Budget" unit="tokens" value={config.tokenBudget} min={500} max={200_000} step={500} onChange={(v) => setConfig({ tokenBudget: v })} /> : null}
        </div>
      </Group>

      <Group title="Knowledge and memory" note="what the agent can know beyond the goal">
        <div className="rounded-lg border border-line px-3 py-2 grid gap-1">
          <span className="flex items-center gap-2 text-[12.5px] text-ink">
            Knowledge base
            {kbReady ? <Badge tone="ok">{kb!.documents.length} docs · {kb!.chunks.length} chunks</Badge> : <Badge tone="warn">{kb && kb.documents.length ? "rebuild needed" : "none"}</Badge>}
          </span>
          <span className="text-[11px] leading-snug text-muted">The `rag_retrieve` tool searches the RAG lab's knowledge base for this browser session. Add documents there first.</span>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant={config.ragKbId ? "outline" : "live"} disabled={!kbReady} onClick={() => setConfig({ ragKbId: kb!.id, tools: [...new Set([...config.tools, "rag_retrieve"])] })}>
              {config.ragKbId === kb?.id ? "Attached" : "Attach"}
            </Button>
            {config.ragKbId ? (
              <Button size="sm" variant="ghost" onClick={() => setConfig({ ragKbId: null, tools: config.tools.filter((t) => t !== "rag_retrieve") })}>
                Detach
              </Button>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-line px-3 py-2 grid gap-1.5">
          <span className="flex items-center gap-2 text-[12.5px] text-ink">
            Session workspace
            <span className="mono text-[10px] text-muted">{workspace ? `${workspace.memory.length} memories · ${workspace.files.length} files` : "loading…"}</span>
            <Button size="sm" variant="ghost" icon={<Trash2 />} className="ml-auto" onClick={() => void agentRuntime.clearWorkspace()} disabled={!workspace || (workspace.memory.length === 0 && workspace.files.length <= 1)}>
              Clear
            </Button>
          </span>
          <span className="text-[11px] leading-snug text-muted">Memory entries and files persist across runs in this tab, so a second run can recall what the first stored. Kept in the server's memory only.</span>
          {workspace?.memory.length ? (
            <ul className="grid gap-0.5">
              {workspace.memory.map((m) => (
                <li key={m.key} className="mono text-[11px] text-ink-dim break-words">
                  <span className="text-ink">{m.key}</span>: {m.value}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Group>

      <CustomTools config={config} onChange={setConfig} />
    </div>
  );
}

/* ───────────────────────────── custom tools ─────────────────────────── */

function customDescriptor(spec: CustomToolSpec): AgentToolDescriptor {
  const properties: AgentToolDescriptor["inputSchema"]["properties"] = {};
  for (const p of spec.parameters) properties[p.name] = { type: p.type, description: p.description };
  return { id: `custom:${spec.slug}`, name: spec.slug, description: spec.description, category: "custom", inputSchema: { type: "object", properties, required: spec.parameters.filter((p) => p.required).map((p) => p.name) }, source: "simulation", sourceNote: "Simulation: a templated response you wrote.", sideEffects: false, available: true };
}

function CustomTools({ config, onChange }: { config: AgentConfig; onChange: (partial: Partial<AgentConfig>) => void }) {
  const [draft, setDraft] = useState<CustomToolSpec>({ slug: "", description: "", parameters: [{ name: "query", type: "string", description: "", required: true }], response: "" });
  const slug = draft.slug
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  const canAdd = slug.length > 0 && draft.description.trim().length > 0 && draft.response.trim().length > 0 && !config.customTools.some((c) => c.slug === slug) && config.customTools.length < 6;

  const add = () => {
    if (!canAdd) return;
    const spec: CustomToolSpec = { ...draft, slug, parameters: draft.parameters.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.toLowerCase().replace(/[^a-z0-9_]/g, "_") })) };
    onChange({ customTools: [...config.customTools, spec], tools: [...config.tools, `custom:${slug}`] });
    setDraft({ slug: "", description: "", parameters: [{ name: "query", type: "string", description: "", required: true }], response: "" });
  };
  const remove = (s: string) => onChange({ customTools: config.customTools.filter((c) => c.slug !== s), tools: config.tools.filter((t) => t !== `custom:${s}`), approvalRequired: config.approvalRequired.filter((t) => t !== `custom:${s}`) });

  const input = "h-8 rounded-md border border-line bg-bg-elevated/80 px-2.5 text-[12px] text-ink placeholder:text-faint focus:border-accent/60";
  return (
    <Group title="Custom tools" note="define a tool by name, parameters and a templated response · labelled simulation">
      {config.customTools.length ? (
        <ul className="grid gap-1.5">
          {config.customTools.map((c) => (
            <li key={c.slug} className="rounded-lg border border-line px-3 py-2 flex items-start gap-2">
              <div className="min-w-0 flex-1 grid gap-0.5">
                <span className="mono text-[12px] text-ink">{c.slug}({c.parameters.map((p) => p.name).join(", ")})</span>
                <span className="text-[11px] text-muted line-clamp-2">{c.description}</span>
                <span className="mono text-[10.5px] text-faint truncate">→ {c.response}</span>
              </div>
              <SourceBadge source="simulation" compact />
              <button type="button" onClick={() => remove(c.slug)} aria-label={`Remove ${c.slug}`} className="grid size-7 place-items-center rounded-md border border-line text-muted hover:text-err hover:border-err/50">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-lg border border-dashed border-line-strong p-3 grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="tool name, e.g. get_weather" aria-label="Tool name" className={input} />
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="what the model is told it does" aria-label="Tool description" className={input} />
        </div>
        <div className="grid gap-1.5">
          <span className="label-caps text-[9.5px]">parameters</span>
          {draft.parameters.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_88px_1fr_auto_auto] items-center gap-1.5">
              <input value={p.name} onChange={(e) => setDraft({ ...draft, parameters: draft.parameters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="name" aria-label="Parameter name" className={input} />
              <select value={p.type} onChange={(e) => setDraft({ ...draft, parameters: draft.parameters.map((x, j) => (j === i ? { ...x, type: e.target.value as CustomToolSpec["parameters"][number]["type"] } : x)) })} aria-label="Parameter type" className={cn(input, "mono text-[11px]")}>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <input value={p.description} onChange={(e) => setDraft({ ...draft, parameters: draft.parameters.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder="description" aria-label="Parameter description" className={input} />
              <label className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                <input type="checkbox" checked={p.required} onChange={(e) => setDraft({ ...draft, parameters: draft.parameters.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} className="accent-[var(--color-accent)]" /> req
              </label>
              <button type="button" onClick={() => setDraft({ ...draft, parameters: draft.parameters.filter((_, j) => j !== i) })} aria-label="Remove parameter" className="grid size-7 place-items-center rounded-md border border-line text-muted hover:text-err">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          {draft.parameters.length < 6 ? (
            <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setDraft({ ...draft, parameters: [...draft.parameters, { name: "", type: "string", description: "", required: false }] })} className="justify-self-start">
              parameter
            </Button>
          ) : null}
        </div>
        <textarea value={draft.response} onChange={(e) => setDraft({ ...draft, response: e.target.value })} rows={2} placeholder="response template, e.g. Sunny and 28°C in {{city}}" aria-label="Response template" className="w-full resize-y rounded-md border border-line bg-bg-elevated/80 px-2.5 py-1.5 mono text-[11.5px] text-ink placeholder:text-faint focus:border-accent/60" />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" icon={<Plus />} disabled={!canAdd} onClick={add}>
            Add tool
          </Button>
          <span className="text-[10.5px] text-muted">The model can call it like any other tool; the result is your template with the arguments filled in.</span>
        </div>
      </div>
    </Group>
  );
}

/* ─────────────────────────────── bits ───────────────────────────────── */

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="label-caps">{title}</h3>
        {note ? <span className="mono text-[10px] text-faint">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Range({ label, unit, value, min, max, step, digits = 0, onChange, help }: { label: string; unit?: string; value: number; min: number; max: number; step: number; digits?: number; onChange: (v: number) => void; help?: string }) {
  return (
    <label className="grid gap-1 min-w-0">
      <span className="flex items-baseline justify-between gap-2 label-caps text-[9.5px]">
        <span>{label}</span>
        <span className="mono text-ink-dim normal-case tracking-normal text-[11px]">
          {value.toFixed(digits)}
          {unit ? <span className="text-faint"> {unit}</span> : null}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="range-input w-full" style={{ ["--fill" as string]: `${((value - min) / Math.max(1e-9, max - min)) * 100}%` }} />
      {help ? <span className="text-[10.5px] leading-snug text-muted">{help}</span> : null}
    </label>
  );
}

/** One line of what the agent is currently set to, for the button that opens the drawer. */
export function agentConfigSummary(c: AgentConfig): string {
  return `${c.llmProvider} · ${c.tools.length} tool${c.tools.length === 1 ? "" : "s"} · ${c.maxIterations} iterations · ${c.parallelToolCalls ? "parallel" : "sequential"} · ${c.retry.maxAttempts} attempt${c.retry.maxAttempts === 1 ? "" : "s"}${c.approvalRequired.length ? ` · ${c.approvalRequired.length} gated` : ""}${Object.keys(c.fallbacks).length ? ` · ${Object.keys(c.fallbacks).length} fallback` : ""}`;
}
