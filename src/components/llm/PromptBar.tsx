import { Pencil, Sparkles, Square } from "lucide-react";
import { motion } from "motion/react";
import { runtime } from "@/engine/execution/runtime";
import type { RunState } from "@/labs/llm/state";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

/**
 * What the composer collapses into once a run starts: the prompt that was sent,
 * who is answering it, and the way back to editing. Keeping the prompt visible
 * means the stage never loses the question it is answering.
 */
export function PromptBar({ run, onEdit, reduced }: { run: RunState; onEdit: () => void; reduced: boolean }) {
  const running = run.status === "running";
  const status =
    run.status === "running" ? "running" : run.status === "error" ? "failed" : run.status === "stopped" ? "stopped" : "complete";

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
      className="glass rounded-xl px-3.5 py-2.5 flex items-center gap-3 min-w-0"
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg border",
          running ? "border-live/50 bg-live/10 text-live" : "border-accent/40 bg-accent/10 text-accent-soft",
        )}
      >
        <Sparkles className={cn("size-4", running && !reduced && "animate-pulse")} aria-hidden="true" />
      </span>

      <button
        type="button"
        onClick={onEdit}
        title="Edit this prompt and run again"
        className="group min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-[13.5px] text-ink group-hover:text-accent-soft">{run.input}</span>
        <span className="mono block truncate text-[10.5px] text-muted">
          {run.provider.name} · {status}
        </span>
      </button>

      {running ? (
        <Button size="sm" variant="danger" icon={<Square />} onClick={() => runtime.stopRun(run.id)}>
          STOP
        </Button>
      ) : null}
      <Button size="sm" variant="outline" icon={<Pencil />} onClick={onEdit}>
        New prompt
      </Button>
    </motion.div>
  );
}
