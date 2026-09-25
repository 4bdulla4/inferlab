import { useEffect } from "react";
import { runtime } from "@/engine/execution/runtime";
import { useExecutionStore } from "@/store/executionStore";

/**
 * Global playback shortcuts. Ignored while typing in inputs.
 *   Space → play/pause · → (ArrowRight) → step · R → replay · Escape → close inspector
 */
export function useKeyboardShortcuts(onEscape: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const runId = useExecutionStore.getState().activeRunId;
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (!runId) return;
      if (e.key === " " && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        runtime.toggle(runId);
      } else if (e.key === "ArrowRight" && (target?.getAttribute("role") !== "button" || !target.dataset.pipelineNode)) {
        e.preventDefault();
        runtime.step(runId);
      } else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        runtime.replay(runId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape]);
}
