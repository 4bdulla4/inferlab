import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { initialSettleState, SETTLE_TIMEOUT_MS, stepSettle, type SettleState } from "@/hooks/scrollSettle";

/**
 * Brings an element to the top of the viewport each time `key` becomes a new
 * non-empty value. A run usually starts below the fold, so pressing run would
 * otherwise leave the reader looking at the form they just submitted instead of
 * the thing they asked to watch.
 *
 * The scroll waits for the page above the target to stop moving, because
 * starting a run collapses composers and mounts panels; see `stepSettle`. Pair
 * it with a `scroll-mt-*` class on the target to clear the sticky header.
 */
export function useScrollOnRun<T extends HTMLElement = HTMLDivElement>(key: string | null | undefined) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!key) return;
    let frame = 0;
    let state: SettleState = initialSettleState;
    const startedAt = performance.now();

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const node = ref.current;
      if (!node) {
        if (elapsed <= SETTLE_TIMEOUT_MS) frame = requestAnimationFrame(tick);
        return;
      }
      const next = stepSettle(state, node.getBoundingClientRect().top + window.scrollY, elapsed);
      state = next;
      if (next.scrollNow) {
        node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, reduced]);

  return ref;
}
