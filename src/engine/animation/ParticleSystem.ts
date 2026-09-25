import { buildPath, pointAt, type Point, type PolylinePath } from "./geometry";

export interface Particle {
  path: string;
  t: number;
  /** Virtual units per second. */
  speed: number;
  size: number;
  color: string;
  alpha: number;
}

export interface EmitOptions {
  count?: number;
  color: string;
  size?: number;
  speed?: number;
  /** Spread particles along the first `stagger` fraction of the path. */
  stagger?: number;
}

/**
 * Canvas-friendly particle pool. Particles travel along named polyline paths in
 * the pipeline's virtual coordinate space; drawing scales to the real canvas.
 */
export class ParticleSystem {
  private readonly paths = new Map<string, PolylinePath>();
  particles: Particle[] = [];
  readonly maxParticles = 600;

  registerPath(id: string, points: Point[]): void {
    this.paths.set(id, buildPath(points));
  }

  emit(pathId: string, options: EmitOptions): void {
    const path = this.paths.get(pathId);
    if (!path) return;
    const count = options.count ?? 1;
    const stagger = options.stagger ?? 0.25;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      this.particles.push({
        path: pathId,
        t: -(i / Math.max(1, count)) * stagger,
        speed: options.speed ?? 260,
        size: options.size ?? 3,
        color: options.color,
        alpha: 1,
      });
    }
  }

  update(dtSeconds: number): void {
    const next: Particle[] = [];
    for (const p of this.particles) {
      const path = this.paths.get(p.path);
      if (!path || path.length === 0) continue;
      p.t += (p.speed * dtSeconds) / path.length;
      if (p.t <= 1) next.push(p);
    }
    this.particles = next;
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (p.t < 0) continue;
      const path = this.paths.get(p.path);
      if (!path) continue;
      const [x, y] = pointAt(path, p.t);
      const fade = p.t < 0.1 ? p.t / 0.1 : p.t > 0.85 ? (1 - p.t) / 0.15 : 1;
      const alpha = Math.max(0, Math.min(1, fade * p.alpha));
      const px = x * scale;
      const py = y * scale;
      const r = p.size * scale;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 3.2);
      glow.addColorStop(0, withAlpha(p.color, alpha * 0.9));
      glow.addColorStop(0.35, withAlpha(p.color, alpha * 0.35));
      glow.addColorStop(1, withAlpha(p.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha("#ffffff", alpha * 0.95);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.8, r * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  clear(): void {
    this.particles = [];
  }
}

const colorCache = new Map<string, [number, number, number]>();

function parseColor(color: string): [number, number, number] {
  const cached = colorCache.get(color);
  if (cached) return cached;
  let rgb: [number, number, number] = [255, 255, 255];
  const hex = color.replace("#", "");
  if (hex.length === 6) {
    rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  } else if (hex.length === 3) {
    rgb = [parseInt(hex[0]! + hex[0]!, 16), parseInt(hex[1]! + hex[1]!, 16), parseInt(hex[2]! + hex[2]!, 16)];
  }
  colorCache.set(color, rgb);
  return rgb;
}

function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}
