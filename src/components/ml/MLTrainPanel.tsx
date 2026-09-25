import { useMemo, useState } from "react";
import { GitCompareArrows, Loader2, Play, SlidersHorizontal } from "lucide-react";
import { ALGORITHMS, type Algorithm, type Hyperparameters, type MLConfig, type MLTask } from "@shared/ml";
import { mlRuntime } from "@/engine/ml/mlRuntime";
import { cn } from "@/lib/cn";
import { selectDataset, useMLStore } from "@/store/mlStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";

/** The task a target column implies, mirroring the server's rule so the algorithm list matches what will run. */
export function inferTask(column: { type: string; unique: number } | undefined): MLTask | null {
  if (!column) return null;
  if (column.type === "numeric" && column.unique > 12) return "regression";
  return "classification";
}

type CompareAxis = "learningRate" | "epochs" | "batchSize" | "optimizer" | "regularization" | "hiddenLayers" | "maxDepth" | "trees" | "k" | "svmC" | "scaling";

interface Variant {
  label: string;
  overrides: Partial<MLConfig>;
}

const hp = (h: Partial<Hyperparameters>): Partial<MLConfig> => ({ hyperparameters: h as Hyperparameters });

const COMPARE: Record<CompareAxis, { label: string; families: ("gradient" | "tree" | "instance" | "probabilistic")[]; algorithms?: Algorithm[]; make: (c: MLConfig) => [Variant, Variant] }> = {
  learningRate: { label: "learning rate ÷5 vs ×5", families: ["gradient"], make: (c) => [{ label: `A · η ${+(c.hyperparameters.learningRate / 5).toPrecision(2)}`, overrides: hp({ learningRate: c.hyperparameters.learningRate / 5 }) }, { label: `B · η ${+(c.hyperparameters.learningRate * 5).toPrecision(2)}`, overrides: hp({ learningRate: c.hyperparameters.learningRate * 5 }) }] },
  epochs: { label: "epochs ÷3 vs ×2", families: ["gradient"], make: (c) => [{ label: `A · ${Math.max(1, Math.round(c.hyperparameters.epochs / 3))} epochs`, overrides: hp({ epochs: Math.max(1, Math.round(c.hyperparameters.epochs / 3)) }) }, { label: `B · ${c.hyperparameters.epochs * 2} epochs`, overrides: hp({ epochs: c.hyperparameters.epochs * 2 }) }] },
  batchSize: { label: "batch 4 vs 64", families: ["gradient"], make: () => [{ label: "A · batch 4", overrides: hp({ batchSize: 4 }) }, { label: "B · batch 64", overrides: hp({ batchSize: 64 }) }] },
  optimizer: { label: "SGD vs Adam", families: ["gradient"], make: () => [{ label: "A · sgd", overrides: hp({ optimizer: "sgd" }) }, { label: "B · adam", overrides: hp({ optimizer: "adam" }) }] },
  regularization: { label: "no L2 vs L2", families: ["gradient"], make: () => [{ label: "A · no regularization", overrides: hp({ regularization: "none" }) }, { label: "B · L2 λ 0.01", overrides: hp({ regularization: "l2", regularizationStrength: 0.01 }) }] },
  hiddenLayers: { label: "1 layer vs 2 layers", families: ["gradient"], algorithms: ["neural_network"], make: () => [{ label: "A · [8]", overrides: hp({ hiddenLayers: [8] }) }, { label: "B · [16, 8]", overrides: hp({ hiddenLayers: [16, 8] }) }] },
  maxDepth: { label: "depth 2 vs 8", families: ["tree"], make: () => [{ label: "A · depth 2", overrides: hp({ maxDepth: 2 }) }, { label: "B · depth 8", overrides: hp({ maxDepth: 8 }) }] },
  trees: { label: "3 trees vs 30", families: ["tree"], algorithms: ["random_forest"], make: () => [{ label: "A · 3 trees", overrides: hp({ trees: 3 }) }, { label: "B · 30 trees", overrides: hp({ trees: 30 }) }] },
  k: { label: "K = 1 vs 15", families: ["instance"], make: () => [{ label: "A · K 1", overrides: hp({ k: 1 }) }, { label: "B · K 15", overrides: hp({ k: 15 }) }] },
  svmC: { label: "C 0.1 vs 10", families: ["gradient"], algorithms: ["svm"], make: () => [{ label: "A · C 0.1", overrides: hp({ svmC: 0.1 }) }, { label: "B · C 10", overrides: hp({ svmC: 10 }) }] },
  scaling: { label: "no scaling vs standard", families: ["gradient", "instance"], make: () => [{ label: "A · unscaled", overrides: { scaling: "none" } }, { label: "B · standardized", overrides: { scaling: "standard" } }] },
};

