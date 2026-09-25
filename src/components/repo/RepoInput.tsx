import { GitBranch, KeyRound, Loader2, Lock, RotateCcw, Search, Square } from "lucide-react";
import { useRef } from "react";
import { analyzeRepo } from "@/api/repoClient";
import { useRepoStore } from "@/store/repoStore";
import { useUIStore } from "@/store/uiStore";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { GlassPanel } from "@/components/layout/GlassPanel";

const SAMPLES = [
  { label: "vercel/ai-chatbot", url: "https://github.com/vercel/ai-chatbot", hint: "Next.js · Drizzle · Auth.js · AI SDK" },
  { label: "fastapi/full-stack-fastapi-template", url: "https://github.com/fastapi/full-stack-fastapi-template", hint: "FastAPI · React · SQLModel · Docker" },
  { label: "gothinkster/node-express-realworld-example-app", url: "https://github.com/gothinkster/node-express-realworld-example-app", hint: "Express · Prisma · JWT" },
];

let activeAbort: AbortController | null = null;

export function RepoInput() {
  const url = useRepoStore((s) => s.url);
  const setUrl = useRepoStore((s) => s.setUrl);
  const status = useRepoStore((s) => s.status);
  const phases = useRepoStore((s) => s.phases);
  const progress = useRepoStore((s) => s.progress);
  const error = useRepoStore((s) => s.error);
  const analysis = useRepoStore((s) => s.analysis);
  const service = useRepoStore((s) => s.serviceStatus);
  const openSettingsFor = useUIStore((s) => s.openSettingsFor);
  const inputRef = useRef<HTMLInputElement>(null);
  const needsToken = Boolean(error && /private|token|rate limit/i.test(error));

  const analyzing = status === "analyzing";

  const run = async (target = url) => {
    const store = useRepoStore.getState();
    if (!target.trim() || analyzing) return;
    activeAbort?.abort();
    const abort = new AbortController();
    activeAbort = abort;
    store.startAnalysis(target.trim());
    try {
      const result = await analyzeRepo({ url: target.trim() }, (e) => useRepoStore.getState().applyAnalyzeEvent(e), abort.signal);
      if (!abort.signal.aborted) useRepoStore.getState().finishAnalysis(result);
    } catch (err) {
      if (abort.signal.aborted) return;
      useRepoStore.getState().failAnalysis(err instanceof Error ? err.message : "Analysis failed.");
    }
  };

  const stop = () => {
    activeAbort?.abort();
    useRepoStore.getState().failAnalysis("Analysis cancelled.");
  };

  const last = phases[phases.length - 1];

  return (
    <GlassPanel
      title="Repository"
      subtitle={analysis ? `${analysis.meta.fullName} @ ${analysis.meta.sha.slice(0, 7)}${analysis.meta.isPrivate ? " · private" : ""}` : "paste a GitHub URL (public, or private with your token)"}
      actions={
        <span className="flex items-center gap-2">
          {analysis?.meta.isPrivate ? (
            <Badge tone="warn" className="gap-1"><Lock className="size-3" aria-hidden="true" />private</Badge>
          ) : null}
          {service ? (
            <>
              <button
                type="button"
                onClick={() => openSettingsFor("github")}
                className="hidden sm:inline-flex"
                title={service.githubTokenConfigured ? "GitHub token in use: private repositories and 5,000 requests/hour" : "No GitHub token: public repositories only, 60 requests/hour. Click to add one."}
              >
                <Badge tone={service.githubTokenConfigured ? "ok" : "neutral"} className="cursor-pointer hover:border-line-strong">{service.githubTokenConfigured ? "github token" : "anonymous github · add token"}</Badge>
              </button>
              <Badge tone={service.ai.available ? "sim" : "neutral"}>{service.ai.available ? `ai · ${service.ai.model}` : "ai off"}</Badge>
            </>
          ) : null}
        </span>
      }
      bodyClassName="p-4 grid gap-3"
    >
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="relative flex-1">
          <GitBranch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repository"
            aria-label="GitHub repository URL"
            disabled={analyzing}
            className="mono h-11 w-full rounded-lg border border-line bg-bg-elevated/80 pl-10 pr-3 text-[13px] text-ink placeholder:text-faint focus:border-accent/60 disabled:opacity-60"
          />
        </label>
        {analyzing ? (
          <Button type="button" size="lg" variant="danger" icon={<Square />} onClick={stop}>
            STOP
          </Button>
        ) : (
          <Button type="submit" size="lg" variant="primary" icon={<Search />} disabled={!url.trim()} className="min-w-[140px]">
            ANALYZE
          </Button>
        )}
        {analysis && !analyzing ? (
          <Button type="button" size="lg" variant="outline" icon={<RotateCcw />} onClick={() => useRepoStore.getState().reset()}>
            NEW
          </Button>
        ) : null}
      </form>

      {status === "idle" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-caps">Try</span>
          {SAMPLES.map((s) => (
            <button
              key={s.url}
              type="button"
              onClick={() => {
                setUrl(s.url);
                void run(s.url);
              }}
              className="mono rounded-md border border-line surface-1 px-2 h-7 text-[11px] text-ink-dim hover:border-line-strong hover:text-ink"
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      {analyzing || (status === "ready" && phases.length > 0 && progress < 1) ? (
        <div className="grid gap-2" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-live transition-[width] duration-300" style={{ width: `${Math.max(3, progress * 100)}%` }} />
          </div>
          <p className="mono flex items-center gap-2 text-[11.5px] text-ink-dim">
            <Loader2 className="size-3.5 animate-spin text-live" aria-hidden="true" />
            <span className="uppercase tracking-[0.12em] text-muted">{last?.phase ?? "starting"}</span>
            <span className="truncate">{last?.detail ?? "Connecting to GitHub…"}</span>
          </p>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-err/40 bg-err/10 p-3 grid gap-2">
          <p className="mono text-[11px] uppercase tracking-[0.12em] text-err">Analysis failed</p>
          <p className="text-[12.5px] text-ink-dim whitespace-pre-line break-words">{error}</p>
          <div className="flex flex-wrap gap-2">
            {needsToken ? (
              <Button size="sm" variant="primary" icon={<KeyRound />} onClick={() => openSettingsFor("github")}>
                Add GitHub token
              </Button>
            ) : null}
            <Button size="sm" variant="outline" icon={<RotateCcw />} onClick={() => void run()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {status === "ready" && analysis ? (
        <p className={cn("mono text-[11px] text-muted")}>
          Scanned {analysis.stats.scannedFiles} of {analysis.stats.totalFiles} files ({(analysis.stats.bytesRead / 1024).toFixed(0)} KB) in {(analysis.durationMs / 1000).toFixed(1)} s · {analysis.graph.nodes.length} modules · {analysis.graph.edges.length} relationships
          {analysis.warnings.length ? ` · ⚠ ${analysis.warnings.join(" ")}` : ""}
        </p>
      ) : null}
    </GlassPanel>
  );
}
