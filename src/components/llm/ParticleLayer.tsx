import { useEffect, useRef } from "react";
import { AnimationController } from "@/engine/animation/AnimationController";
import { ParticleSystem } from "@/engine/animation/ParticleSystem";
import type { ConnectionLayout } from "@/labs/llm/layout";
import { useExecutionStore } from "@/store/executionStore";

/**
 * Canvas overlay that renders data particles. It reads the latest run state
 * directly from the store on every frame, so React never re-renders for
 * individual particles.
 */
export function ParticleLayer({ runId, scale, connections, cycle, width, height }: { runId: string | null; scale: number; connections: ConnectionLayout[]; cycle: string[]; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const system = new ParticleSystem();
    const controller = new AnimationController(system, () => (runId ? useExecutionStore.getState().runs[runId]?.provider : undefined), connections, cycle);
    let raf = 0;
    let last = performance.now();
    let lastW = 0;
    let lastH = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = scaleRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(width * s);
      const h = Math.round(height * s);
      if (w !== lastW || h !== lastH) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        lastW = w;
        lastH = h;
      }
      const run = runId ? useExecutionStore.getState().runs[runId] : undefined;
      controller.update(run?.visual, dt, now);
      system.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (system.particles.length > 0) system.draw(ctx, s);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [runId, connections, cycle, width, height]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}
