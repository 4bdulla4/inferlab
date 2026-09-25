import { describe, expect, it, vi } from "vitest";
import type { ExecutionEvent } from "@/types/execution";
import { PlaybackController, computeDelay, type PlaybackHost } from "./PlaybackController";

function makeHost(events: ExecutionEvent[]) {
  let cursor = 0;
  let liveDone = true;
  const listeners = new Set<() => void>();
  const applied: string[] = [];
  const host: PlaybackHost = {
    getLogLength: () => events.length,
    getCursor: () => cursor,
    isLiveDone: () => liveDone,
    getEvent: (i) => events[i],
    applyNext: () => {
      applied.push(events[cursor]!.type);
      cursor++;
    },
    resetVisual: () => {
      cursor = 0;
      applied.length = 0;
    },
    setPlaybackState: () => {},
    getSpeed: () => 1,
    onLogGrow: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    host,
    applied,
    grow: (e: ExecutionEvent) => {
      events.push(e);
      listeners.forEach((l) => l());
    },
    setLive: (v: boolean) => {
      liveDone = v;
      listeners.forEach((l) => l());
    },
  };
}

const ev = (type: string, duration = 100): ExecutionEvent => ({ id: type, seq: 0, type, timestamp: 0, stage: "x", status: "completed", source: "live", duration, label: type });

describe("PlaybackController", () => {
  it("step applies exactly one event and pauses", () => {
    const { host, applied } = makeHost([ev("a"), ev("b"), ev("c")]);
    const c = new PlaybackController(host);
    c.step();
    expect(applied).toEqual(["a"]);
    expect(c.playbackState).toBe("paused");
    c.step();
    expect(applied).toEqual(["a", "b"]);
    c.dispose();
  });

  it("plays through the log honoring durations and calls onFinish", () => {
    vi.useFakeTimers();
    const { host, applied } = makeHost([ev("a", 100), ev("b", 100), ev("c", 100)]);
    const onFinish = vi.fn();
    const c = new PlaybackController(host, { onFinish });
    c.play();
    expect(applied).toEqual(["a"]);
    vi.advanceTimersByTime(100);
    expect(applied).toEqual(["a", "b"]);
    vi.advanceTimersByTime(250);
    expect(applied).toEqual(["a", "b", "c"]);
    expect(onFinish).toHaveBeenCalledTimes(1);
    c.dispose();
    vi.useRealTimers();
  });

  it("waits for live data and resumes when the log grows", () => {
    vi.useFakeTimers();
    const { host, applied, grow, setLive } = makeHost([ev("a", 50)]);
    setLive(false);
    const c = new PlaybackController(host);
    c.play();
    vi.advanceTimersByTime(200);
    expect(applied).toEqual(["a"]);
    grow(ev("b", 50));
    expect(applied).toEqual(["a", "b"]);
    setLive(true);
    vi.advanceTimersByTime(100);
    expect(c.isFinished()).toBe(true);
    c.dispose();
    vi.useRealTimers();
  });

  it("replay resets and plays again", () => {
    vi.useFakeTimers();
    const { host, applied } = makeHost([ev("a", 10), ev("b", 10)]);
    const c = new PlaybackController(host);
    c.play();
    vi.advanceTimersByTime(100);
    expect(applied).toEqual(["a", "b"]);
    c.replay();
    expect(applied).toEqual(["a"]);
    c.dispose();
    vi.useRealTimers();
  });
});

describe("computeDelay", () => {
  it("scales with the chosen speed", () => {
    expect(computeDelay(400, 1, 0)).toBe(400);
    expect(computeDelay(400, 2, 0)).toBe(200);
    expect(computeDelay(400, 0.5, 0)).toBe(800);
  });

  it("keeps a teaching stage at its full dwell however far playback is behind", () => {
    expect(computeDelay(400, 1, 50)).toBe(400);
    expect(computeDelay(400, 1, 300)).toBe(400);
    expect(computeDelay(400, 1, 5000)).toBe(400);
  });

  it("only fast-forwards the repetitive per-token events", () => {
    expect(computeDelay(400, 1, 50, true)).toBe(400);
    expect(computeDelay(400, 1, 100, true)).toBe(200);
    expect(computeDelay(400, 1, 300, true)).toBe(100);
    expect(computeDelay(400, 1, 900, true)).toBe(50);
  });

  it("never waits less than one frame", () => {
    expect(computeDelay(1, 4, 1000, true)).toBeGreaterThanOrEqual(8);
  });
});
