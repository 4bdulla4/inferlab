import type { VisualState } from "@/labs/llm/state";
import { useUIStore } from "@/store/uiStore";

export function RequestVisualizer({ visual }: { visual: VisualState | undefined }) {
  const mode = useUIStore((s) => s.mode);
  const r = visual?.request;
  if (!r) return <p className="mono text-[11px] text-muted">The prepared request appears once the backend has assembled it.</p>;
  const rows: [string, string][] = [
    ["Provider", r.vendor],
    ["Model", r.model],
    ["Temperature", r.settings.temperature === null ? "omitted (not accepted by model)" : r.settings.temperature.toFixed(2)],
    ["Max output tokens", String(r.settings.maxOutputTokens)],
    ["Streaming", r.settings.streaming ? "on" : "off"],
  ];
  if (r.settings.thinking) rows.push(["Thinking", r.settings.thinking]);
  if (r.settings.effort) rows.push(["Effort", r.settings.effort]);
  if (r.settings.logprobs !== undefined) rows.push(["Log probabilities", r.settings.logprobs ? "requested (top-5)" : "not available"]);

  return (
    <div className="grid gap-2">
      <p className="mono text-[11px] text-muted">application / API request preparation</p>
      <dl className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 mono text-[11.5px]">
        {rows.map(([k, v]) => (
          <RequestRow key={k} k={k} v={v} />
        ))}
      </dl>
      <div className="rounded-lg border border-line bg-bg-elevated/60 p-3 grid gap-2">
        <p className="label-caps">System instructions</p>
        <p className="text-[12.5px] text-ink-dim leading-relaxed whitespace-pre-wrap">{r.system}</p>
        <p className="label-caps mt-1">Messages</p>
        {r.messages.map((m, i) => (
          <p key={i} className="text-[12.5px] leading-relaxed">
            <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-live mr-2">{m.role}</span>
            <span className="text-ink-dim whitespace-pre-wrap">{m.content}</span>
          </p>
        ))}
      </div>
      {r.notes.length > 0 ? (
        <ul className="grid gap-1">
          {r.notes.map((n, i) => (
            <li key={i} className="text-[11.5px] leading-snug text-muted">• {n}</li>
          ))}
        </ul>
      ) : null}
      {mode === "advanced" ? (
        <p className="text-[11.5px] leading-snug text-muted">The backend, not the browser, holds the API key and performs this call. The browser only ever receives the normalized event stream.</p>
      ) : null}
    </div>
  );
}

function RequestRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="text-ink-dim break-words">{v}</dd>
    </>
  );
}
