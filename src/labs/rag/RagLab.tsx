import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, GitCompareArrows, Loader2, PanelRightClose, PanelRightOpen, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import type { RagSettings } from "@shared/rag";
import { ragRuntime } from "@/engine/rag/ragRuntime";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useScrollOnRun } from "@/hooks/useScrollOnRun";
import { cn } from "@/lib/cn";
import { selectActiveRagRun, useRagStore } from "@/store/ragStore";
import { useUIStore } from "@/store/uiStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Legend } from "@/components/layout/Legend";
import { SourceBadge } from "@/components/layout/SourceBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { AskAboutRag } from "@/components/rag/AskAboutRag";
import { KnowledgeSourcePanel } from "@/components/rag/KnowledgeSourcePanel";
import { RagAnswerPanel } from "@/components/rag/RagAnswerPanel";
import { RagCompare } from "@/components/rag/RagCompare";
import { RagInspectorPanel, RagVisualizationPanel } from "@/components/rag/RagInspector";
import { RagPipeline } from "@/components/rag/RagPipeline";
import { RagPlaybackControls } from "@/components/rag/RagPlaybackControls";
import { RagSettingsDrawer, settingsSummary } from "@/components/rag/RagSettingsDrawer";
import { RagTimeline } from "@/components/rag/RagTimeline";

type CompareAxis = "strategy" | "index" | "topK" | "chunking";

const COMPARE_VARIANTS: Record<CompareAxis, { label: string; a: { label: string; overrides: Partial<RagSettings> }; b: (s: RagSettings) => { label: string; overrides: Partial<RagSettings> }; needsRebuild?: boolean }> = {
  strategy: { label: "Similarity vs MMR", a: { label: "A · similarity", overrides: { retrievalStrategy: "similarity" } }, b: () => ({ label: "B · MMR", overrides: { retrievalStrategy: "mmr" } }) },
  index: { label: "Similarity vs Hybrid", a: { label: "A · similarity", overrides: { retrievalStrategy: "similarity" } }, b: () => ({ label: "B · hybrid (BM25 + vector)", overrides: { retrievalStrategy: "hybrid" } }) },
  topK: { label: "Top-2 vs Top-6", a: { label: "A · top-2", overrides: { topK: 2 } }, b: () => ({ label: "B · top-6", overrides: { topK: 6 } }) },
  chunking: { label: "Threshold 0.1 vs 0.5", a: { label: "A · threshold 0.1", overrides: { similarityThreshold: 0.1 } }, b: () => ({ label: "B · threshold 0.5", overrides: { similarityThreshold: 0.5 } }) },
};

/**
 * The RAG lab. Sources and the question lead the page, then the stage: the two
 * inspector panels, the diagram with its event log, and the answer traced back
 * to its passages. Tuning lives in a drawer opened from the question panel, so
 * the knobs never compete with the run for space. Every stage is driven by the
 * run's execution log, so replaying redraws exactly the same run.
 */
