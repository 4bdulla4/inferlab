import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { HistoryResponse } from "@shared/history";
import { clearHistory, fetchHistory } from "@/api/historyClient";
import { LABS } from "@/labs/registry";
import { formatMs, formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useRepoStore } from "@/store/repoStore";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ActivityChart } from "@/components/history/ActivityChart";
import { ActivityFeed } from "@/components/history/ActivityFeed";
import { StatCards } from "@/components/history/StatCards";

/** Dashboard over everything the platform has done: analyses, LLM runs and model usage. */
export function HistoryLab({ onOpenRepoLab }: { onOpenRepoLab: () => void }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setUrl = useRepoStore((s) => s.setUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchHistory(300));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onOpenRepo = (url: string) => {
    setUrl(url);
    onOpenRepoLab();
  };

  const stats = data?.stats;
  // Hoisted: this was recomputed inside the row loop, once per model.
  const maxModelTokens = useMemo(() => Math.max(1, ...(stats?.models ?? []).map((m) => m.tokens.total)), [stats?.models]);
  const upcoming = useMemo(() => LABS.filter((l) => l.status === "coming-soon"), []);

  return (
    <div className="mx-auto max-w-[1720px] p-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid gap-4 min-w-0 content-start">
        <GlassPanel
          title="Usage dashboard"
          subtitle={stats?.firstAt ? `since ${new Date(stats.firstAt).toLocaleDateString()}` : "no activity recorded yet"}
          actions={
            <>
              <Button size="sm" variant="ghost" icon={loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} onClick={() => void load()} disabled={loading}>
                Refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 />}
                disabled={!stats?.totals.entries}
                onClick={async () => {
                  if (!window.confirm("Clear the recorded history? This cannot be undone.")) return;
                  setData(await clearHistory());
                }}
              >
                Clear
              </Button>
            </>
          }
          bodyClassName="p-4 grid gap-4"
        >
          {error ? <p className="text-[12.5px] text-err">{error}</p> : null}
          {stats ? (
            <>
              <StatCards stats={stats} />
              <ActivityChart daily={stats.daily} />
              {data?.truncated ? <p className="mono text-[10px] text-faint">Older entries were dropped; the log keeps the most recent 1,000.</p> : null}
            </>
          ) : loading ? (
            <DashboardSkeleton />
          ) : null}
        </GlassPanel>

        {stats && stats.repos.length > 0 ? (
          <GlassPanel title="Repositories analyzed" subtitle={`${stats.repos.length} distinct`} bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {stats.repos.map((r) => (
                <li key={r.repo}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink truncate flex items-center gap-2">
                        <button type="button" onClick={() => onOpenRepo(r.url)} className="hover:text-live underline-offset-2 hover:underline truncate" title="Analyze again">
                          {r.repo}
                        </button>
                        {r.isPrivate ? <Badge tone="warn">private</Badge> : null}
                      </p>
                      <p className="mono text-[10.5px] text-muted truncate">
                        {r.analyses} analys{r.analyses === 1 ? "is" : "es"} · {r.questions} question{r.questions === 1 ? "" : "s"} · {r.filesScanned} files · {r.nodes} modules · @ {r.lastSha.slice(0, 7)}
                      </p>
                    </div>
                    <span className="mono text-[10px] text-faint whitespace-nowrap">{formatTime(r.lastAt).slice(0, 8)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </GlassPanel>
        ) : null}

        <GlassPanel title="Activity log" subtitle="most recent first" bodyClassName="p-4">
          <ActivityFeed entries={data?.entries ?? []} onOpenRepo={onOpenRepo} />
        </GlassPanel>
      </div>

      <aside className="grid gap-4 min-w-0 content-start">
        <GlassPanel title="Model usage" subtitle="tokens by model" bodyClassName="p-4 grid gap-3">
          {stats && stats.models.length > 0 ? (
            <>
              <ul className="grid gap-2">
                {stats.models.map((m) => {
                  return (
                    <li key={m.model} className="grid gap-1 min-w-0">
                      <p className="flex items-center justify-between gap-2 min-w-0">
                        <span className="mono text-[11.5px] text-ink truncate">{m.model}</span>
                        <span className="mono text-[10.5px] text-muted whitespace-nowrap">{m.calls} call{m.calls === 1 ? "" : "s"}</span>
                      </p>
                      <div className="h-1.5 rounded surface-2 overflow-hidden">
                        <div className="h-full rounded bg-gradient-to-r from-accent to-live" style={{ width: `${(m.tokens.total / maxModelTokens) * 100}%` }} />
                      </div>
                      <p className="mono text-[10px] text-faint truncate">
                        {formatNumber(m.tokens.input)} in · {formatNumber(m.tokens.output)} out{m.tokens.cacheRead ? ` · ${formatNumber(m.tokens.cacheRead)} cached` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-line pt-2 grid gap-1">
                {Object.entries(stats.byVendor).map(([vendor, t]) => (
                  <p key={vendor} className="mono text-[10.5px] text-muted flex justify-between gap-2">
                    <span className="text-ink-dim">{vendor}</span>
                    <span>{formatNumber(t.total)} tokens</span>
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="mono text-[11px] text-muted">No model calls recorded yet.</p>
          )}
        </GlassPanel>

        <GlassPanel title="Performance" bodyClassName="p-4">
          <dl className="grid gap-2 mono text-[11.5px]">
            <Row label="avg LLM latency" value={stats?.llm.avgLatencyMs !== null && stats ? formatMs(stats.llm.avgLatencyMs) : "—"} />
            <Row label="avg time to first byte" value={stats?.llm.avgTtfbMs !== null && stats ? formatMs(stats.llm.avgTtfbMs) : "—"} />
            <Row label="avg analysis time" value={stats?.analysis.avgDurationMs !== null && stats ? formatMs(stats.analysis.avgDurationMs) : "—"} />
            <Row label="output tokens generated" value={stats ? formatNumber(stats.llm.totalOutputTokens) : "—"} />
            <Row label="last activity" value={stats?.lastAt ? formatTime(stats.lastAt) : "—"} />
          </dl>
        </GlassPanel>

        <GlassPanel title="Roadmap" subtitle="labs in progress" bodyClassName="p-4 grid gap-2">
          {upcoming.map((lab) => (
            <div key={lab.id} className="rounded-lg border border-line surface-1 px-3 py-2 grid gap-0.5 min-w-0">
              <p className="flex items-center gap-2 min-w-0">
                <span className="text-[12.5px] text-ink-dim truncate">{lab.title}</span>
                <Badge className="ml-auto shrink-0">soon</Badge>
              </p>
              <p className="text-[11px] text-muted leading-snug">{lab.description}</p>
            </div>
          ))}
          <p className="mono text-[10px] text-faint flex items-center gap-1.5">
            <Clock className="size-3" aria-hidden="true" />
            each will reuse the same event, playback and history engines
          </p>
        </GlassPanel>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 min-w-0")}>
      <dt className="text-muted truncate">{label}</dt>
      <dd className="text-ink whitespace-nowrap">{value}</dd>
    </div>
  );
}

/** Holds the dashboard's shape during the first load so the page does not jump. */
function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[62px] rounded-lg border border-line surface-1 animate-pulse" />
        ))}
      </div>
      <div className="h-28 rounded-lg border border-line surface-1 animate-pulse" />
    </div>
  );
}
