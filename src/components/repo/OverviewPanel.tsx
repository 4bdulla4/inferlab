import { Loader2, Sparkles } from "lucide-react";
import type { AiUsage, RepoAnalysis } from "@shared/repo";
import { summarizeRepo } from "@/api/repoClient";
import { formatNumber } from "@/lib/format";
import { useRepoStore } from "@/store/repoStore";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { EvidenceBadge } from "./EvidenceBadge";

export function formatUsage(u: AiUsage): string {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return `${k(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens)} in${u.cacheReadTokens ? ` (${k(u.cacheReadTokens)} from cache)` : ""} · ${k(u.outputTokens)} out`;
}

export function OverviewPanel({ analysis }: { analysis: RepoAnalysis }) {
  const summarizing = useRepoStore((s) => s.summarizing);
  const summarizeError = useRepoStore((s) => s.summarizeError);
  const runSummaries = async () => {
    const store = useRepoStore.getState();
    if (!store.analysis || store.summarizing) return;
    store.startSummarize();
    try {
      const result = await summarizeRepo({ analysisId: store.analysis.id });
      useRepoStore.getState().applySummaries(result);
    } catch (err) {
      useRepoStore.getState().failSummarize(err instanceof Error ? err.message : "Summarization failed.");
    }
  };
  const langs = Object.entries(analysis.stats.languages).sort((a, b) => b[1] - a[1]).filter(([k]) => k !== "other").slice(0, 5);
  const counts = {
    routes: analysis.routes.filter((r) => r.kind !== "page").length,
    pages: analysis.routes.filter((r) => r.kind === "page").length,
    env: analysis.envVars.length,
    deps: analysis.dependencies.filter((d) => !d.dev).length,
    models: analysis.schema.length,
    jobs: analysis.jobs.length,
    infra: analysis.infra.length,
    integrations: analysis.integrations.length,
  };
  return (
    <GlassPanel title="Product overview" subtitle={analysis.meta.description ?? undefined} actions={<EvidenceBadge kind="verified" compact />} bodyClassName="p-4 grid gap-3">
      <p className="text-[14px] leading-relaxed text-ink">{analysis.overview.headline}</p>
      {analysis.overview.aiOverview ? (
        <div className="rounded-lg border border-sim/30 bg-sim/[0.05] p-3 grid gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <EvidenceBadge kind="ai" compact />
            <span className="mono text-[10.5px] text-muted">model-written summary · {analysis.ai.model}</span>
            {analysis.ai.usage ? <span className="mono text-[10.5px] text-faint">· tokens {formatUsage(analysis.ai.usage)}</span> : null}
          </div>
          <p className="text-[13px] leading-relaxed text-ink-dim">{analysis.overview.aiOverview}</p>
        </div>
      ) : analysis.ai.available ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" icon={summarizing ? <Loader2 className="animate-spin" /> : <Sparkles />} disabled={summarizing} onClick={() => void runSummaries()}>
            {summarizing ? "Summarizing…" : "Generate AI summaries"}
          </Button>
          <span className="mono text-[10.5px] text-muted">one model call (~15k input tokens) · adds a role description to every module · {analysis.ai.model}</span>
          {summarizeError ? <span className="text-[11.5px] text-err w-full">{summarizeError}</span> : null}
        </div>
      ) : (
        <p className="mono text-[11px] text-muted">{analysis.ai.note}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {analysis.overview.stack.map((s) => (
          <Badge key={s} tone="neutral" className="normal-case tracking-normal text-[11px] h-6">
            {s}
          </Badge>
        ))}
      </div>
      <dl className="mono grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-[11px]">
        <Stat label="files" value={`${analysis.stats.scannedFiles}/${analysis.stats.totalFiles}`} />
        <Stat label="lines" value={formatNumber(analysis.stats.totalLoc)} />
        <Stat label="routes" value={`${counts.routes}${counts.pages ? ` +${counts.pages} pages` : ""}`} />
        <Stat label="env vars" value={String(counts.env)} />
        <Stat label="deps" value={String(counts.deps)} />
        <Stat label="models" value={String(counts.models)} />
        <Stat label="jobs" value={String(counts.jobs)} />
        <Stat label="infra" value={String(counts.infra)} />
      </dl>
      <p className="mono text-[10.5px] text-faint">
        languages: {langs.map(([k, v]) => `${k} ${v}`).join(" · ")} · ★ {formatNumber(analysis.meta.stars)} · {analysis.meta.license ?? "no license"} · default {analysis.meta.defaultBranch}
      </p>
    </GlassPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line surface-1 px-2.5 py-1.5 min-w-0">
      <dt className="text-[9.5px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="text-ink truncate">{value}</dd>
    </div>
  );
}
