import type { RunState } from "@/labs/llm/state";
import { formatMs, formatNumber, formatTime } from "@/lib/format";

export function InputVisualizer({ run }: { run: RunState | undefined }) {
  if (!run) return <p className="mono text-[11px] text-muted">Type a message and press RUN.</p>;
  const first = run.log[0];
  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">application event</p>
      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-2">
        <p className="label-caps">User message</p>
        <p className="text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap">“{run.input}”</p>
      </div>
      <dl className="mono grid grid-cols-2 gap-2 text-[11.5px]">
        <div className="rounded border border-line p-2"><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">input characters</dt><dd className="text-ink-dim">{run.input.length}</dd></div>
        <div className="rounded border border-line p-2"><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">timestamp</dt><dd className="text-ink-dim">{first ? formatTime(first.timestamp) : "—"}</dd></div>
        <div className="rounded border border-line p-2"><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">words</dt><dd className="text-ink-dim">{run.input.trim().split(/\s+/).filter(Boolean).length}</dd></div>
        <div className="rounded border border-line p-2"><dt className="text-faint text-[9.5px] uppercase tracking-[0.12em]">target</dt><dd className="text-ink-dim">{run.provider.name}</dd></div>
      </dl>
    </div>
  );
}

export function ResponseVisualizer({ run }: { run: RunState | undefined }) {
  const v = run?.visual;
  if (!v?.generation.started) return <p className="mono text-[11px] text-muted">The final response and its telemetry appear here.</p>;
  const c = v.completion;
  const u = v.usage;
  const rows: [string, string][] = [
    ["Model", c?.model ?? run?.provider.model ?? "—"],
    ["Finish reason", c?.finishReason ?? (v.generation.completed ? "—" : "generating…")],
    ["Latency", formatMs(c?.latencyMs)],
    ["Time to first byte", formatMs(c?.ttfbMs ?? v.generation.ttfbMs)],
    ["Generation time", formatMs(c?.generationMs)],
    ["Input tokens", formatNumber(u?.inputTokens)],
    ["Output tokens", formatNumber(u?.outputTokens)],
    ["Total tokens", formatNumber(u?.totalTokens)],
  ];
  if (u?.reasoningTokens) rows.push(["Reasoning tokens", formatNumber(u.reasoningTokens)]);
  if (u?.cacheReadTokens) rows.push(["Cache read tokens", formatNumber(u.cacheReadTokens)]);
  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">provider response metadata</p>
      <div className="rounded-lg border border-accent/30 bg-accent/[0.05] p-3 text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words">
        {v.generation.text || <span className="text-muted">…</span>}
      </div>
      <dl className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 mono text-[11.5px]">
        {rows.map(([k, val]) => (
          <ResponseRow key={k} k={k} v={val} />
        ))}
      </dl>
      <p className="text-[11.5px] leading-snug text-muted">Usage numbers are the provider's authoritative accounting for this request.</p>
    </div>
  );
}

function ResponseRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="text-ink-dim break-words">{v}</dd>
    </>
  );
}