/** One line of what will run, for the button that opens the drawer. */
export function configSummary(c: MLConfig): string {
  const h = c.hyperparameters;
  const algo = ALGORITHMS.find((a) => a.id === c.algorithm);
  const parts: string[] = [];
  switch (algo?.family) {
    case "gradient":
      parts.push(`η ${h.learningRate}`, `${h.epochs} epochs`, `batch ${h.batchSize}`, h.optimizer);
      if (h.regularization !== "none") parts.push(`${h.regularization} λ ${h.regularizationStrength}`);
      if (c.algorithm === "neural_network") parts.push(`[${h.hiddenLayers.join(", ")}] ${h.activation}`);
      if (c.algorithm === "svm") parts.push(`C ${h.svmC}`);
      break;
    case "tree":
      parts.push(`depth ${h.maxDepth}`, `leaf ≥ ${h.minSamplesLeaf}`);
      if (c.algorithm === "random_forest") parts.push(`${h.trees} trees`);
      break;
    case "instance":
      parts.push(`K ${h.k}`);
      break;
    default:
      break;
  }
  parts.push(`${c.impute} impute`, `${c.scaling} scale`, `${Math.round(c.trainFraction * 100)}/${Math.round(c.validationFraction * 100)}/${Math.round((1 - c.trainFraction - c.validationFraction) * 100)}`, `seed ${c.seed}`);
  if (c.sweep) parts.push(`sweep ${c.sweep.parameter} × ${c.sweep.values.length}`);
  return parts.join(" · ");
}

/**
 * What to predict and how: the target column, the algorithm (filtered to those
 * that fit the task), then RUN. Compare trains twice with one knob changed.
 * Everything else lives in the settings drawer.
 */
