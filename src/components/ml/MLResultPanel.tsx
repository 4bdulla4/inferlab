import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Sparkles, Trophy } from "lucide-react";
import type { SavedModelInfo } from "@shared/ml";
import { mlRuntime } from "@/engine/ml/mlRuntime";
import { modelDownloadUrl } from "@/api/mlClient";
import type { MLRunState } from "@/labs/ml/state";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { useMLStore } from "@/store/mlStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { BarList, classColor, MetricCards, ProbabilityBars } from "./MLVisuals";

/**
 * What the run produced: the test score (the honest one), what was chosen and
 * why, the features that mattered, a download of the saved model, and a form
 * to send a brand-new row through it. Predictions append two more stages to
 * the same run so the graph shows inference too.
 */
export function MLResultPanel({ run, compact, className }: { run: MLRunState | undefined; compact?: boolean; className?: string }) {
  const v = run?.visual;
  const model = useMLStore((s) => (v?.saved?.modelId ? s.models[v.saved.modelId] : undefined));
  const selectStage = useMLStore((s) => s.selectStage);
  const classes = v?.identified?.classes ?? null;
  const metrics = v?.test?.metrics ?? v?.validation?.metrics;
  const headline = metrics ? (metrics.task === "classification" ? `${(metrics.accuracy * 100).toFixed(1)}% accuracy` : `R² ${metrics.r2.toFixed(3)} · RMSE ${metrics.rmse.toFixed(3)}`) : null;

  return (
    <GlassPanel
      title={compact ? run?.comparisonLabel ?? "Result" : "Result"}
      subtitle={run ? `${run.label}` : undefined}
      actions={
        <>
          {v?.completion ? <Badge tone="ok">completed</Badge> : v?.error ? <Badge tone="err">error</Badge> : v?.stopped ? <Badge tone="warn">stopped</Badge> : run?.status === "running" ? <Badge tone="live">training</Badge> : null}
          <SourceBadge source="live" compact />
        </>
      }
      className={className}
      bodyClassName="p-4 grid gap-4 overflow-y-auto panel-scroll content-start"
    >
      {!run || !v ? (
        <p className="mono text-[11px] text-muted">The trained model, its test score and a prediction form appear here.</p>
      ) : (
        <>
          {v.error ? <p className="text-[12.5px] leading-snug text-err">{v.error.message}</p> : null}
          {v.stopped && !v.completion ? <p className="mono text-[11.5px] text-muted">Stopped before the model finished.</p> : null}

          {metrics ? (
            <div className="grid gap-2">
              <p className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[20px] text-ink font-semibold tracking-tight">{headline}</span>
                <span className="mono text-[10.5px] text-muted">on {v.test ? `${metrics.n} sealed test rows` : `${metrics.n} validation rows (test pending)`}</span>
              </p>
              <MetricCards metrics={metrics} />
            </div>
          ) : run.status === "running" ? (
            <p className="mono text-[11.5px] text-live flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> training… {v.stepsSeen ? `${v.stepsSeen.toLocaleString()} steps` : ""} {v.epochs.length ? `· epoch ${v.epochs.length}` : ""}
            </p>
          ) : null}

          {v.best ? (
            <p className="flex items-start gap-2 text-[12px] leading-snug text-ink-dim">
              <Trophy className="size-3.5 text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <span className="text-ink">{v.best.choice}</span> · {v.best.reason}
              </span>
            </p>
          ) : null}

          {!compact && v.evaluation?.importance?.values.length ? (
            <div className="grid gap-1">
              <p className="label-caps flex items-center gap-2">
                what mattered · {v.evaluation.importance.method} <SourceBadge source={v.evaluation.importance.source} compact />
              </p>
              <BarList items={v.evaluation.importance.values.slice(0, 6).map((x) => ({ label: x.feature, value: x.importance, color: "var(--color-ok)" }))} />
            </div>
          ) : null}

          {v.completion ? (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mono text-[11px]">
              <Stat k="iterations" v={v.completion.iterations.toLocaleString()} />
              <Stat k="epochs" v={String(v.completion.epochs)} />
              <Stat k="parameters" v={(v.saved?.params.count ?? 0).toLocaleString()} />
              <Stat k="total time" v={formatMs(v.completion.totalMs)} />
            </dl>
          ) : null}

          {v.saved ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href={modelDownloadUrl(v.saved.modelId)} download={`${run.config.algorithm}-${v.saved.modelId}.json`} className="mono inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-[11px] text-ink-dim hover:border-line-strong hover:text-ink">
                <Download className="size-3" aria-hidden="true" /> saved model · {(v.saved.bytes / 1024).toFixed(1)} KB JSON
              </a>
              <span className="mono text-[10px] text-faint">parameters + preprocessing recipe · kept 2 hours</span>
            </div>
          ) : null}

          {v.saved && model && !compact ? <PredictForm run={run} model={model} classes={classes} onPredicted={() => selectStage("predict")} /> : null}
          {v.saved && !model && !compact ? (
            <p className="mono text-[11px] text-muted flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> loading the model's input schema…
            </p>
          ) : null}

          {v.inference && compact ? (
            <p className="mono text-[11.5px] text-ink">
              last prediction → {v.inference.trace.label}
              {v.inference.trace.probabilities ? ` · ${(Math.max(...v.inference.trace.probabilities) * 100).toFixed(0)}%` : ""}
            </p>
          ) : null}
        </>
      )}
    </GlassPanel>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line surface-1 px-2.5 py-1.5 min-w-0">
      <dt className="text-muted text-[9.5px] uppercase tracking-[0.12em]">{k}</dt>
      <dd className="text-ink text-[12.5px] truncate">{v}</dd>
    </div>
  );
}

