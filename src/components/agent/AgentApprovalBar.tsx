import { useEffect, useState } from "react";
import { Check, Loader2, MessageSquare, ShieldAlert, X } from "lucide-react";
import { agentRuntime } from "@/engine/agent/agentRuntime";
import type { AgentRunState } from "@/labs/agent/state";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

/**
 * Where the human steps in. Shown while the run is suspended on an approval
 * gate or an `ask_human` question, whatever playback is doing: the server is
 * waiting for a real decision, so this reads the live log rather than the cursor.
 */
export function AgentApprovalBar({ run }: { run: AgentRunState | undefined }) {
  // The pending request comes from the newest live event, not the playback cursor,
  // so a paused replay never hides a decision the server is waiting on.
  const pending = livePending(run);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput("");
    setError(null);
  }, [pending?.callId]);

  if (!run || !pending || run.status !== "running") return null;
  const answer = pending.kind === "answer";

  const send = async (approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await agentRuntime.resolve(run.id, pending.callId, approved, answer ? input.trim() : input.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alertdialog" aria-live="assertive" aria-label={answer ? "The agent has a question" : "Approval needed"} className={cn("rounded-xl border p-3 grid gap-2 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-warn)_35%,transparent),0_14px_40px_color-mix(in_srgb,var(--color-warn)_14%,transparent)]", "border-warn/50 bg-warn/[0.07]")}>
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-warn/50 bg-warn/15 text-warn">
          {answer ? <MessageSquare className="size-3.5" aria-hidden="true" /> : <ShieldAlert className="size-3.5" aria-hidden="true" />}
        </span>
        <div className="min-w-0 grid gap-0.5">
          <p className="label-caps text-warn">{answer ? "The agent is asking you" : `Approval needed · ${pending.tool}`}</p>
          <p className="text-[13.5px] leading-relaxed text-ink">{pending.prompt}</p>
          {!answer && Object.keys(pending.args).length ? <pre className="mono text-[11px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words rounded-md border border-line bg-bg-elevated/60 px-2.5 py-1.5 max-h-[120px] overflow-y-auto panel-scroll">{JSON.stringify(pending.args, null, 2)}</pre> : null}
          <p className="mono text-[10.5px] text-muted">The run is paused on the server until you decide. Nothing runs while you read this.</p>
        </div>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 pl-9"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer && !input.trim()) return;
          void send(true);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={answer ? "Type your answer…" : "Optional note for the agent (sent with a rejection)"}
          aria-label={answer ? "Your answer" : "Note"}
          maxLength={2000}
          className="h-9 min-w-[240px] flex-1 rounded-lg border border-line bg-bg-elevated/80 px-3 text-[13px] text-ink placeholder:text-faint focus:border-accent/60"
        />
        {answer ? (
          <Button type="submit" variant="primary" icon={busy ? <Loader2 className="animate-spin" /> : <Check />} disabled={busy || !input.trim()}>
            Send answer
          </Button>
        ) : (
          <Button type="submit" variant="primary" icon={busy ? <Loader2 className="animate-spin" /> : <Check />} disabled={busy}>
            Approve
          </Button>
        )}
        <Button type="button" variant="danger" icon={<X />} disabled={busy} onClick={() => void send(false)}>
          {answer ? "Decline" : "Reject"}
        </Button>
        {error ? <span className="text-[12px] text-err">{error}</span> : null}
      </form>
    </div>
  );
}

/** The newest approval request in the live log that has not been resolved yet. */
function livePending(run: AgentRunState | undefined) {
  if (!run) return null;
  for (let i = run.log.length - 1; i >= 0; i--) {
    const e = run.log[i]!;
    if (e.type === "APPROVAL_RESOLVED" || e.type === "RUN_COMPLETED" || e.type === "EXECUTION_ERROR" || e.type === "EXECUTION_STOPPED") return null;
    if (e.type === "APPROVAL_REQUESTED") return { callId: e.data.callId, tool: e.data.tool, prompt: e.data.prompt, kind: e.data.kind, args: e.data.args };
  }
  return null;
}
