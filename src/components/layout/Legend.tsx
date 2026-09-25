import type { NodeState } from "@/types/execution";
import { NODE_STATE_LABEL, StatusIcon } from "./StatusIcon";
import { SourceBadge } from "./SourceBadge";

const STATES: NodeState[] = ["idle", "queued", "active", "processing", "completed", "error"];

export function Legend() {
  return (
    <div className="grid gap-4 text-[12px]">
      <div>
        <p className="label-caps mb-2">Data source</p>
        <ul className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
          <li className="contents">
            <SourceBadge source="live" className="mt-px" />
            <span className="text-ink-dim leading-snug min-w-0">
              Observed from the real provider API: request, model id, streamed output, usage, latency, finish reason, and log probabilities when the provider returns them.
            </span>
          </li>
          <li className="contents">
            <SourceBadge source="simulation" className="mt-px" />
            <span className="text-ink-dim leading-snug min-w-0">
              Conceptual visualization of what happens inside a transformer: embeddings, positional information, attention, MLP, and candidate probabilities when the provider exposes none. Never proprietary internals.
            </span>
          </li>
        </ul>
      </div>
      <div>
        <p className="label-caps mb-2">Node states</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 min-w-0">
          {STATES.map((s) => (
            <li key={s} className="flex items-center gap-2 text-ink-dim">
              <span className="text-[14px] inline-flex">
                <StatusIcon state={s} spin={false} />
              </span>
              {NODE_STATE_LABEL[s]}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="label-caps mb-2">Keyboard</p>
        <ul className="grid gap-1 text-ink-dim mono text-[11px]">
          <li><kbd className="px-1 border border-line rounded">Space</kbd> play / pause · <kbd className="px-1 border border-line rounded">→</kbd> step · <kbd className="px-1 border border-line rounded">R</kbd> replay</li>
          <li><kbd className="px-1 border border-line rounded">Tab</kbd> / arrow keys move between pipeline nodes · <kbd className="px-1 border border-line rounded">Enter</kbd> inspect</li>
        </ul>
      </div>
    </div>
  );
}