export function RagLab() {
  const run = useRagStore(selectActiveRagRun);
  const runs = useRagStore((s) => s.runs);
  const comparisonRunIds = useRagStore((s) => s.comparisonRunIds);
  const kb = useRagStore((s) => s.kb);
  const kbStatus = useRagStore((s) => s.kbStatus);
  const question = useRagStore((s) => s.question);
  const setQuestion = useRagStore((s) => s.setQuestion);
  const selectStage = useRagStore((s) => s.selectStage);
  const legendOpen = useUIStore((s) => s.legendOpen);
  const setLegendOpen = useUIStore((s) => s.setLegendOpen);
  const timelineOpen = useUIStore((s) => s.timelineOpen);
  const setTimelineOpen = useUIStore((s) => s.setTimelineOpen);
  const reduced = useReducedMotion();
  const settings = useRagStore((s) => s.settings);
  const [compareAxis, setCompareAxis] = useState<CompareAxis>("strategy");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const stageRef = useScrollOnRun<HTMLDivElement>(run?.id);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ragRuntime.refreshStatus();
    void ragRuntime.ensureKb().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.key === "Escape") selectStage(null);
      if (!run) return;
      if (e.key === " ") {
        e.preventDefault();
        ragRuntime.toggle(run.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        ragRuntime.step(run.id);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        ragRuntime.replay(run.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run, selectStage]);

  const canAsk = Boolean(kb && kb.documents.length > 0 && !kb.stale && question.trim() && !asking);

  const submit = useCallback(
    async (mode: "ask" | "compare") => {
      if (!canAsk) return;
      setAsking(true);
      setError(null);
      selectStage(null);
      try {
        if (mode === "ask") await ragRuntime.ask(question.trim());
        else {
          const v = COMPARE_VARIANTS[compareAxis];
          await ragRuntime.compare(question.trim(), [v.a, v.b(useRagStore.getState().settings)]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "The question could not be sent.");
      } finally {
        setAsking(false);
      }
    },
    [canAsk, question, compareAxis, selectStage],
  );

  const comparisonRuns = comparisonRunIds?.map((id) => runs[id]).filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];
  const answering = Boolean(run && run.kind === "query");

  return (
    <div className="@container mx-auto max-w-[1720px] p-4 grid gap-4 content-start">
      {/* Sources and the question sit together: what the system may know, and what is asked of it. */}
      <div className="grid gap-4 min-w-0 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-stretch">
        <KnowledgeSourcePanel className="h-full" />
        <GlassPanel
        className="h-full"
        title="Ask the knowledge base"
        subtitle={kb ? (kb.documents.length ? `${kb.chunks.length} chunks ready${kb.stale ? " · rebuild needed" : ""}` : "add a document first") : kbStatus === "loading" ? "connecting…" : undefined}
        actions={
          <>
            <Button
              size="sm"
              variant={kb?.stale ? "live" : "outline"}
              icon={<SlidersHorizontal />}
              onClick={() => setSettingsOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              title={settingsSummary(settings)}
            >
              Settings
            </Button>
            <SourceBadge source="live" compact />
          </>
        }
        bodyClassName="p-3.5"
      >
        <form
          className="grid gap-2 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("ask");
          }}
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit("ask");
            }}
            rows={3}
            maxLength={2000}
            placeholder={kb?.documents.length ? "What does the document say about…?" : "Add a document on the left, then ask about it here"}
            aria-label="Question for the knowledge base"
            className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13.5px] leading-normal text-ink placeholder:text-faint focus:border-accent/60"
          />
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Button type="submit" variant="primary" icon={asking ? <Loader2 className="animate-spin" /> : <Search />} disabled={!canAsk} className="min-w-[104px]">
              RUN
            </Button>
            <span className="mono text-[10.5px] text-muted">⌘/Ctrl + Enter</span>
            <Button type="button" size="sm" variant="outline" icon={<GitCompareArrows />} disabled={!canAsk} onClick={() => void submit("compare")} className="ml-auto" title="Run the same question twice with different settings and compare">
              Compare
            </Button>
          </div>
          <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Segmented<CompareAxis> ariaLabel="Comparison" size="sm" value={compareAxis} onChange={setCompareAxis} options={(Object.keys(COMPARE_VARIANTS) as CompareAxis[]).map((k) => ({ value: k, label: COMPARE_VARIANTS[k].label }))} />
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)} className="mono text-left text-[10px] text-faint hover:text-muted truncate" title="Open pipeline settings">
            {settingsSummary(settings)}
          </button>
          {kb?.stale ? <p className="text-[11.5px] leading-snug text-warn">Chunking or embedding settings changed since the index was built. Rebuild it before asking.</p> : null}
          {error ? <p className="text-[12px] leading-snug text-err">{error}</p> : null}
        </form>
        </GlassPanel>
      </div>

      {comparisonRuns.length > 1 ? <RagCompare runs={comparisonRuns} /> : null}

      {/* The stage: what a run lights up, scrolled to when one begins. */}
      <div ref={stageRef} className="scroll-mt-20 grid gap-4 min-w-0">
      <AnimatePresence initial={false}>
        {run ? (
          <motion.div key="inspectors" initial={reduced ? false : { opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }} className="min-w-0">
            <div className="grid gap-4 min-w-0 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-stretch">
              <RagInspectorPanel run={run} className="h-[min(44vh,380px)]" />
              <RagVisualizationPanel run={run} className="h-[min(44vh,380px)]" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: run ? 1 : 0.6, y: 0 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }} className="min-w-0">
        <GlassPanel
          title="Live RAG pipeline"
          subtitle={run ? (run.kind === "ingest" ? `indexing · ${run.label}` : `answering · ${run.label}`) : "add a document or ask a question"}
          actions={
            <>
              <SourceBadge source="live" compact />
              <SourceBadge source="simulation" compact />
              {run ? <Badge tone={run.status === "running" ? "live" : run.status === "error" ? "err" : "ok"}>{run.status}</Badge> : null}
              <Button size="sm" variant="ghost" icon={<BookOpen />} onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}>
                Legend
              </Button>
              <Button size="sm" variant="ghost" icon={timelineOpen ? <PanelRightClose /> : <PanelRightOpen />} onClick={() => setTimelineOpen(!timelineOpen)} aria-expanded={timelineOpen}>
                Timeline
              </Button>
            </>
          }
          bodyClassName="p-3 grid gap-3"
        >
          {legendOpen ? (
            <div className="rounded-lg border border-line surface-1 p-3">
              <Legend />
            </div>
          ) : null}
          <div className={cn("grid gap-3 min-w-0", timelineOpen && "@4xl:grid-cols-[minmax(0,1fr)_320px]")}>
            <div className="min-w-0">
              <RagPipeline run={run} dimmed={!run} />
            </div>
            {timelineOpen ? (
              <div className="relative min-w-0">
                <div className="flex flex-col overflow-hidden rounded-lg border border-line surface-1 max-h-[380px] @4xl:absolute @4xl:inset-0 @4xl:max-h-none">
                  <p className="label-caps px-3 h-9 flex items-center border-b border-line shrink-0">
                    Execution timeline
                    {run ? (
                      <span className="ml-auto mono text-[10px] text-muted">
                        {run.cursor}/{run.log.length}
                      </span>
                    ) : null}
                  </p>
                  <RagTimeline run={run} follow className="flex-1 min-h-0 overflow-y-auto panel-scroll" />
                </div>
              </div>
            ) : null}
          </div>
          <div className="border-t border-line pt-3">
            <RagPlaybackControls run={run} />
          </div>
        </GlassPanel>
      </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {answering && comparisonRuns.length < 2 ? (
          <motion.div key="answer" initial={reduced ? false : { opacity: 0, y: 26, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 28 }} className="min-w-0 rounded-xl shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent),0_18px_50px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]">
            <RagAnswerPanel run={run} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!run && kbStatus === "ready" && kb && kb.documents.length === 0 ? (
        <p className="mono text-[11px] text-faint flex items-center gap-2 justify-center py-1">
          <Sparkles className="size-3" aria-hidden="true" />
          Start by dropping a PDF or pasting text above. Everything stays on this machine and is gone two hours after you stop.
        </p>
      ) : null}

      {/* Configuration sits under the stage: it is set once, then watched. */}
      <AskAboutRag />

      <RagSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
