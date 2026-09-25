import { useEffect, useMemo, useState } from "react";
import { FolderLock, KeyRound, LayoutGrid, RotateCcw, Trash2 } from "lucide-react";
import { saveKeysToServer } from "@/api/llmClient";
import { PLAYBACK_SPEEDS } from "@/types/execution";
import { cn } from "@/lib/cn";
import { useLayoutStore } from "@/store/layoutStore";
import { useRepoStore } from "@/store/repoStore";
import { selectProviders, useUIStore, type SessionKeys } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Legend } from "@/components/layout/Legend";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { KeyField, type KeySaveState } from "@/components/settings/KeyField";

/** Dedicated settings page: credentials, provider status, preferences and where data lives. */
export function SettingsLab() {
  const sessionKeys = useUIStore((s) => s.sessionKeys);
  const setSessionKey = useUIStore((s) => s.setSessionKey);
  const clearSessionKeys = useUIStore((s) => s.clearSessionKeys);
  const rememberKeys = useUIStore((s) => s.rememberKeys);
  const setRememberKeys = useUIStore((s) => s.setRememberKeys);
  const focusField = useUIStore((s) => s.settingsFocus);
  const openSettingsFor = useUIStore((s) => s.openSettingsFor);
  const setProviders = useUIStore((s) => s.setProviders);
  const serverProviders = useUIStore((s) => s.providers);
  const providers = useUIStore(selectProviders);
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  const speed = useUIStore((s) => s.speed);
  const setSpeed = useUIStore((s) => s.setSpeed);
  const motionPref = useUIStore((s) => s.motion);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const setMotion = useUIStore((s) => s.setMotion);
  const comparison = useUIStore((s) => s.comparisonMode);
  const setComparison = useUIStore((s) => s.setComparisonMode);
  const repoService = useRepoStore((s) => s.serviceStatus);
  const resetLayout = useLayoutStore((s) => s.reset);
  const layouts = useLayoutStore((s) => s.layouts);
  // Derived here rather than in the selector so the array identity stays stable.
  const customLayouts = useMemo(() => Object.keys(layouts).sort(), [layouts]);
  const setRepoServiceStatus = useRepoStore((s) => s.setServiceStatus);

  const [saveState, setSaveState] = useState<(KeySaveState & { field: keyof SessionKeys }) | null>(null);

  // Clear the "focus this field" request once it has been honoured.
  useEffect(() => {
    if (!focusField) return;
    const t = setTimeout(() => openSettingsFor(null), 600);
    return () => clearTimeout(t);
  }, [focusField, openSettingsFor]);

  const serverHas = (id: "claude" | "openai" | "gemini") => serverProviders.find((p) => p.id === id)?.configured ?? false;
  const githubOnServer = repoService?.githubTokenConfigured ?? false;

  const saveToServer = async (field: keyof SessionKeys) => {
    const value = useUIStore.getState().sessionKeys[field] ?? "";
    if (!value) return;
    setSaveState({ field, status: "saving" });
    try {
      const result = await saveKeysToServer({ [field]: value });
      setProviders(result.providers);
      setSessionKey(field, "");
      setSaveState({ field, status: "saved", message: `Saved to .env as ${result.saved.join(", ")} and loaded by the server. No restart needed.` });
      fetch("/api/repo/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => st && setRepoServiceStatus(st))
        .catch(() => {});
    } catch (err) {
      setSaveState({ field, status: "error", message: err instanceof Error ? err.message : "Save failed." });
    }
  };

  const stateFor = (field: keyof SessionKeys) => (saveState?.field === field ? saveState : null);

  return (
    <div className="mx-auto max-w-[1720px] p-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid gap-4 min-w-0 content-start">
        <GlassPanel
          title="API keys"
          subtitle="used by the server, never bundled into the browser"
          actions={<KeyRound className="size-4 text-muted" aria-hidden="true" />}
          bodyClassName="p-3.5 grid gap-3"
        >
          <Switch
            checked={rememberKeys}
            onChange={setRememberKeys}
            label="Remember keys in this browser"
            description={rememberKeys ? "Keys survive a page refresh on this device." : "Keys are kept in memory only and disappear when you refresh."}
          />

          <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
            <KeyField
              label="Anthropic (Claude)"
              field="anthropic"
              value={sessionKeys.anthropic ?? ""}
              onChange={setSessionKey}
              onSave={saveToServer}
              saveState={stateFor("anthropic")}
              serverConfigured={serverHas("claude")}
              remembered={rememberKeys}
              autoFocus={focusField === "anthropic"}
              hint={providers.find((p) => p.id === "claude")?.model}
              help="Runs the LLM visualizer on Claude, and powers AI summaries and traced questions in the analyzer."
            />
            <KeyField
              label="Anthropic workspace id"
              field="anthropicWorkspace"
              value={sessionKeys.anthropicWorkspace ?? ""}
              onChange={setSessionKey}
              onSave={saveToServer}
              saveState={stateFor("anthropicWorkspace")}
              serverConfigured={false}
              remembered={rememberKeys}
              autoFocus={focusField === "anthropicWorkspace"}
              placeholder="wrkspc_… (leave empty for workspace-scoped keys)"
              help="Only needed for organization-level keys that are not scoped to a workspace; the API rejects those without this header."
            />
            <KeyField
              label="OpenAI"
              field="openai"
              value={sessionKeys.openai ?? ""}
              onChange={setSessionKey}
              onSave={saveToServer}
              saveState={stateFor("openai")}
              serverConfigured={serverHas("openai")}
              remembered={rememberKeys}
              autoFocus={focusField === "openai"}
              hint={providers.find((p) => p.id === "openai")?.model}
              help="Runs the OpenAI pipeline. At reasoning effort none the API returns real token probabilities."
            />
            <KeyField
              label="Google (Gemini)"
              field="google"
              value={sessionKeys.google ?? ""}
              onChange={setSessionKey}
              onSave={saveToServer}
              saveState={stateFor("google")}
              serverConfigured={serverHas("gemini")}
              remembered={rememberKeys}
              autoFocus={focusField === "google"}
              hint={providers.find((p) => p.id === "gemini")?.model}
              help="Runs the Gemini pipeline. Gemini returns real token probabilities and a live pre-flight token count."
            />
            <KeyField
              label="GitHub token"
              field="github"
              value={sessionKeys.github ?? ""}
              onChange={setSessionKey}
              onSave={saveToServer}
              saveState={stateFor("github")}
              serverConfigured={githubOnServer}
              remembered={rememberKeys}
              autoFocus={focusField === "github"}
              placeholder="github_pat_… or ghp_… with read access to Contents"
              help="Optional for public repositories. Required to analyze private ones, and raises the rate limit from 60 to 5,000 requests an hour."
            />
          </div>

          {Object.keys(sessionKeys).length ? (
            <button
              type="button"
              onClick={clearSessionKeys}
              className="mono justify-self-start inline-flex items-center gap-1.5 text-[10.5px] text-muted underline-offset-2 hover:underline hover:text-ink"
            >
              <Trash2 className="size-3" aria-hidden="true" />
              forget keys in this browser
            </button>
          ) : null}
        </GlassPanel>

        <GlassPanel title="Providers" subtitle="what each configured model can actually do" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {providers.map((p) => (
              <li key={p.id} className="px-3.5 py-2.5 grid gap-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="mono text-[11px] text-muted truncate">{p.model}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {p.mock ? (
                      <Badge tone="warn">offline demo</Badge>
                    ) : p.keySource === "session" ? (
                      <Badge tone="sim">session key</Badge>
                    ) : p.configured ? (
                      <Badge tone="ok">key set</Badge>
                    ) : (
                      <Badge tone="err">no key</Badge>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Cap on={p.capabilities.exactTokenizer} yes="exact tokenizer" no="approximate tokenizer" />
                  <Cap on={p.capabilities.logprobs} yes="real probabilities" no="simulated probabilities" />
                  <Cap on={p.capabilities.reasoning} yes="reasoning" no="no reasoning" />
                  <Cap on={p.capabilities.effort} yes="effort control" no="no effort control" />
                  <Cap on={p.capabilities.temperature} yes="temperature" no="temperature rejected" />
                  <Cap on={p.capabilities.inputTokenCount === "live"} yes="pre-flight token count" no="local token estimate" />
                </div>
              </li>
            ))}
          </ul>
        </GlassPanel>

        <GlassPanel title="Preferences" subtitle="appearance, playback and layout" bodyClassName="p-3.5 grid gap-3.5">
          <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
          <Field label="Theme" help="Follows your operating system unless you pick one.">
            <Segmented
              ariaLabel="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </Field>
          <Field label="Explanation level" help="Advanced adds Q/K/V, vectors, logits and raw events.">
            <Segmented
              ariaLabel="Explanation level"
              value={mode}
              onChange={setMode}
              options={[
                { value: "beginner", label: "Beginner" },
                { value: "advanced", label: "Advanced" },
              ]}
            />
          </Field>
          <Field label="Playback speed" help="Applies to the pipeline and to code-path traces.">
            <Segmented ariaLabel="Playback speed" value={speed} onChange={setSpeed} options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} />
          </Field>
          <Field label="Motion" help="Reduced swaps particle streams for plain transitions.">
            <Segmented
              ariaLabel="Motion preference"
              value={motionPref}
              onChange={setMotion}
              options={[
                { value: "system", label: "System" },
                { value: "reduced", label: "Reduced" },
                { value: "full", label: "Full" },
              ]}
            />
          </Field>
          </div>

          <div className="border-t border-line pt-3 grid gap-3">
            <Switch
              checked={comparison}
              onChange={setComparison}
              label="Multi-model comparison"
              description="Run two configured models on the same input and compare latency, tokens and finish reason."
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <LayoutGrid className="size-3.5 text-muted shrink-0" aria-hidden="true" />
              <span className="text-[12px] text-ink-dim">Panel layout</span>
              <span className="mono text-[10.5px] text-faint">
                {customLayouts.length === 0 ? "every page uses its default arrangement" : `rearranged: ${customLayouts.join(", ")}`}
              </span>
              <button
                type="button"
                onClick={() => resetLayout()}
                disabled={customLayouts.length === 0}
                className="mono ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                reset
              </button>
            </div>
          </div>
        </GlassPanel>
      </div>

      <aside className="grid gap-4 min-w-0 content-start">
        <GlassPanel title="Where your data lives" actions={<FolderLock className="size-4 text-muted" aria-hidden="true" />} bodyClassName="p-0">
          <dl className="divide-y divide-line">
            <Fact title="Server keys" body="In .env beside the project, readable only by your user and ignored by git. The server reloads it on change." />
            <Fact title="Browser keys" body="This browser profile only, sent to your own backend as headers. Never logged or echoed back." />
            <Fact title="Activity history" body="Metadata only, in .data/history.json. No code, prompts or keys." />
            <Fact title="Repository analyses" body="In server memory for two hours, then dropped. Private repos are never written to disk." />
            <Fact title="Nothing leaves this machine" body="The browser never calls a provider directly; every request goes through your local server." />
          </dl>
        </GlassPanel>

        <GlassPanel title="Reading the interface" bodyClassName="p-3.5">
          <Legend />
        </GlassPanel>
      </aside>
    </div>
  );
}

function Cap({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return (
    <span className={cn("mono rounded border px-1.5 h-5 inline-flex items-center text-[10px] uppercase tracking-[0.06em]", on ? "border-live/40 text-live/90 bg-live/5" : "border-line text-faint")}>
      {on ? yes : no}
    </span>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 content-start min-w-0">
      <span className="label-caps">{label}</span>
      {children}
      {help ? <span className="text-[10.5px] text-muted leading-snug">{help}</span> : null}
    </div>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-3.5 py-2 min-w-0">
      <dt className="text-[12px] text-ink">{title}</dt>
      <dd className="text-[11px] leading-snug text-muted mt-0.5">{body}</dd>
    </div>
  );
}