export function MLTrainPanel({ className, onOpenSettings }: { className?: string; onOpenSettings: () => void }) {
  const dataset = useMLStore(selectDataset);
  const config = useMLStore((s) => s.config);
  const setConfig = useMLStore((s) => s.setConfig);
  const starting = useMLStore((s) => s.starting);
  const setStarting = useMLStore((s) => s.setStarting);
  const startError = useMLStore((s) => s.startError);
  const status = useMLStore((s) => s.status);
  const runs = useMLStore((s) => s.runs);
  const anyRunning = Object.values(runs).some((r) => r.status === "running");
  const [axis, setAxis] = useState<CompareAxis>("learningRate");

  const columns = dataset?.columns ?? [];
  const usable = columns.filter((c) => c.type !== "id" && c.type !== "constant" && c.type !== "text");
  const suggested = status?.samples.find((s) => s.id === dataset?.id)?.suggestedTarget;
  const targetName = config.target && usable.some((c) => c.name === config.target) ? config.target : suggested && usable.some((c) => c.name === suggested) ? suggested : usable.at(-1)?.name;
  const targetColumn = columns.find((c) => c.name === targetName);
  const task = inferTask(targetColumn);
  const algorithms = ALGORITHMS.filter((a) => !task || a.tasks.includes(task));
  const algo = ALGORITHMS.find((a) => a.id === config.algorithm);
  const algoFits = Boolean(algo && (!task || algo.tasks.includes(task)));

  const axes = useMemo(() => (Object.keys(COMPARE) as CompareAxis[]).filter((k) => algo && COMPARE[k].families.includes(algo.family) && (!COMPARE[k].algorithms || COMPARE[k].algorithms!.includes(algo.id))), [algo]);
  const activeAxis = axes.includes(axis) ? axis : (axes[0] ?? null);

  const canRun = Boolean(dataset && targetName && algoFits && !starting);

  const submit = async (mode: "run" | "compare") => {
    if (!canRun) return;
    setStarting(true);
    try {
      const overrides: Partial<MLConfig> = { target: targetName ?? null };
      if (mode === "run") await mlRuntime.start(overrides);
      else if (activeAxis) {
        const [a, b] = COMPARE[activeAxis].make(config);
        await mlRuntime.compare([
          { label: a.label, overrides: { ...overrides, ...a.overrides, hyperparameters: a.overrides.hyperparameters } },
          { label: b.label, overrides: { ...overrides, ...b.overrides, hyperparameters: b.overrides.hyperparameters } },
        ]);
      }
      setStarting(false);
    } catch (err) {
      setStarting(false, err instanceof Error ? err.message : "Training could not start.");
    }
  };

  return (
    <GlassPanel
      className={className}
      title="Train a model"
      subtitle={dataset ? (task ? `${task} · predict "${targetName}"` : "choose a target") : "pick a dataset first"}
      actions={
        <>
          <Button size="sm" variant="outline" icon={<SlidersHorizontal />} onClick={onOpenSettings} aria-haspopup="dialog" title={configSummary(config)}>
            Settings
          </Button>
          <SourceBadge source="live" compact />
        </>
      }
      bodyClassName="p-3.5 grid gap-3 content-start"
    >
      <div className="grid gap-1.5">
        <p className="label-caps">Target · the column to predict</p>
        <div className="flex flex-wrap gap-1">
          {usable.map((c) => {
            const t = inferTask(c);
            return (
              <button key={c.name} type="button" onClick={() => setConfig({ target: c.name })} aria-pressed={targetName === c.name} className={cn("mono rounded-md border px-2 h-7 text-[11px] inline-flex items-center gap-1.5", targetName === c.name ? "border-warn/60 bg-warn/10 text-ink" : "border-line text-ink-dim hover:border-line-strong")} title={`${c.type} · ${c.unique} distinct values → ${t}`}>
                {c.name}
                <span className="text-faint">{t === "regression" ? "number" : `${c.unique} classes`}</span>
              </button>
            );
          })}
          {!usable.length ? <span className="mono text-[11px] text-muted">no usable columns yet</span> : null}
        </div>
      </div>

      <div className="grid gap-1.5">
        <p className="label-caps">Algorithm {task ? <span className="text-faint normal-case tracking-normal">· {algorithms.length} fit {task}</span> : null}</p>
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {algorithms.map((a) => {
            const active = config.algorithm === a.id;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => setConfig({ algorithm: a.id, sweep: null })} aria-pressed={active} className={cn("w-full h-full text-left rounded-lg border px-2.5 py-1.5 grid gap-0.5 min-w-0", active ? "border-accent/60 bg-accent/[0.08]" : "border-line surface-1 hover:border-line-strong")}>
                  <span className="text-[12px] text-ink leading-tight">{a.name}</span>
                  <span className="text-[10.5px] leading-snug text-muted line-clamp-2">{a.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!algoFits && algo && task ? (
          <p className="text-[11.5px] text-warn leading-snug">
            {algo.name} does not do {task}. Pick one of the algorithms above, or a different target.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <Button variant="primary" icon={starting ? <Loader2 className="animate-spin" /> : <Play />} disabled={!canRun} onClick={() => void submit("run")} className="min-w-[104px]">
          RUN
        </Button>
        {anyRunning ? <Badge tone="live">training</Badge> : null}
        <Button size="sm" variant="outline" icon={<GitCompareArrows />} disabled={!canRun || !activeAxis} onClick={() => void submit("compare")} className="ml-auto" title="Train twice with one setting changed and compare">
          Compare
        </Button>
      </div>
      {axes.length ? (
        <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Segmented<CompareAxis> ariaLabel="Comparison" size="sm" value={activeAxis ?? axes[0]!} onChange={setAxis} options={axes.map((k) => ({ value: k, label: COMPARE[k].label }))} />
        </div>
      ) : null}
      <button type="button" onClick={onOpenSettings} className="mono text-left text-[10px] text-faint hover:text-muted truncate" title="Open training settings">
        {configSummary(config)}
      </button>
      {startError ? <p className="text-[12px] leading-snug text-err">{startError}</p> : null}
    </GlassPanel>
  );
}
