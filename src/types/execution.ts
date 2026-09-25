import type { DataSource } from "@shared/llm";

export type { DataSource };

/** Visual state of a pipeline node. Every state has an icon + label, never color alone. */
export type NodeState = "idle" | "queued" | "active" | "processing" | "completed" | "error";

export type EventStatus = "started" | "progress" | "completed" | "error" | "info";

/**
 * Generic execution event. Labs (LLM, RAG, ML, Agents) define their own
 * `type` and `stage` vocabularies on top of this envelope; the playback, timeline
 * and animation systems only depend on this shape.
 */
export interface ExecutionEvent<TType extends string = string, TStage extends string = string, TData = unknown> {
  id: string;
  /** Monotonic sequence number inside one run. */
  seq: number;
  type: TType;
  /** Wall-clock time the event was produced (ms since epoch). */
  timestamp: number;
  stage: TStage;
  status: EventStatus;
  /** LIVE = observed from the provider API. SIMULATION = educational visualization. */
  source: DataSource;
  /** Suggested time (ms at 1x) the visualizer should dwell before the next event. */
  duration: number;
  /**
   * True for the repetitive streaming events (one per token or reasoning
   * delta). Only these are sped up to catch a live stream; the one-off stages
   * a person is reading always play at the chosen speed.
   */
  compressible?: boolean;
  /** Short human-readable label for the timeline. */
  label: string;
  data?: TData;
}

export type PlaybackState = "playing" | "paused";

export type RunStatus = "running" | "completed" | "error" | "stopped";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
