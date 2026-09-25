import { AlertTriangle, CheckCircle2, Circle, Clock, Loader2, Radio } from "lucide-react";
import type { NodeState } from "@/types/execution";
import { cn } from "@/lib/cn";

export const NODE_STATE_LABEL: Record<NodeState, string> = {
  idle: "Idle",
  queued: "Queued",
  active: "Active",
  processing: "Processing",
  completed: "Completed",
  error: "Error",
};

export function StatusIcon({ state, className, spin = true }: { state: NodeState; className?: string; spin?: boolean }) {
  const cls = cn("size-[1em] shrink-0", className);
  switch (state) {
    case "idle":
      return <Circle className={cn(cls, "text-faint")} strokeDasharray="2 2" aria-hidden="true" />;
    case "queued":
      return <Clock className={cn(cls, "text-queued")} aria-hidden="true" />;
    case "active":
      return <Radio className={cn(cls, "text-warn")} aria-hidden="true" />;
    case "processing":
      return <Loader2 className={cn(cls, "text-warn", spin && "animate-spin")} aria-hidden="true" />;
    case "completed":
      return <CheckCircle2 className={cn(cls, "text-ok")} aria-hidden="true" />;
    case "error":
      return <AlertTriangle className={cn(cls, "text-err")} aria-hidden="true" />;
  }
}
