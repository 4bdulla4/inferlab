import type { DataSource, ProviderDescriptor } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import type { ConnectionLayout } from "@/labs/llm/layout";
import type { LLMStageId } from "@/labs/llm/stages";
import type { VisualState } from "@/labs/llm/state";
import type { ParticleSystem } from "./ParticleSystem";

export const SOURCE_COLORS: Record<DataSource, string> = {
  live: "#22d3ee",
  simulation: "#a78bfa",
};

/**
 * Bridges execution state and particles. It never stores state of its own
 * beyond what is needed to detect transitions; the store remains the single
 * source of truth.
 */
export class AnimationController {
  private prevNodes: Record<LLMStageId, NodeState> | null = null;
  private prevPulses: Record<LLMStageId, number> | null = null;
  private ambientAccumulator = 0;
  private lastPulseAt = 0;

  private readonly incoming: Record<string, ConnectionLayout[]> = {};

  constructor(
    private readonly system: ParticleSystem,
    private readonly getProvider: () => ProviderDescriptor | undefined,
    connections: ConnectionLayout[],
    private readonly cycle: string[],
  ) {
    for (const c of connections) {
      system.registerPath(c.id, c.points);
      (this.incoming[c.to] ??= []).push(c);
    }
  }

  reset(): void {
    this.prevNodes = null;
    this.prevPulses = null;
    this.system.clear();
  }

  /** Called every frame with the latest visual state (or undefined when no run). */
  update(visual: VisualState | undefined, dtSeconds: number, nowMs: number): void {
    if (!visual) {
      if (this.prevNodes) this.reset();
      return;
    }
    const { nodes, pulses, nodeSources } = visual;

    if (this.prevNodes !== nodes) {
      const prev = this.prevNodes;
      for (const id of Object.keys(nodes) as LLMStageId[]) {
        const state = nodes[id];
        const before = prev?.[id] ?? "idle";
        if (state !== before && (state === "active" || state === "processing") && before !== "processing") {
          const color = SOURCE_COLORS[nodeSources[id]];
          for (const conn of this.incoming[id] ?? []) {
            this.system.emit(conn.id, { count: 6, color, size: 3.2, speed: 380, stagger: 0.5 });
          }
        }
      }
      this.prevNodes = nodes;
    }

    if (this.prevPulses !== pulses) {
      const prev = this.prevPulses;
      if (prev && nowMs - this.lastPulseAt > 90) {
        let fired = false;
        for (const id of Object.keys(pulses) as LLMStageId[]) {
          if (pulses[id] !== prev[id]) {
            const color = SOURCE_COLORS[nodeSources[id]];
            for (const conn of this.incoming[id] ?? []) {
              this.system.emit(conn.id, { count: 2, color, size: 2.6, speed: 520, stagger: 0.2 });
              fired = true;
            }
          }
        }
        if (fired) this.lastPulseAt = nowMs;
      }
      this.prevPulses = pulses;
    }

    // Ambient flow around the autoregressive cycle while generation runs.
    const generating = visual.generation.started && !visual.generation.completed && nodes.loop === "processing";
    if (generating) {
      this.ambientAccumulator += dtSeconds;
      const interval = 0.16;
      while (this.ambientAccumulator >= interval && this.cycle.length > 0) {
        this.ambientAccumulator -= interval;
        const conn = this.cycle[Math.floor(Math.random() * this.cycle.length)]!;
        const color = conn === "loop-transformer" || conn === "nextToken-loop" ? SOURCE_COLORS.live : SOURCE_COLORS.simulation;
        this.system.emit(conn, { count: 1, color, size: 2.2, speed: 300 });
      }
    } else {
      this.ambientAccumulator = 0;
    }
    void this.getProvider;
  }
}
