import type { ExecutionEvent, PlaybackState } from "@/types/execution";

export interface PlaybackHost<E extends ExecutionEvent = ExecutionEvent> {
  getLogLength(): number;
  getCursor(): number;
  isLiveDone(): boolean;
  getEvent(index: number): E | undefined;
  /** Apply the event at the cursor and advance the cursor by one. */
  applyNext(): void;
  /** Reset visual state to the beginning without discarding the log. */
  resetVisual(): void;
  setPlaybackState(state: PlaybackState): void;
  getSpeed(): number;
  /** Subscribe to log growth; returns unsubscribe. */
  onLogGrow(listener: () => void): () => void;
}

/**
 * Drives visual playback of an execution log at a controllable pace.
 * The real request keeps streaming into the log regardless of playback state,
 * so pausing or stepping never blocks the network work.
 */
export class PlaybackController<E extends ExecutionEvent = ExecutionEvent> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: PlaybackState = "paused";
  private disposed = false;
  private unsubscribe: () => void;
  private onFinish?: () => void;

  constructor(private readonly host: PlaybackHost<E>, options?: { onFinish?: () => void }) {
    this.onFinish = options?.onFinish;
    this.unsubscribe = host.onLogGrow(() => {
      if (this.state === "playing" && this.timer === null) this.tick();
    });
  }

  get playbackState(): PlaybackState {
    return this.state;
  }

  play(): void {
    if (this.disposed) return;
    if (this.isFinished()) {
      this.replay();
      return;
    }
    this.state = "playing";
    this.host.setPlaybackState("playing");
    if (this.timer === null) this.tick();
  }

  pause(): void {
    if (this.disposed) return;
    this.state = "paused";
    this.host.setPlaybackState("paused");
    this.clearTimer();
  }

  toggle(): void {
    if (this.state === "playing") this.pause();
    else this.play();
  }

  /** Apply exactly one event, then stay paused. */
  step(): void {
    if (this.disposed) return;
    this.pause();
    if (this.host.getCursor() < this.host.getLogLength()) {
      this.host.applyNext();
      if (this.isFinished()) this.onFinish?.();
    }
  }

  replay(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.host.resetVisual();
    this.state = "playing";
    this.host.setPlaybackState("playing");
    this.tick();
  }

  isFinished(): boolean {
    return this.host.isLiveDone() && this.host.getCursor() >= this.host.getLogLength();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.unsubscribe();
  }

  private tick(): void {
    this.clearTimer();
    if (this.disposed || this.state !== "playing") return;
    const cursor = this.host.getCursor();
    const length = this.host.getLogLength();
    if (cursor >= length) {
      // Nothing to show yet. Either waiting for live data or finished.
      if (this.host.isLiveDone()) {
        this.state = "paused";
        this.host.setPlaybackState("paused");
        this.onFinish?.();
      }
      return;
    }
    const event = this.host.getEvent(cursor);
    this.host.applyNext();
    const backlog = length - cursor - 1;
    const delay = computeDelay(event?.duration ?? 200, this.host.getSpeed(), backlog, event?.compressible ?? false);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Converts an event's dwell time into a real delay.
 *
 * Only the repetitive per-token events are allowed to speed up when playback
 * falls behind a fast live stream. The one-off stages carry the explanation a
 * person is reading, so 1x means 1x for those however large the backlog is.
 */
export function computeDelay(duration: number, speed: number, backlog: number, compressible = false): number {
  const catchUp = !compressible ? 1 : backlog > 400 ? 8 : backlog > 200 ? 4 : backlog > 80 ? 2 : 1;
  return Math.max(8, duration / Math.max(0.05, speed) / catchUp);
}
