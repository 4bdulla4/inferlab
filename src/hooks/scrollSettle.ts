/** Give up waiting for the layout to settle after this long and scroll anyway. */
export const SETTLE_TIMEOUT_MS = 600;
/** Frames the target must keep the same document position before it is trusted. */
export const STABLE_FRAMES = 2;

export interface SettleState {
  /** Document-space top of the target on the previous frame, or null on the first. */
  lastTop: number | null;
  /** Consecutive frames the target has held `lastTop`. */
  stableFrames: number;
}

export const initialSettleState: SettleState = { lastTop: null, stableFrames: 0 };

/**
 * One frame of the wait for a layout to stop moving.
 *
 * Starting a run rearranges the page above the target: a composer folds into a
 * one-line bar, panels mount, a placeholder is replaced. Scrolling to the
 * target's first measurement aims at a position it is about to leave, which
 * overshoots once the page above it shrinks. So the target has to hold the same
 * document position for a couple of frames before the scroll is worth making,
 * with a timeout so an animation that never settles still gets there.
 */
export function stepSettle(prev: SettleState, top: number, elapsedMs: number): SettleState & { scrollNow: boolean } {
  const held = prev.lastTop !== null && top === prev.lastTop;
  const stableFrames = held ? prev.stableFrames + 1 : 0;
  const scrollNow = stableFrames >= STABLE_FRAMES || elapsedMs > SETTLE_TIMEOUT_MS;
  return { lastTop: top, stableFrames, scrollNow };
}
