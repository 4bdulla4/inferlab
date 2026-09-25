import type { Hyperparameters, MLConfig } from "@shared/ml";
import type { MLRunState } from "@/labs/ml/state";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { useMLStore } from "@/store/mlStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { LineChart } from "./MLVisuals";
import { MLResultPanel } from "./MLResultPanel";

const CONFIG_LABELS: Partial<Record<keyof MLConfig, string>> = { algorithm: "algorithm", impute: "imputation", scaling: "scaling", polynomialFeatures: "polynomial features", trainFraction: "train fraction", validationFraction: "validation fraction", stratify: "stratify", seed: "seed" };
const HYPER_LABELS: Record<keyof Hyperparameters, string> = { learningRate: "learning rate", epochs: "epochs", batchSize: "batch size", optimizer: "optimizer", regularization: "regularization", regularizationStrength: "λ", hiddenLayers: "hidden layers", activation: "activation", maxDepth: "max depth", minSamplesLeaf: "min leaf", trees: "trees", k: "K", svmC: "C" };

/**
 * Two trainings on the same rows with one setting changed, side by side: what
 * differed, the two loss curves on one chart, the two test scores, and both
 * result panels. Click either run's row to make it the one the graph plays.
 */
export function MLCompare({ runs }: { runs: MLRunState[] }) {
  const activeRunId = useMLStore((s) => s.activeRunId);
  const setActiveRun = useMLStore((s) => s.setActiveRun);
  const [a, b] = runs;
  if (!a || !b) return null;

  const diffs: { label: string; a: string; b: string }[] = [];
  for (const k of Object.keys(CONFIG_LABELS) as (keyof MLConfig)[]) if (String(a.config[k]) !== String(b.config[k])) diffs.push({ label: CONFIG_LABELS[k]!, a: String(a.config[k]), b: String(b.config[k]) });
  for (const k of Object.keys(HYPER_LABELS) as (keyof Hyperparameters)[]) if (String(a.config.hyperparameters[k]) !== String(b.config.hyperparameters[k])) diffs.push({ label: HYPER_LABELS[k], a: String(a.config.hyperparameters[k]), b: String(b.config.hyperparameters[k]) });

  const metric = (r: MLRunState) => {
    const m = r.visual.test?.metrics ?? r.visual.validation?.metrics;
    if (!m) return null;
    return m.task === "classification" ? { name: "accuracy", value: m.accuracy, text: `${(m.accuracy * 100).toFixed(1)}%`, higher: true } : { name: "RMSE", value: m.rmse, text: m.rmse.toFixed(3), higher: false };
  };
  const ma = metric(a);
  const mb = metric(b);
  const winner = ma && mb ? (ma.higher ? (ma.value >= mb.value ? "a" : "b") : ma.value <= mb.value ? "a" : "b") : null;

  const curve = (r: MLRunState) => (r.visual.epochs.length > 1 ? r.visual.epochs.map((e) => ({ x: e.epoch, y: e.trainLoss })) : r.visual.lossTrace.map((p) => ({ x: p.iteration, y: p.loss })));
  const xLabel = a.visual.epochs.length > 1 || b.visual.epochs.length > 1 ? "epoch" : "iteration";
  const hasCurves = curve(a).length > 1 || curve(b).length > 1;

  return (
    <div className="grid gap-4">
      <GlassPanel title="Comparison" subtitle={`${a.datasetName} · one setting changed`} bodyClassName="p-4 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {[a, b].map((r, i) => {
            const m = i === 0 ? ma : mb;
            const won = winner === (i === 0 ? "a" : "b");
            return (
              <button key={r.id} type="button" onClick={() => setActiveRun(r.id)} aria-pressed={activeRunId === r.id} className={cn("text-left rounded-lg border px-3 py-2 grid gap-1 min-w-0", activeRunId === r.id ? "border-accent/60 bg-accent/[0.07]" : "border-line surface-1 hover:border-line-strong")}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={cn("mono text-[10px] uppercase tracking-[0.12em]", i === 0 ? "text-live" : "text-accent-soft")}>{r.comparisonLabel ?? (i === 0 ? "A" : "B")}</span>
                  {won && ma && mb ? <Badge tone="ok">better on test</Badge> : null}
                  <Badge className="ml-auto" tone={r.status === "running" ? "live" : r.status === "error" ? "err" : r.status === "stopped" ? "warn" : "neutral"}>
                    {r.status}
                  </Badge>
                </span>
                <span className="text-[18px] text-ink font-semibold tracking-tight">{m ? `${m.text} ${m.name}` : r.status === "running" ? "training…" : "—"}</span>
                <span className="mono text-[10px] text-muted">
                  {r.visual.completion ? `${r.visual.completion.iterations.toLocaleString()} iterations · ${formatMs(r.visual.completion.totalMs)}` : `${r.visual.stepsSeen.toLocaleString()} steps so far`}
                  {activeRunId === r.id ? " · shown on the graph" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {diffs.length ? (
          <div className="grid gap-1.5">
            <p className="label-caps">What changed</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {diffs.map((d) => (
                <div key={d.label} className="rounded-lg border border-line surface-1 px-3 py-1.5 grid grid-cols-[110px_1fr_1fr] items-baseline gap-2 mono text-[11px]">
                  <span className="text-muted truncate">{d.label}</span>
                  <span className="text-live truncate">{d.a}</span>
                  <span className="text-accent-soft truncate">{d.b}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mono text-[11px] text-muted">Identical settings and seed: the two runs should match exactly.</p>
        )}

        {hasCurves ? (
          <div className="grid gap-1">
            <p className="label-caps">Training loss</p>
            <LineChart
              height={170}
              xLabel={xLabel}
              yLabel="loss"
              series={[
                { name: a.comparisonLabel ?? "A", color: "var(--color-live)", points: curve(a) },
                { name: b.comparisonLabel ?? "B", color: "var(--color-accent-soft)", points: curve(b) },
              ]}
            />
          </div>
        ) : null}
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <MLResultPanel run={a} compact />
        <MLResultPanel run={b} compact />
      </div>
    </div>
  );
}
