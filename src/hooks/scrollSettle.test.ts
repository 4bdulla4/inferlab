import { describe, expect, it } from "vitest";
import { initialSettleState, SETTLE_TIMEOUT_MS, stepSettle, STABLE_FRAMES } from "./scrollSettle";

describe("stepSettle", () => {
  it("never scrolls on the first measurement", () => {
    expect(stepSettle(initialSettleState, 420, 0).scrollNow).toBe(false);
  });

  it("scrolls once the target holds the same position", () => {
    let state = { ...initialSettleState };
    const tops = [420, 420, 420, 420];
    const scrolls = tops.map((top, i) => {
      const next = stepSettle(state, top, i * 16);
      state = next;
      return next.scrollNow;
    });
    expect(scrolls.indexOf(true)).toBe(STABLE_FRAMES);
  });

  it("waits out a collapsing composer instead of aiming at the position it is leaving", () => {
    // The LLM lab folds its composer away after the run starts, lifting the
    // stage by ~124px. Scrolling to the first reading overshot by that much.
    let state = { ...initialSettleState };
    const tops = [420, 420, 296, 296, 296];
    const firstScroll = tops.findIndex((top, i) => {
      const next = stepSettle(state, top, i * 16);
      state = next;
      return next.scrollNow;
    });
    expect(tops[firstScroll]).toBe(296);
  });

  it("gives up and scrolls when the layout never settles", () => {
    let state = { ...initialSettleState };
    let top = 400;
    let frames = 0;
    let elapsed = 0;
    while (frames < 200) {
      top += 3;
      elapsed += 16;
      const next = stepSettle(state, top, elapsed);
      state = next;
      frames += 1;
      if (next.scrollNow) break;
    }
    expect(state.stableFrames).toBe(0);
    expect(elapsed).toBeGreaterThan(SETTLE_TIMEOUT_MS);
    expect(frames).toBeLessThan(200);
  });
});
