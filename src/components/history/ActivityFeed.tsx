import { AlertTriangle, Bot, Brain, Database, FileSearch, GitBranch, MessageSquareText, Sparkles, Workflow } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { AgentRunEntry, HistoryEntry, MLRunEntry, LlmRunEntry, RagIngestEntry, RagQueryEntry, RepoAiEntry, RepoAnalysisEntry } from "@shared/history";
import { formatMs, formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type Filter = "all" | "llm_run" | "repo_analysis" | "questions" | "rag" | "agent_run" | "ml_run";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "llm_run", label: "LLM runs" },
  { id: "repo_analysis", label: "Analyses" },
  { id: "questions", label: "AI questions" },
  { id: "rag", label: "RAG" },
  { id: "agent_run", label: "Agents" },
  { id: "ml_run", label: "ML" },
];

function relative(at: number): string {
  const diff = Date.now() - at;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Rows rendered before the reader asks for more, so a long log stays cheap. */
const PAGE = 40;

export function ActivityFeed({ entries, onOpenRepo }: { entries: HistoryEntry[]; onOpenRepo: (url: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);

  const shown = useMemo(
    () =>
      entries.filter((e) => {
        if (filter === "all") return true;
        if (filter === "questions") return e.kind === "repo_ask" || e.kind === "repo_summarize";
        if (filter === "rag") return e.kind === "rag_ingest" || e.kind === "rag_query";
        return e.kind === filter;
      }),
    [entries, filter],
  );

  const visible = shown.slice(0, limit);
  const pick = (next: Filter) => {
    setFilter(next);
    setLimit(PAGE);
  };

  return (
    <div className="grid gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-caps mr-1">Activity</span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => pick(f.id)}
            aria-pressed={filter === f.id}
            className={cn("mono h-6 rounded-md border px-2 text-[10.5px] tracking-wide transition-colors", filter === f.id ? "border-line-strong surface-3 text-ink" : "border-line text-muted hover:text-ink-dim")}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto mono text-[10px] text-faint">{shown.length} entries</span>
      </div>

      {shown.length === 0 ? (
        <p className="mono text-[11px] text-muted rounded-lg border border-line p-3">Nothing recorded yet. Run the LLM visualizer or analyze a repository and it appears here.</p>
      ) : (
        <>
          <ol className="grid gap-1 min-w-0">
            {visible.map((e) => (
              <li key={e.id} className="min-w-0">
                <Row entry={e} onOpenRepo={onOpenRepo} />
              </li>
            ))}
          </ol>
          {shown.length > visible.length ? (
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE)}
              className="mono h-8 rounded-lg border border-line text-[11px] uppercase tracking-[0.1em] text-ink-dim hover:border-line-strong hover:text-ink"
            >
              show {Math.min(PAGE, shown.length - visible.length)} more · {shown.length - visible.length} left
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

const Row = memo(function Row({ entry, onOpenRepo }: { entry: HistoryEntry; onOpenRepo: (url: string) => void }) {
  const failed = !entry.ok;
  return (
    <div className={cn("rounded-lg border px-3 py-2 grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 items-start", failed ? "border-err/40 bg-err/[0.04]" : "border-line surface-1")}>
      <span className="mt-0.5">{icon(entry)}</span>
      <div className="min-w-0 grid gap-0.5">
        {entry.kind === "llm_run" ? <LlmBody entry={entry} /> : null}
        {entry.kind === "repo_analysis" ? <AnalysisBody entry={entry} onOpenRepo={onOpenRepo} /> : null}
        {entry.kind === "repo_ask" || entry.kind === "repo_summarize" ? <AiBody entry={entry} /> : null}
        {entry.kind === "rag_ingest" ? <RagIngestBody entry={entry} /> : null}
        {entry.kind === "rag_query" ? <RagQueryBody entry={entry} /> : null}
        {entry.kind === "agent_run" ? <AgentRunBody entry={entry} /> : null}
        {entry.kind === "ml_run" ? <MLRunBody entry={entry} /> : null}
        {failed && entry.error ? <p className="text-[11px] text-err leading-snug break-words">{entry.error}</p> : null}
      </div>
      <span className="mono text-[10px] text-faint text-right leading-tight whitespace-nowrap" title={formatTime(entry.at)}>
        {relative(entry.at)}
      </span>
    </div>
  );
});

function icon(e: HistoryEntry) {
  if (!e.ok) return <AlertTriangle className="size-3.5 text-err" aria-label="failed" />;
  if (e.kind === "llm_run") return <Bot className="size-3.5 text-live" aria-label="LLM run" />;
  if (e.kind === "repo_analysis") return <GitBranch className="size-3.5 text-accent-soft" aria-label="analysis" />;
  if (e.kind === "repo_summarize") return <Sparkles className="size-3.5 text-sim" aria-label="summary" />;
  if (e.kind === "rag_ingest") return <Database className="size-3.5 text-accent-soft" aria-label="document indexed" />;
  if (e.kind === "rag_query") return <FileSearch className="size-3.5 text-live" aria-label="RAG question" />;
  if (e.kind === "ml_run") return <Brain className="size-3.5 text-sim" aria-label="ML run" />;
  if (e.kind === "agent_run") return <Workflow className="size-3.5 text-accent-soft" aria-label="agent run" />;
  return <MessageSquareText className="size-3.5 text-ok" aria-label="question" />;
}

function RagIngestBody({ entry }: { entry: RagIngestEntry }) {
  const facts = [
    entry.docKind,
    `${entry.chunks} chunk${entry.chunks === 1 ? "" : "s"}`,
    entry.embeddingModel,
    entry.dims ? `${entry.dims} dims` : null,
    entry.embedMs !== undefined ? formatMs(entry.embedMs) : null,
    entry.embedTokens ? `${formatNumber(entry.embedTokens)} embed tokens` : null,
  ].filter(Boolean);
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        <span className="text-accent-soft">RAG document</span> · {entry.docName}
      </p>
      <p className="mono text-[10.5px] text-muted truncate">{facts.join(" · ")}</p>
    </>
  );
}

function MLRunBody({ entry }: { entry: MLRunEntry }) {
  const facts = [entry.task, `${formatNumber(entry.rows)} rows`, entry.epochs ? `${entry.epochs} epochs` : `${entry.iterations} steps`, entry.headlineMetric ? `${entry.headlineMetric.name} ${entry.headlineMetric.value.toFixed(3)}` : null, entry.durationMs !== undefined ? formatMs(entry.durationMs) : null].filter(Boolean);
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        <span className="text-sim">ML run</span> · <span className="text-ink-dim">{entry.algorithm.replace(/_/g, " ")}</span> · {entry.datasetName}
      </p>
      <p className="mono text-[10.5px] text-muted truncate">{facts.join(" · ")}</p>
    </>
  );
}

function AgentRunBody({ entry }: { entry: AgentRunEntry }) {
  const facts = [
    entry.scenarioId ?? "custom goal",
    `${entry.iterations} iteration${entry.iterations === 1 ? "" : "s"}`,
    `${entry.toolCalls} tool call${entry.toolCalls === 1 ? "" : "s"}`,
    entry.errors ? `${entry.errors} error${entry.errors === 1 ? "" : "s"}` : null,
    entry.retries ? `${entry.retries} retr${entry.retries === 1 ? "y" : "ies"}` : null,
    entry.reason.replace(/_/g, " "),
    entry.durationMs !== undefined ? formatMs(entry.durationMs) : null,
    entry.totalTokens ? `${formatNumber(entry.totalTokens)} tokens` : null,
  ].filter(Boolean);
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        <span className="text-accent-soft">Agent run</span> · <span className="text-ink-dim">{entry.mock ? "offline planner" : entry.vendor}</span>
        {!entry.mock ? ` · ${entry.model}` : ""}
      </p>
      <p className="mono text-[10.5px] text-muted truncate">{facts.join(" · ")}</p>
    </>
  );
}

function RagQueryBody({ entry }: { entry: RagQueryEntry }) {
  const facts = [
    `${entry.strategy} · ${entry.index}`,
    `top-${entry.topK} → ${entry.retrieved} retrieved`,
    `${formatNumber(entry.contextTokens)} context tokens`,
    entry.latencyMs !== undefined ? formatMs(entry.latencyMs) : null,
    entry.totalTokens ? `${formatNumber(entry.totalTokens)} tokens` : null,
    `${entry.citations} citation${entry.citations === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        <span className="text-live">RAG question</span> · <span className="text-ink-dim">{entry.vendor}</span>
        {entry.model ? ` · ${entry.model}` : ""}
      </p>
      <p className="mono text-[10.5px] text-muted truncate">{facts.join(" · ")}</p>
    </>
  );
}

function LlmBody({ entry }: { entry: LlmRunEntry }) {
  const facts = [
    entry.finishReason,
    entry.latencyMs !== undefined ? formatMs(entry.latencyMs) : null,
    entry.totalTokens ? `${formatNumber(entry.totalTokens)} tokens` : null,
    entry.streaming ? "streaming" : "non-streaming",
    entry.sessionKey ? "session key" : null,
  ].filter(Boolean);
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        <span className="text-ink-dim">{entry.vendor}</span> · {entry.model}
      </p>
      <p className="mono text-[10.5px] text-muted truncate">{facts.join(" · ")}</p>
    </>
  );
}

function AnalysisBody({ entry, onOpenRepo }: { entry: RepoAnalysisEntry; onOpenRepo: (url: string) => void }) {
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        <button type="button" onClick={() => onOpenRepo(entry.url)} className="hover:text-live underline-offset-2 hover:underline" title="Analyze this repository again">
          {entry.repo}
        </button>
        {entry.isPrivate ? <span className="mono ml-1.5 text-[9.5px] text-warn">private</span> : null}
        {entry.sha ? <span className="mono ml-1.5 text-[10px] text-faint">@ {entry.sha.slice(0, 7)}</span> : null}
      </p>
      {entry.ok ? (
        <p className="mono text-[10.5px] text-muted truncate">
          {entry.filesScanned}/{entry.filesTotal} files · {entry.nodes} modules · {entry.routes} routes · {entry.models} models · {formatMs(entry.durationMs)}
        </p>
      ) : null}
    </>
  );
}

function AiBody({ entry }: { entry: RepoAiEntry }) {
  const u = entry.usage;
  const facts = [
    entry.model,
    entry.source === "heuristic" ? "heuristic tracer" : entry.source ? "AI trace" : null,
    entry.steps ? `${entry.steps} steps` : null,
    entry.confidence ? `confidence ${entry.confidence}` : null,
    u ? `${formatNumber(u.inputTokens + u.cacheReadTokens)} in / ${formatNumber(u.outputTokens)} out${u.cacheReadTokens ? " (cached)" : ""}` : null,
  ].filter(Boolean);
  return (
    <>
      <p className="text-[12.5px] text-ink truncate">
        {entry.kind === "repo_summarize" ? <span className="text-sim">AI summaries</span> : <span className="text-ok">“{entry.question}”</span>}
        <span className="mono ml-1.5 text-[10px] text-faint">{entry.repo}</span>
      </p>
      <p className="mono text-[10.5px] text-muted truncate">{facts.join(" · ")}</p>
    </>
  );
}