/** A row of inputs, one per original column, prefilled with an example from the data. */
function PredictForm({ run, model, classes, onPredicted }: { run: MLRunState; model: SavedModelInfo; classes: string[] | null; onPredicted: () => void }) {
  const initial = useMemo(() => Object.fromEntries(model.inputs.map((i) => [i.name, String(i.example)])), [model]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trace = run.visual.inference?.trace;

  useEffect(() => setValues(initial), [initial]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const input: Record<string, string | number | boolean | null> = {};
      for (const i of model.inputs) {
        const raw = values[i.name] ?? "";
        if (raw.trim() === "") input[i.name] = null;
        else if (i.type === "numeric") input[i.name] = Number(raw);
        else if (i.type === "boolean") input[i.name] = /^(true|yes|1|y)$/i.test(raw.trim());
        else input[i.name] = raw;
      }
      await mlRuntime.predict(run.id, input);
      onPredicted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The prediction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="label-caps flex items-center gap-2">
        <Sparkles className="size-3 text-accent-soft" aria-hidden="true" /> Predict a new row · {model.target}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {model.inputs.map((i) => (
          <label key={i.name} className="grid gap-0.5 min-w-0">
            <span className="mono text-[10px] text-muted truncate">
              {i.name} <span className="text-faint">· {i.type}</span>
            </span>
            {i.categories && i.categories.length <= 12 ? (
              <select value={values[i.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))} className="mono h-8 rounded-md border border-line bg-bg-elevated/80 px-2 text-[12px] text-ink focus:border-accent/60">
                {i.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input value={values[i.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))} inputMode={i.type === "numeric" ? "decimal" : undefined} placeholder={String(i.example)} className="mono h-8 rounded-md border border-line bg-bg-elevated/80 px-2 text-[12px] text-ink placeholder:text-faint focus:border-accent/60" />
            )}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="live" size="sm" icon={busy ? <Loader2 className="animate-spin" /> : <Sparkles />} disabled={busy}>
          Predict
        </Button>
        {trace ? (
          <span className={cn("text-[14px] text-ink")}>
            → <span className="font-semibold" style={classes ? { color: classColor(trace.prediction) } : undefined}>{trace.label}</span>
            {trace.probabilities ? <span className="mono text-[10.5px] text-muted ml-2">{(Math.max(...trace.probabilities) * 100).toFixed(1)}% · {formatMs(trace.ms)}</span> : <span className="mono text-[10.5px] text-muted ml-2">{formatMs(trace.ms)}</span>}
          </span>
        ) : null}
        <span className="mono text-[10px] text-faint ml-auto">leave a field empty to see imputation fill it</span>
      </div>
      {trace?.probabilities && classes ? <ProbabilityBars probabilities={trace.probabilities} classes={classes} /> : null}
      {error ? <p className="text-[12px] text-err leading-snug">{error}</p> : null}
    </form>
  );
}
