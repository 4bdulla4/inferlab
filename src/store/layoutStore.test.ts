import { describe, expect, it } from "vitest";
import { movePanel, reconcile, wideColumnIndex } from "./layoutStore";

const fallback = [
  ["input", "pipeline", "output"],
  ["timeline", "inspector"],
];

describe("panel layout", () => {
  it("falls back to the default arrangement when nothing is saved", () => {
    expect(reconcile(undefined, fallback)).toEqual(fallback);
  });

  it("keeps a saved arrangement", () => {
    const saved = [["pipeline", "input"], ["inspector", "timeline", "output"]];
    expect(reconcile(saved, fallback)).toEqual(saved);
  });

  it("drops panels that no longer exist and appends ones added since", () => {
    const saved = [["pipeline", "retired-panel"], ["inspector"]];
    // "input" and "output" default to column 0, "timeline" to column 1.
    expect(reconcile(saved, fallback)).toEqual([
      ["pipeline", "input", "output"],
      ["inspector", "timeline"],
    ]);
  });

  it("never loses a panel, whatever was saved", () => {
    for (const saved of [[[], []], [["output"], []], [[], ["input", "pipeline", "output", "timeline", "inspector"]]]) {
      const result = reconcile(saved, fallback).flat().sort();
      expect(result).toEqual(fallback.flat().sort());
    }
  });

  it("collapses a saved layout that has more columns than the page offers", () => {
    const result = reconcile([["input"], ["timeline"], ["output"]], fallback);
    expect(result.length).toBe(2);
    expect(result.flat().sort()).toEqual(fallback.flat().sort());
  });

  it("moves a panel within and across columns", () => {
    const moved = movePanel(fallback, "output", 0, 0);
    expect(moved[0]).toEqual(["output", "input", "pipeline"]);
    const across = movePanel(fallback, "output", 1, 1);
    expect(across[0]).toEqual(["input", "pipeline"]);
    expect(across[1]).toEqual(["timeline", "output", "inspector"]);
  });

  it("clamps out-of-range targets instead of dropping the panel", () => {
    const past = movePanel(fallback, "input", 1, 99);
    expect(past[1]).toEqual(["timeline", "inspector", "input"]);
    const negative = movePanel(fallback, "inspector", -3, -3);
    expect(negative[0]![0]).toBe("inspector");
    expect(negative.flat().sort()).toEqual(fallback.flat().sort());
  });
});

describe("wide column", () => {
  it("keeps the first column wide when no panel asks for room", () => {
    expect(wideColumnIndex(fallback, undefined)).toBe(0);
    expect(wideColumnIndex(fallback, [])).toBe(0);
  });

  it("follows the panel that needs room when it is dragged across", () => {
    expect(wideColumnIndex(fallback, ["pipeline"])).toBe(0);
    const moved = movePanel(fallback, "pipeline", 1, 0);
    expect(wideColumnIndex(moved, ["pipeline"])).toBe(1);
  });

  it("falls back to the first column when the wide panel is not rendered", () => {
    expect(wideColumnIndex(fallback, ["diagram"])).toBe(0);
  });
});
