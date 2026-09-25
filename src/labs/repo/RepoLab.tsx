import { useEffect } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { useRepoStatus } from "@/hooks/useRepoStatus";
import { useScrollOnRun } from "@/hooks/useScrollOnRun";
import { useRepoStore } from "@/store/repoStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { PanelGrid } from "@/components/layout/PanelGrid";
import { ArchitectureDiagram } from "@/components/repo/ArchitectureDiagram";
import { EvidenceBadge } from "@/components/repo/EvidenceBadge";
import { FactsPanel } from "@/components/repo/FactsPanel";
import { OverviewPanel } from "@/components/repo/OverviewPanel";
import { QuestionPanel } from "@/components/repo/QuestionPanel";
import { RepoInput } from "@/components/repo/RepoInput";
import { RepoInspector } from "@/components/repo/RepoInspector";
import { tracePlayer } from "./tracePlayer";

const REPO_LAYOUT = [
  ["repository", "overview", "diagram", "facts"],
  ["question", "inspector"],
];

/** GitHub Product Analyzer dashboard. Shares the shell, stores, playback and particle engines with the LLM lab. */
export function RepoLab() {
  useRepoStatus();
  const analysis = useRepoStore((s) => s.analysis);
  const status = useRepoStore((s) => s.status);
  const select = useRepoStore((s) => s.select);
  const url = useRepoStore((s) => s.url);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "Escape") select(null);
      const trace = useRepoStore.getState().trace;
      if (!trace) return;
      if (e.key === " ") {
        e.preventDefault();
        tracePlayer.toggle(trace.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        tracePlayer.step(trace.id);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        tracePlayer.restart(trace.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [select]);

  useEffect(() => () => tracePlayer.dispose(), []);

  // A rescan keeps the previous result on screen; it is dimmed and labelled so
  // nobody reads it as the new one.
  const stale = status === "analyzing" && Boolean(analysis);

  // Analyze sits at the top of the page and the diagram is the thing the reader
  // pressed it for, so a new scan brings the diagram up to meet them.
  const diagramRef = useScrollOnRun<HTMLDivElement>(status === "analyzing" ? url : null);

  const panels = {
    repository: <RepoInput />,
    overview: analysis ? (
      <Stale stale={stale}>
        <OverviewPanel analysis={analysis} />
      </Stale>
    ) : null,
    diagram: (
      <div ref={diagramRef} className="scroll-mt-20 min-w-0">
        {analysis ? (
      <Stale stale={stale} notice={`Previous analysis of ${analysis.meta.fullName}. The new scan is still running.`}>
      <GlassPanel
        title="Architecture & workflow"
        subtitle={`${analysis.graph.nodes.length} modules · ${analysis.graph.edges.length} relationships · click a module to inspect`}
        actions={
          <>
            <EvidenceBadge kind="verified" compact />
            <EvidenceBadge kind="heuristic" compact />
            <EvidenceBadge kind="ai" compact />
          </>
        }
        bodyClassName="p-3"
      >
        <ArchitectureDiagram analysis={analysis} />
      </GlassPanel>
      </Stale>
        ) : (
      <GlassPanel title="Architecture & workflow" bodyClassName="p-8">
        <div className="grid place-items-center gap-3 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-xl border border-line surface-1">
            <GitBranch className="size-5 text-accent-soft" aria-hidden="true" />
          </span>
          <p className="text-[14px] text-ink">Paste a GitHub repository URL to map how the product works. Private repositories work with your own GitHub token.</p>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-muted">
            The analyzer reads the repository, detects frontend, backend, API routes, database schema, authentication, dependencies, environment variables, AI integrations, queues, cron jobs, webhooks, external services and deployment configuration, then draws an interactive architecture diagram with the real files, functions and routes attached to every module.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <EvidenceBadge kind="verified" />
            <EvidenceBadge kind="heuristic" />
            <EvidenceBadge kind="ai" />
          </div>
          {status === "analyzing" ? <p className="mono text-[11px] text-live">analyzing…</p> : null}
        </div>
      </GlassPanel>
        )}
      </div>
    ),
    facts: analysis ? (
      <Stale stale={stale}>
        <FactsPanel analysis={analysis} />
      </Stale>
    ) : null,
    question: <QuestionPanel />,
    inspector: (
      <Stale stale={stale}>
        <RepoInspector analysis={analysis} />
      </Stale>
    ),
  };

  return (
    <PanelGrid
      lab="repo"
      fallback={REPO_LAYOUT}
      panels={panels}
      widePanels={["diagram"]}
      className="mx-auto max-w-[1720px] p-4 grid gap-4 xl:grid-cols-2 items-start"
      wideColumnClassName="grid gap-4 min-w-0 content-start"
      narrowColumnClassName="grid gap-4 min-w-0 content-start xl:sticky xl:top-[80px] xl:max-h-[calc(100vh-96px)] xl:overflow-y-auto panel-scroll"
    />
  );
}

/**
 * Holds a finished result on screen while the next scan runs. It is dimmed and
 * made inert so it reads as history, never as the analysis in progress.
 */
function Stale({ stale, notice, children }: { stale: boolean; notice?: string; children: React.ReactNode }) {
  if (!stale) return <>{children}</>;
  return (
    <div aria-busy="true" className="grid gap-2 min-w-0">
      {notice ? (
        <p className="mono flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.1em] text-warn">
          <Loader2 className="size-3 animate-spin shrink-0" aria-hidden="true" />
          {notice}
        </p>
      ) : null}
      <div className="min-w-0 opacity-50 pointer-events-none select-none">{children}</div>
    </div>
  );
}
