import { useState, type ReactNode } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { ALGORITHMS, DEFAULT_HYPERPARAMETERS, DEFAULT_ML_CONFIG, ML_LIMITS, type Hyperparameters } from "@shared/ml";
import { cn } from "@/lib/cn";
import { selectDataset, useMLStore } from "@/store/mlStore";
import { SideDrawer } from "@/components/layout/SideDrawer";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";

/**
 * Every knob of a run, saved as it changes. Which hyperparameters show depends
 * on the algorithm family: gradient models have a learning rate and epochs,
 * trees a depth, KNN a K. Preprocessing, the split and an optional sweep
 * apply to all of them.
 */
export function MLSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useMLStore((s) => s.config);
  const setConfig = useMLStore((s) => s.setConfig);
  const setHyper = useMLStore((s) => s.setHyper);
  const dataset = useMLStore(selectDataset);
  const limits = useMLStore((s) => s.status?.limits) ?? ML_LIMITS;
  const h = config.hyperparameters;
  const algo = ALGORITHMS.find((a) => a.id === config.algorithm);
  const family = algo?.family ?? "gradient";
  const [layersText, setLayersText] = useState(h.hiddenLayers.join(", "));
  const [sweepText, setSweepText] = useState(config.sweep?.values.join(", ") ?? "");

  const commitLayers = (text: string) => {
    const layers = text
      .split(/[,\s]+/)
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x) && x > 0)
      .map((x) => Math.min(limits.maxHiddenWidth, x))
      .slice(0, limits.maxHiddenLayers);
    if (layers.length) setHyper({ hiddenLayers: layers });
    setLayersText(layers.length ? layers.join(", ") : h.hiddenLayers.join(", "));
  };

  const sweepable: { key: keyof Hyperparameters; label: string }[] =
    family === "gradient"
      ? [
          { key: "learningRate", label: "learning rate" },
          { key: "epochs", label: "epochs" },
          { key: "batchSize", label: "batch size" },
          { key: "regularizationStrength", label: "λ" },
          ...(config.algorithm === "svm" ? [{ key: "svmC" as const, label: "C" }] : []),
        ]
      : family === "tree"
        ? [
            { key: "maxDepth", label: "max depth" },
            { key: "minSamplesLeaf", label: "min leaf" },
            ...(config.algorithm === "random_forest" ? [{ key: "trees" as const, label: "trees" }] : []),
          ]
        : family === "instance"
          ? [{ key: "k", label: "K" }]
          : [];

  const commitSweep = (parameter: keyof Hyperparameters | null, text: string) => {
    if (!parameter) {
      setConfig({ sweep: null });
      return;
    }
    const values = text
      .split(/[,\s]+/)
      .map((x) => parseFloat(x))
      .filter((x) => Number.isFinite(x))
      .slice(0, limits.maxSweepValues);
    setConfig({ sweep: values.length >= 2 ? { parameter, values } : null });
  };

  const excluded = new Set(config.excluded);
  const featureColumns = (dataset?.columns ?? []).filter((c) => c.name !== config.target && c.type !== "id" && c.type !== "constant" && c.type !== "text");

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Training settings"
      subtitle="saved as you change them"
      icon={<SlidersHorizontal aria-hidden="true" />}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw />}
          onClick={() => {
            setConfig({ ...DEFAULT_ML_CONFIG, algorithm: config.algorithm, target: config.target, hyperparameters: { ...DEFAULT_HYPERPARAMETERS } });
            setLayersText(DEFAULT_HYPERPARAMETERS.hiddenLayers.join(", "));
            setSweepText("");
          }}
        >
          Defaults
        </Button>
      }
    >
      <div className="grid gap-6">
        <Section title={`${algo?.name ?? "Model"} hyperparameters`} hint={algo?.blurb}>
          {family === "gradient" ? (
            <>
              <Field label="Learning rate" hint="How far each update moves the weights. Too high diverges; too low crawls.">
                <Segmented size="sm" ariaLabel="Learning rate" value={h.learningRate} onChange={(v) => setHyper({ learningRate: v })} options={[0.001, 0.01, 0.05, 0.1, 0.3].map((v) => ({ value: v, label: String(v) }))} />
              </Field>
              <Field label="Epochs" hint={`Full passes over the training rows, up to ${limits.maxEpochs}.`}>
                <Range value={h.epochs} min={1} max={limits.maxEpochs} step={1} onChange={(v) => setHyper({ epochs: v })} />
              </Field>
              <Field label="Batch size" hint="Rows per gradient step. Smaller = noisier but more updates per epoch.">
                <Segmented size="sm" ariaLabel="Batch size" value={h.batchSize} onChange={(v) => setHyper({ batchSize: v })} options={[4, 8, 16, 32, 64, 128].map((v) => ({ value: v, label: String(v) }))} />
              </Field>
              <Field label="Optimizer" hint="Plain SGD, SGD with momentum, or Adam's per-weight step sizes.">
                <Segmented size="sm" ariaLabel="Optimizer" value={h.optimizer} onChange={(v) => setHyper({ optimizer: v })} options={[{ value: "sgd" as const, label: "SGD" }, { value: "momentum" as const, label: "Momentum" }, { value: "adam" as const, label: "Adam" }]} />
              </Field>
              <Field label="Regularization" hint="A penalty on large weights, added to the loss.">
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented size="sm" ariaLabel="Regularization" value={h.regularization} onChange={(v) => setHyper({ regularization: v })} options={[{ value: "none" as const, label: "none" }, { value: "l2" as const, label: "L2" }, { value: "l1" as const, label: "L1" }]} />
                  {h.regularization !== "none" ? <Segmented size="sm" ariaLabel="Regularization strength" value={h.regularizationStrength} onChange={(v) => setHyper({ regularizationStrength: v })} options={[0.0001, 0.001, 0.01, 0.1].map((v) => ({ value: v, label: `λ ${v}` }))} /> : null}
                </div>
              </Field>
              {config.algorithm === "neural_network" ? (
                <>
                  <Field label="Hidden layers" hint={`Widths separated by commas, up to ${limits.maxHiddenLayers} layers of ${limits.maxHiddenWidth} units. e.g. 16, 8`}>
                    <input value={layersText} onChange={(e) => setLayersText(e.target.value)} onBlur={(e) => commitLayers(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commitLayers((e.target as HTMLInputElement).value)} className="mono h-8 w-40 rounded-md border border-line bg-bg-elevated/80 px-2 text-[12px] text-ink focus:border-accent/60" aria-label="Hidden layer widths" />
                  </Field>
                  <Field label="Activation" hint="The non-linearity after each hidden layer.">
                    <Segmented size="sm" ariaLabel="Activation" value={h.activation} onChange={(v) => setHyper({ activation: v })} options={[{ value: "relu" as const, label: "ReLU" }, { value: "tanh" as const, label: "tanh" }, { value: "sigmoid" as const, label: "sigmoid" }]} />
                  </Field>
                </>
              ) : null}
              {config.algorithm === "svm" ? (
                <Field label="C" hint="How much a margin violation costs. Large C fits training rows tightly.">
                  <Segmented size="sm" ariaLabel="SVM C" value={h.svmC} onChange={(v) => setHyper({ svmC: v })} options={[0.01, 0.1, 1, 10, 100].map((v) => ({ value: v, label: String(v) }))} />
                </Field>
              ) : null}
            </>
          ) : null}
          {family === "tree" ? (
            <>
              <Field label="Max depth" hint={`Questions asked in a row, up to ${limits.maxDepth}. Deeper trees fit more and generalize less.`}>
                <Range value={h.maxDepth} min={1} max={limits.maxDepth} step={1} onChange={(v) => setHyper({ maxDepth: v })} />
              </Field>
              <Field label="Min rows per leaf" hint="A split is refused if a side would hold fewer rows.">
                <Range value={h.minSamplesLeaf} min={1} max={20} step={1} onChange={(v) => setHyper({ minSamplesLeaf: v })} />
              </Field>
              {config.algorithm === "random_forest" ? (
                <Field label="Trees" hint={`Each on a bootstrap sample with √d random features, up to ${limits.maxTrees}.`}>
                  <Range value={h.trees} min={1} max={limits.maxTrees} step={1} onChange={(v) => setHyper({ trees: v })} />
                </Field>
              ) : null}
            </>
          ) : null}
          {family === "instance" ? (
            <Field label="K" hint="How many nearest training rows vote. Odd values avoid ties.">
              <Range value={h.k} min={1} max={25} step={1} onChange={(v) => setHyper({ k: v })} />
            </Field>
          ) : null}
          {family === "probabilistic" ? <p className="text-[12px] text-muted leading-relaxed">Naive Bayes has no hyperparameters to tune: it fits one Gaussian per feature per class and a prior per class, in a single pass.</p> : null}
        </Section>

        <Section title="Preprocessing" hint="Fitted on the training rows only, then applied identically to validation, test and new rows.">
          <Field label="Missing values">
            <Segmented size="sm" ariaLabel="Imputation" value={config.impute} onChange={(v) => setConfig({ impute: v })} options={[{ value: "median" as const, label: "median" }, { value: "mean" as const, label: "mean" }, { value: "mode" as const, label: "mode" }, { value: "drop" as const, label: "drop rows" }]} />
          </Field>
          <Field label="Scaling" hint={family === "tree" || family === "probabilistic" ? "Trees and Naive Bayes do not need it, but it is harmless." : "Gradient models and KNN depend on it."}>
            <Segmented size="sm" ariaLabel="Scaling" value={config.scaling} onChange={(v) => setConfig({ scaling: v })} options={[{ value: "standard" as const, label: "standard" }, { value: "minmax" as const, label: "min-max" }, { value: "none" as const, label: "none" }]} />
          </Field>
          <Switch checked={config.polynomialFeatures} onChange={(v) => setConfig({ polynomialFeatures: v })} label="Polynomial features" description="Add squares of every numeric feature and pairwise products of the first three, so linear models can bend." />
          {featureColumns.length ? (
            <Field label="Columns to leave out" hint="Excluded columns are dropped before training.">
              <div className="flex flex-wrap gap-1">
                {featureColumns.map((c) => (
                  <button key={c.name} type="button" aria-pressed={excluded.has(c.name)} onClick={() => setConfig({ excluded: excluded.has(c.name) ? config.excluded.filter((x) => x !== c.name) : [...config.excluded, c.name] })} className={cn("mono rounded-md border px-2 h-6 text-[10.5px]", excluded.has(c.name) ? "border-err/50 bg-err/10 text-err line-through" : "border-line text-ink-dim hover:border-line-strong")}>
                    {c.name}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}
        </Section>

        <Section title="Split" hint="Rows are dealt once, with the seed, into train / validation / test.">
          <Field label={`Training ${Math.round(config.trainFraction * 100)}%`}>
            <Range value={Math.round(config.trainFraction * 100)} min={40} max={85} step={5} onChange={(v) => setConfig({ trainFraction: v / 100, validationFraction: Math.min(config.validationFraction, (95 - v) / 100) })} suffix="%" />
          </Field>
          <Field label={`Validation ${Math.round(config.validationFraction * 100)}% · test ${Math.round((1 - config.trainFraction - config.validationFraction) * 100)}%`}>
            <Range value={Math.round(config.validationFraction * 100)} min={5} max={Math.max(5, 95 - Math.round(config.trainFraction * 100) - 5)} step={5} onChange={(v) => setConfig({ validationFraction: v / 100 })} suffix="%" />
          </Field>
          <Switch checked={config.stratify} onChange={(v) => setConfig({ stratify: v })} label="Stratify by class" description="Keep every class's proportion the same in each split (classification only)." />
          <Field label="Seed" hint="Same seed, same shuffle, same initial weights: the run is reproducible.">
            <input type="number" value={config.seed} onChange={(e) => setConfig({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="mono h-8 w-28 rounded-md border border-line bg-bg-elevated/80 px-2 text-[12px] text-ink focus:border-accent/60" aria-label="Random seed" />
          </Field>
        </Section>

        {sweepable.length ? (
          <Section title="Hyperparameter sweep" hint={`Optional. Each value trains a real model on the same split; the best on validation is kept. Up to ${limits.maxSweepValues} values.`}>
            <Field label="Parameter">
              <div className="flex flex-wrap gap-1">
                <button type="button" aria-pressed={!config.sweep} onClick={() => commitSweep(null, "")} className={cn("mono rounded-md border px-2 h-6 text-[10.5px]", !config.sweep ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong")}>
                  off
                </button>
                {sweepable.map((s) => (
                  <button key={s.key} type="button" aria-pressed={config.sweep?.parameter === s.key} onClick={() => commitSweep(s.key, sweepText)} className={cn("mono rounded-md border px-2 h-6 text-[10.5px]", config.sweep?.parameter === s.key ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-ink-dim hover:border-line-strong")}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Values" hint="Comma-separated, at least two, e.g. 0.01, 0.05, 0.2">
              <input value={sweepText} onChange={(e) => setSweepText(e.target.value)} onBlur={(e) => config.sweep && commitSweep(config.sweep.parameter, e.target.value)} onKeyDown={(e) => e.key === "Enter" && config.sweep && commitSweep(config.sweep.parameter, (e.target as HTMLInputElement).value)} placeholder="0.01, 0.05, 0.2" className="mono h-8 w-56 rounded-md border border-line bg-bg-elevated/80 px-2 text-[12px] text-ink placeholder:text-faint focus:border-accent/60" aria-label="Sweep values" />
              {config.sweep ? <p className="mono text-[10.5px] text-muted">will train {config.sweep.values.length} models: {config.sweep.parameter} ∈ {"{"}{config.sweep.values.join(", ")}{"}"}</p> : null}
            </Field>
          </Section>
        ) : null}
      </div>
    </SideDrawer>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="label-caps text-ink-dim">{title}</h3>
        {hint ? <p className="text-[11.5px] leading-snug text-muted mt-0.5">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-[12.5px] text-ink">{label}</p>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

function Range({ value, min, max, step, onChange, suffix = "" }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--color-accent)]" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} />
      <span className="mono text-[12px] text-ink w-14 text-right tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  );
}
