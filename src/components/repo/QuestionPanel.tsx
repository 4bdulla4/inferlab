import { useEffect } from "react";
import { Bot, Loader2, MessageSquareText, Pause, Play, RotateCcw, SkipForward, Square } from "lucide-react";
import type { ProviderId } from "@shared/llm";
import { askRepo } from "@/api/repoClient";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import { useAgentStore } from "@/store/agentStore";
import { tracePlayer } from "@/labs/repo/tracePlayer";
import { PLAYBACK_SPEEDS } from "@/types/execution";
import { cn } from "@/lib/cn";
import { useRepoStore, type AskMode } from "@/store/repoStore";
import { useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { GlassPanel } from "@/components/layout/GlassPanel";
import { EvidenceBadge, EvidenceDot } from "./EvidenceBadge";
import { InvestigationAnswer } from "./InvestigationAnswer";
import { formatUsage } from "./OverviewPanel";

const OFFLINE: { id: ProviderId; label: string } = { id: "mock", label: "Offline planner (simulation)" };

/** Providers the investigator can use right now: configured models, then the always-available offline planner. */
function useInvestigatorProviders(): { id: ProviderId; label: string }[] {
  const status = useAgentStore((s) => s.status);
  const live = (status?.providers ?? []).filter((p) => p.configured && !p.mock).map((p) => ({ id: p.id, label: p.name }));
  return [...live, OFFLINE];
}

const SUGGESTIONS = [
  "How does authentication work?",
  "How does the AI response get generated?",
  "What happens when a user submits the main form?",
  "How is data persisted to the database?",
  "How is the app deployed?",
  "Where are background jobs or webhooks handled?",
];

export function QuestionPanel({ className }: { className?: string }) {
  const analysis = useRepoStore((s) => s.analysis);
  // While a rescan is running the analysis on screen is the previous one, so
  // questions wait rather than being answered against a stale index.
  const rescanning = useRepoStore((s) => s.status) === "analyzing";
  const question = useRepoStore((s) => s.question);
  const setQuestion = useRepoStore((s) => s.setQuestion);
  const asking = useRepoStore((s) => s.asking);
  const askError = useRepoStore((s) => s.askError);
  const trace = useRepoStore((s) => s.trace);
  const history = useRepoStore((s) => s.traceHistory);
  const cursor = useRepoStore((s) => s.traceCursor);
  const playing = useRepoStore((s) => s.tracePlaying);
  const showTrace = useRepoStore((s) => s.showTrace);
  const speed = useUIStore((s) => s.speed);
  const setSpeed = useUIStore((s) => s.setSpeed);
  const mode = useRepoStore((s) => s.askMode);
  const setMode = useRepoStore((s) => s.setAskMode);
  const investigation = useRepoStore((s) => s.investigation);
  const investigations = useRepoStore((s) => s.investigationHistory);
  const setInvestigation = useRepoStore((s) => s.setInvestigation);
  const preferred = useRepoStore((s) => s.investigatorProvider);
  const setProvider = useRepoStore((s) => s.setInvestigatorProvider);
  const runs = useAgentStore((s) => s.runs);
  const run = investigation ? runs[investigation.runId] : undefined;
  const investigating = run?.status === "running";
  const providers = useInvestigatorProviders();
  const provider = providers.find((p) => p.id === preferred)?.id ?? providers[0]!.id;

  useEffect(() => {
    if (!useAgentStore.getState().status) void agentRuntime.refreshStatus();
  }, []);

  const investigate = async (q = question) => {
    const store = useRepoStore.getState();
    if (!store.analysis || !q.trim() || investigating) return;
    store.setQuestion(q);
    useAgentStore.getState().selectNode(null);
    const runId = await agentRuntime.investigate(store.analysis.id, q.trim(), provider);
    useRepoStore.getState().setInvestigation({ runId, analysisId: store.analysis.id, question: q.trim(), provider, startedAt: Date.now() });
  };

  const submit = (q = question) => (mode === "investigate" ? investigate(q) : ask(q));
  const busy = mode === "investigate" ? investigating : asking;

  const ask = async (q = question) => {
    const store = useRepoStore.getState();
    if (!store.analysis || !q.trim() || store.asking) return;
    store.setQuestion(q);
    store.startAsk();
    try {
      const result = await askRepo({ analysisId: store.analysis.id, question: q.trim() });
      useRepoStore.getState().finishAsk(result);
      tracePlayer.restart(result.id);
    } catch (err) {
      useRepoStore.getState().failAsk(err instanceof Error ? err.message : "Question failed.");
    }
  };

  return (
    <GlassPanel
      title="Ask about this product"
      subtitle={
        analysis
          ? mode === "investigate"
            ? "an agent reads the code · citations checked by code"
            : analysis.ai.available
              ? "one model call · steps checked against the index"
              : "heuristic tracer (no model key)"
          : undefined
      }
      className={className}
      bodyClassName="p-4 grid gap-3 overflow-y-auto panel-scroll content-start"
    >
      <Segmented<AskMode>
        ariaLabel="How to answer"
        value={mode}
        onChange={setMode}
        options={[
          { value: "investigate", label: "Investigate with an agent", title: "An agent searches and reads the code over several rounds, then cites the lines it read" },
          { value: "trace", label: "Quick trace", title: "One pass over the scan's index: faster, but it does not read function bodies" },
        ]}
      />
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          }}
          rows={2}
          maxLength={600}
          disabled={!analysis || busy || rescanning}
          placeholder={rescanning ? "Waiting for the new scan to finish…" : analysis ? "How does authentication work? What happens when a user clicks…?" : "Analyze a repository first"}
          aria-label="Question about the repository"
          className="w-full resize-y rounded-lg border border-line bg-bg-elevated/80 px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint focus:border-accent/60 disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-2">
          {mode === "investigate" ? (
            investigating && run ? (
              // Own key and preventDefault: stopping swaps this for the submit button, which
              // must not receive the same click and start a new investigation.
              <Button
                key="stop"
                type="button"
                variant="danger"
                size="md"
                icon={<Square />}
                onClick={(e) => {
                  e.preventDefault();
                  agentRuntime.stop(run.id);
                }}
              >
                Stop the agent
              </Button>
            ) : (
              <Button key="investigate" type="submit" variant="primary" size="md" icon={<Bot />} disabled={!analysis || !question.trim() || rescanning}>
                Investigate
              </Button>
            )
          ) : (
            <Button type="submit" variant="primary" size="md" icon={asking ? <Loader2 className="animate-spin" /> : <MessageSquareText />} disabled={!analysis || !question.trim() || asking || rescanning}>
              {asking ? "Tracing…" : "Trace the code path"}
            </Button>
          )}
          {mode === "investigate" ? (
            <label className="inline-flex items-center gap-1.5 min-w-0">
              <span className="label-caps">model</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)} disabled={investigating} aria-label="Model for the investigator" className="h-8 max-w-[220px] rounded-md border border-line bg-bg-elevated/80 px-2 mono text-[11px] text-ink truncate disabled:opacity-60">
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="mono text-[10.5px] text-muted ml-auto">⌘/Ctrl + Enter</span>
        </div>
        {mode === "investigate" && provider === "mock" ? (
          <p className="text-[11px] text-muted leading-snug">
            {providers.length > 1 ? "The offline planner picks its steps by rule instead of asking a model." : "No model key is configured, so the offline planner picks the steps by rule."} The files it reads are real{providers.length > 1 ? "; pick a model for an explained answer." : "; add a key in Settings for an explained answer."}
          </p>
        ) : null}
      </form>

      {analysis && !rescanning && (mode === "investigate" ? !investigation : !trace) ? (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((q) => (
            <button key={q} type="button" disabled={busy} onClick={() => void submit(q)} className="rounded-md border border-line surface-1 px-2 py-1 text-[11.5px] text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-50 text-left">
              {q}
            </button>
          ))}
        </div>
      ) : null}

      {askError ? (
        <p role="alert" className="rounded-lg border border-err/40 bg-err/10 p-2.5 text-[12px] text-err">
          {askError}
        </p>
      ) : null}

      {mode === "investigate" && analysis ? (
        <>
          {run ? <InvestigationAnswer run={run} analysis={analysis} /> : null}
          {investigations.filter((r) => r.runId !== investigation?.runId && runs[r.runId]).length ? (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-line">
              <span className="label-caps w-full">Previous investigations</span>
              {investigations
                .filter((r) => r.runId !== investigation?.runId && runs[r.runId])
                .map((r) => (
                  <button key={r.runId} type="button" disabled={investigating} onClick={() => setInvestigation(r)} className="mono rounded-md border border-line px-2 h-6 text-[10.5px] text-muted hover:text-ink truncate max-w-full disabled:opacity-50">
                    {r.question}
                  </button>
                ))}
            </div>
          ) : null}
        </>
      ) : null}

      {mode === "trace" && trace ? (
        <div className="grid gap-3">
          <div className={cn("rounded-lg border p-3 grid gap-2", trace.source === "ai" ? "border-sim/30 bg-sim/[0.05]" : "border-warn/30 bg-warn/[0.05]")}>
            <div className="flex flex-wrap items-center gap-2">
              <EvidenceBadge kind={trace.source === "ai" ? "ai" : "heuristic"} />
              <Badge tone={trace.confidence === "high" ? "ok" : trace.confidence === "medium" ? "warn" : "err"}>confidence {trace.confidence}</Badge>
              {trace.usage ? <span className="mono text-[10.5px] text-faint">tokens {formatUsage(trace.usage)}</span> : null}
            </div>
            <p className="text-[13px] leading-relaxed text-ink">{trace.answer}</p>
            {trace.notes.map((n, i) => (
              <p key={i} className="mono text-[10.5px] text-muted leading-snug">
                ℹ {n}
              </p>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={playing ? "outline" : "live"} icon={playing ? <Pause /> : <Play />} onClick={() => tracePlayer.toggle(trace.id)} aria-label={playing ? "Pause trace" : "Play trace"}>
              {playing ? "Pause" : cursor >= trace.steps.length - 1 ? "Replay" : "Play"}
            </Button>
            <Button size="sm" icon={<SkipForward />} disabled={cursor >= trace.steps.length - 1} onClick={() => tracePlayer.step(trace.id)}>
              Step
            </Button>
            <Button size="sm" icon={<RotateCcw />} disabled={cursor < 0} onClick={() => tracePlayer.restart(trace.id)}>
              Restart
            </Button>
            <Segmented size="sm" ariaLabel="Trace speed" value={speed} onChange={setSpeed} options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} />
            <span className="ml-auto mono text-[10.5px] text-muted">
              step {Math.max(0, cursor + 1)} / {trace.steps.length}
            </span>
          </div>

          <ol className="grid gap-1 min-w-0 [&>*]:min-w-0" aria-label="Trace steps">
            {trace.steps.map((s, i) => {
              const state = i < cursor ? "done" : i === cursor ? "active" : "pending";
              const unverified = (s.file && !s.verification.fileExists) || (s.symbol && !s.verification.symbolExists) || (s.nodeId && !s.verification.nodeExists);
              return (
                <li key={s.index}>
                  <button
                    type="button"
                    onClick={() => tracePlayer.jumpTo(trace.id, i)}
                    aria-current={state === "active" ? "step" : undefined}
                    className={cn(
                      "w-full text-left rounded-lg border px-3 py-2 grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 transition-colors",
                      state === "active" ? "border-accent-soft/70 surface-2" : state === "done" ? "border-ok/30 bg-ok/[0.03]" : "border-line hover:border-line-strong",
                    )}
                  >
                    <span className={cn("mono text-[11px] mt-0.5", state === "active" ? "text-ink" : state === "done" ? "text-ok" : "text-faint")}>{state === "done" ? "✓" : s.index}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={cn("text-[12.5px] truncate", state === "pending" ? "text-ink-dim" : "text-ink")}>{s.title}</span>
                        <EvidenceDot kind={s.kind} />
                        {unverified ? <span className="mono text-[9.5px] text-warn" title="A reference in this step was not found in the repository index">⚠ unverified ref</span> : null}
                      </span>
                      {state !== "pending" ? <span className="block text-[11.5px] text-muted leading-snug mt-0.5">{s.description}</span> : null}
                      {s.file ? (
                        <span className="mono block text-[10.5px] text-faint truncate mt-0.5">
                          {s.file}
                          {s.line ? `:${s.line}` : ""}
                          {s.symbol ? ` · ${s.symbol}()` : ""}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {history.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-line">
              <span className="label-caps w-full">Previous questions</span>
              {history.slice(1).map((t) => (
                <button key={t.id} type="button" onClick={() => { showTrace(t); tracePlayer.restart(t.id); }} className="mono rounded-md border border-line px-2 h-6 text-[10.5px] text-muted hover:text-ink truncate max-w-full">
                  {t.question}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}
