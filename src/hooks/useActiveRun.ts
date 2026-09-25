import { selectActiveRun, useExecutionStore } from "@/store/executionStore";
import type { RunState } from "@/labs/llm/state";

export function useActiveRun(): RunState | undefined {
  return useExecutionStore(selectActiveRun);
}
