import { Play, RotateCcw, Square } from "lucide-react";
import { useMemo } from "react";
import { runtime } from "@/engine/execution/runtime";
import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { selectProvider, selectProviders, useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { ModelSelector } from "./ModelSelector";

/**
 * The composer. `heading` turns it into the page's opening question before
 * anything has run; `onCancel` appears when it is reopened over a finished run.
 */
export function LLMInput({ run, heading, onCancel }: { run: RunState | undefined; heading?: boolean; onCancel?: () => void }) {
  const providers = useUIStore(selectProviders);
  const providersLoaded = useUIStore((s) => s.providersLoaded);
  const providersError = useUIStore((s) => s.providersError);
  const provider = useUIStore(selectProvider);
  const selectedProviderId = useUIStore((s) => s.selectedProviderId);
  const selectProviderId = useUIStore((s) => s.selectProvider);
  const input = useUIStore((s) => s.input);
  const setInput = useUIStore((s) => s.setInput);
  const settings = useUIStore((s) => s.settings);
  const updateSettings = useUIStore((s) => s.updateSettings);
  const comparison = useUIStore((s) => s.comparisonMode);
  const mode = useUIStore((s) => s.mode);
  const selectStage = useUIStore((s) => s.selectStage);

  const running = run?.status === "running";
  const configuredProviders = useMemo(() => providers.filter((p) => p.configured), [providers]);
  const canRun = input.trim().length > 0 && !running && (comparison ? configuredProviders.length >= 2 : Boolean(provider?.configured));
  // A slider the model will throw away is noise, so it only appears where it does something.
  const showTemperature = comparison || !provider || provider.capabilities.temperature;

  const onRun = () => {
    if (!canRun) return;
    selectStage(null);
    if (comparison) runtime.startComparison(configuredProviders.slice(0, 2), input.trim(), settings);
    else if (provider) runtime.startRun(provider, input.trim(), settings);
  };

  const onReset = () => {
    runtime.resetAll();
    selectStage(null);
  };

  return (
    <GlassPanel
      title="Input"
      subtitle={comparison ? "comparison mode · both models" : provider?.vendor}
      actions={
        <span className="mono text-[10.5px] text-muted inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", running ? "bg-live animate-pulse" : run?.status === "error" ? "bg-err" : "bg-ok")}
          />
          {running ? <span className="text-live">request in flight</span> : run ? `last run ${run.status}` : "ready"}
        </span>
      }
      bodyClassName="p-3.5 grid gap-3"
    >
      {heading ? (
        <div className="grid gap-1 pb-0.5">
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">Ask a model something.</h2>
          <p className="text-[12.5px] text-muted leading-snug">
            Press RUN and watch the request become tokens, vectors, attention and an answer, stage by stage.
          </p>
        </div>
      ) : null}
      <form
        className="@container grid gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onRun();
        }}
      >
        <div className="grid">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun();
            }}
            rows={2}
            maxLength={8000}
            placeholder="Ask the model something…"
            aria-label="Message to the model"
            title="⌘/Ctrl + Enter to run"
            className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13.5px] leading-normal text-ink placeholder:text-faint focus:border-accent/60"
          />
        </div>

        <div className="grid gap-2">
          {providersLoaded && providers.length > 0 ? (
            <ModelSelector providers={providers} value={selectedProviderId} onChange={selectProviderId} disabled={running} comparison={comparison} />
          ) : providersError ? (
            <p className="text-[12px] text-err">Backend unreachable: {providersError}. Start the API server (`npm run dev`).</p>
          ) : (
            <p className="mono text-[11px] text-muted">loading providers…</p>
          )}
          {comparison ? <p className="mono text-[10.5px] text-muted">comparison mode runs every configured provider</p> : null}
        </div>

        {/* Two per row in a narrow panel. Given room they sit on one line with RUN at
            the far right, whether or not the model takes a temperature. */}
        <div className="grid gap-x-5 gap-y-3 grid-cols-2 items-start @2xl:flex @2xl:flex-wrap">
          {showTemperature ? (
            <Control
              className="@2xl:w-[190px]"
              label={
                <>
                  <span>Temperature</span>
                  <span className="text-ink-dim">{settings.temperature.toFixed(2)}</span>
                </>
              }
              hint={mode === "advanced" ? "Scales logits before softmax." : undefined}
            >
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={settings.temperature}
                disabled={running}
                onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
                className="range-input w-full disabled:opacity-40"
                style={{ ["--fill" as string]: `${(settings.temperature / 2) * 100}%` }}
                aria-label="Temperature"
              />
            </Control>
          ) : null}

          <Control className="@2xl:w-[130px]" label={<span>Max output tokens</span>}>
            <input
              type="number"
              min={16}
              max={4096}
              step={1}
              value={settings.maxOutputTokens}
              disabled={running}
              onChange={(e) => updateSettings({ maxOutputTokens: Math.max(16, Math.min(4096, Number(e.target.value) || 16)) })}
              className="mono h-8 w-full max-w-[160px] rounded-md border border-line bg-bg-elevated/80 px-2.5 text-[12px] text-ink"
              title="Maximum output tokens"
              aria-label="Maximum output tokens"
            />
          </Control>

          <Control
            label={<span>Reasoning effort</span>}
            hint={
              !comparison && provider?.id === "openai"
                ? settings.effort === "none" || !settings.effort
                  ? "At none, OpenAI returns real token probabilities."
                  : "Above none, probabilities are not returned."
                : undefined
            }
          >
            <Segmented
              size="sm"
              ariaLabel="Reasoning effort"
              value={settings.effort ?? "none"}
              onChange={(v) => updateSettings({ effort: v })}
              options={[
                { value: "none" as const, label: "none" },
                { value: "low" as const, label: "low" },
                { value: "medium" as const, label: "med" },
                { value: "high" as const, label: "high" },
              ]}
            />
          </Control>

          <Control label={<span>Streaming</span>}>
            <Switch
              checked={settings.streaming}
              disabled={running}
              onChange={(v) => updateSettings({ streaming: v })}
              label={settings.streaming ? "Token by token" : "Single response"}
            />
          </Control>

          <div className="col-start-2 justify-self-end @2xl:ml-auto grid grid-rows-[1.1rem_2.25rem_auto] gap-y-1">
            <span aria-hidden="true" />
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" icon={<Play />} disabled={!canRun} className={cn("min-w-[104px]", canRun && "animate-none")}>
                RUN
              </Button>
              {running ? (
                <Button variant="danger" icon={<Square />} onClick={() => run && runtime.stopRun(run.id)}>
                  STOP
                </Button>
              ) : null}
              {onCancel ? (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              ) : run ? (
                <Button variant="outline" icon={<RotateCcw />} onClick={onReset}>
                  RESET
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </form>
    </GlassPanel>
  );
}

/** One settings cell: fixed-height label and control rows keep the whole row aligned. */
function Control({ label, hint, children, className }: { label: React.ReactNode; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-rows-[1.1rem_2.25rem_auto] gap-y-1 min-w-0", className)}>
      <span className="label-caps flex items-center justify-between gap-2 min-w-0">{label}</span>
      <div className="flex items-center min-w-0">{children}</div>
      {hint ? <span className="text-[10.5px] leading-snug text-muted">{hint}</span> : null}
    </div>
  );
}
