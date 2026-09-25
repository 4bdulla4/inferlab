import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { runtime } from "@/engine/execution/runtime";
import { useActiveRun } from "@/hooks/useActiveRun";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useScrollOnRun } from "@/hooks/useScrollOnRun";
import { cn } from "@/lib/cn";
import { useExecutionStore } from "@/store/executionStore";
import { selectProvider, useUIStore } from "@/store/uiStore";
import { ComparisonView } from "@/components/llm/ComparisonView";
import { InspectorPanel, VisualizationPanel } from "@/components/llm/InspectorPanel";
import { LLMInput } from "@/components/llm/LLMInput";
import { MetricsPanel } from "@/components/llm/MetricsPanel";
import { OutputPanel } from "@/components/llm/OutputPanel";
import { PromptBar } from "@/components/llm/PromptBar";
import { StageFrame } from "@/components/llm/StageFrame";

/**
 * The LLM lab.
 *
 * The page has two faces. With nothing running it is a composer: one question,
 * front and centre, over a dimmed preview of the machinery. The moment a run
 * starts the composer folds into a single line and the inspector rises into the
 * space it leaves, so the narration of the running stage sits at eye level. The
 * pipeline takes the stage with its event log beside it, and the answer
 * surfaces on its own as the first token lands. Other labs will provide their
 * own component here.
 */
export function LLMLab() {
  const run = useActiveRun();
  const comparisonRunIds = useExecutionStore((s) => s.comparisonRunIds);
  const runs = useExecutionStore((s) => s.runs);
  const comparisonRuns = comparisonRunIds?.map((id) => runs[id]).filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];
  const selectStage = useUIStore((s) => s.selectStage);
  const selectedProvider = useUIStore(selectProvider);
  const reduced = useReducedMotion();
  const mockActive = Boolean(run?.provider.mock ?? selectedProvider?.mock);

  // Pressing run folds the composer away and builds the stage underneath it.
  // Scroll there so the reader watches the pipeline, not the empty prompt bar.
  const stageRef = useScrollOnRun<HTMLDivElement>(run?.id);

  // Editing reopens the composer over a run that is already on the stage.
  const [composing, setComposing] = useState(false);
  const onEscape = useCallback(() => selectStage(null), [selectStage]);
  useKeyboardShortcuts(onEscape);

  const onNewRun = useCallback(() => {
    runtime.resetAll();
    selectStage(null);
    setComposing(true);
  }, [selectStage]);

  // A fresh run always closes the composer, however it was started.
  useEffect(() => {
    if (run) setComposing(false);
  }, [run?.id]);

  const focusComposer = useCallback(() => {
    setComposing(true);
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLTextAreaElement>("textarea");
      box?.focus();
      box?.select();
    });
  }, []);

  const showComposer = !run || composing;
  const answering = Boolean(run?.visual.generation.started);

  if (comparisonRuns.length > 1) {
    return (
      <div className="mx-auto max-w-[1720px] p-4 grid gap-4">
        <LLMInput run={run} />
        <ComparisonView runs={comparisonRuns} />
      </div>
    );
  }

  return (
    <div className="@container mx-auto max-w-[1720px] p-4 grid gap-4 content-start">
      {mockActive ? (
        <div role="status" className="rounded-lg border border-warn/50 bg-warn/10 px-4 py-2.5 text-[12.5px] text-warn flex items-center gap-3">
          <span className="mono text-[10px] tracking-[0.14em] uppercase border border-warn/50 rounded px-1.5 py-0.5 shrink-0">offline demo</span>
          <span>The "Offline demo" provider calls no API. Values it reports are synthetic stand-ins for live telemetry. Add an API key to see real Claude or OpenAI data.</span>
        </div>
      ) : null}

      <AnimatePresence mode="popLayout" initial={false}>
        {showComposer ? (
          <motion.div
            key="composer"
                  initial={reduced ? false : { opacity: 0, y: -12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.97 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }}
            className="min-w-0"
          >
            <LLMInput run={run} heading={!run} onCancel={run ? () => setComposing(false) : undefined} />
          </motion.div>
        ) : run ? (
          <PromptBar key="promptbar" run={run} onEdit={focusComposer} reduced={reduced} />
        ) : null}
      </AnimatePresence>

      <div ref={stageRef} className="scroll-mt-20 grid gap-4 min-w-0">
        <AnimatePresence initial={false}>
          {run && !composing ? (
            <motion.div
              key="inspector"
              initial={reduced ? false : { opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }}
              className="min-w-0"
            >
              {/* One fixed height for both, so neither panel resizes as stages come
                  and go; each body scrolls inside its own frame. */}
              <div className="grid gap-4 min-w-0 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-stretch">
                <InspectorPanel run={run} className="h-[min(40vh,340px)]" />
                <VisualizationPanel run={run} className="h-[min(40vh,340px)]" />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <StageFrame run={run} onNewRun={onNewRun} reduced={reduced} dimmed={!run} />
      </div>

      {/* Telemetry holds the left column; the answer keeps the rest. Explicit
          placement lets the answer stay first in reading order when the row
          collapses to one column. */}
      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)] items-start">
        <AnimatePresence initial={false}>
          {answering && run ? (
            <ResponseReveal key="response" reduced={reduced} className="xl:col-start-2 xl:row-start-1">
              <OutputPanel run={run} />
            </ResponseReveal>
          ) : (
            <div key="response-placeholder" className="min-w-0 xl:col-start-2 xl:row-start-1" />
          )}
        </AnimatePresence>
        <MetricsPanel run={run} className="min-w-0 xl:col-start-1 xl:row-start-1" />
      </div>
    </div>
  );
}

/** Brings the answer forward on its own, and scrolls it into view the first time. */
function ResponseReveal({ children, reduced, className }: { children: React.ReactNode; reduced: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const t = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 220);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 26, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 28 }}
      className={cn(
        "min-w-0 rounded-xl shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent),0_18px_50px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
