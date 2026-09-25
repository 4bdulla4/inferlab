import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Boxes, Cloud, Database, Globe, KeyRound, Layers, MonitorSmartphone, Server, Timer } from "lucide-react";
import type { NodeCategory, RepoAnalysis } from "@shared/repo";
import { ParticleSystem } from "@/engine/animation/ParticleSystem";
import { CATEGORY_COLOR, CATEGORY_LABEL, EVIDENCE_COLOR, NODE_H, NODE_W, layoutGraph, type PositionedEdge, type PositionedNode } from "@/labs/repo/layout";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useRepoStore } from "@/store/repoStore";
import { EvidenceDot } from "./EvidenceBadge";

const ICON: Record<NodeCategory, typeof Globe> = {
  client: MonitorSmartphone,
  frontend: Globe,
  api: Server,
  auth: KeyRound,
  service: Boxes,
  data: Database,
  async: Timer,
  ai: Bot,
  external: Cloud,
  infra: Layers,
};

const ALL_CATEGORIES: NodeCategory[] = ["client", "frontend", "api", "auth", "service", "async", "data", "ai", "external", "infra"];

export function ArchitectureDiagram({ analysis }: { analysis: RepoAnalysis }) {
  const selection = useRepoStore((s) => s.selection);
  const select = useRepoStore((s) => s.select);
  const hovered = useRepoStore((s) => s.hoveredNodeId);
  const setHovered = useRepoStore((s) => s.setHovered);
  const filter = useRepoStore((s) => s.categoryFilter);
  const toggleCategory = useRepoStore((s) => s.toggleCategory);
  const clearFilter = useRepoStore((s) => s.clearCategoryFilter);
  const trace = useRepoStore((s) => s.trace);
  const traceCursor = useRepoStore((s) => s.traceCursor);
  const reducedMotion = useReducedMotion();

  const hidden = useMemo(() => {
    if (!filter) return new Set<string>();
    return new Set(analysis.graph.nodes.filter((n) => filter.has(n.category)).map((n) => n.id));
  }, [analysis, filter]);
  const layout = useMemo(() => layoutGraph(analysis.graph.nodes, analysis.graph.edges, hidden), [analysis, hidden]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / layout.width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width]);

  // Trace highlighting state
  const traceState = useMemo(() => {
    const visited = new Set<string>();
    const edgesOn = new Set<string>();
    let active: string | undefined;
    if (trace && traceCursor >= 0) {
      const steps = trace.steps.slice(0, traceCursor + 1);
      let prev: string | undefined;
      for (const s of steps) {
        if (s.nodeId) {
          visited.add(s.nodeId);
          if (prev && prev !== s.nodeId) {
            const e = analysis.graph.edges.find((x) => (x.from === prev && x.to === s.nodeId) || (x.from === s.nodeId && x.to === prev));
            if (e) edgesOn.add(e.id);
          }
          prev = s.nodeId;
        }
        if (s.edgeId) edgesOn.add(s.edgeId);
      }
      active = steps[steps.length - 1]?.nodeId;
    }
    return { visited, edgesOn, active, playing: Boolean(trace && traceCursor >= 0) };
  }, [trace, traceCursor, analysis]);

  const selectedNodeId = selection?.kind === "node" ? selection.id : undefined;
  const focusNode = hovered ?? selectedNodeId;
  const focusEdges = useMemo(() => new Set(focusNode ? analysis.graph.edges.filter((e) => e.from === focusNode || e.to === focusNode).map((e) => e.id) : []), [focusNode, analysis]);
  const fontScale = Math.min(1.1, Math.max(0.78, scale));

  const categoriesPresent = ALL_CATEGORIES.filter((c) => analysis.graph.nodes.some((n) => n.category === c));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-caps mr-1">Layers</span>
        {categoriesPresent.map((c) => {
          const off = filter?.has(c);
          const Icon = ICON[c];
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              aria-pressed={!off}
              className={cn("mono inline-flex items-center gap-1 rounded-md border px-1.5 h-6 text-[10.5px] uppercase tracking-[0.1em] transition-colors", off ? "border-line text-faint line-through" : "border-line-strong text-ink-dim hover:text-ink")}
              style={off ? undefined : { borderColor: `${CATEGORY_COLOR[c]}66` }}
            >
              <Icon className="size-3" style={{ color: CATEGORY_COLOR[c] }} aria-hidden="true" />
              {CATEGORY_LABEL[c]}
            </button>
          );
        })}
        {filter ? (
          <button type="button" onClick={clearFilter} className="mono text-[10.5px] text-muted underline-offset-2 hover:underline">
            show all
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-3 mono text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-5 bg-ok" /> verified</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-warn" /> inferred</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dotted border-sim" /> ai</span>
        </span>
      </div>

      <div className="overflow-x-auto overflow-y-hidden -mx-1 px-1">
        <div
          ref={containerRef}
          role="group"
          aria-label="Architecture diagram"
          className="relative w-full min-w-[980px] select-none"
          style={{ aspectRatio: `${layout.width} / ${layout.height}`, ["--fs" as string]: fontScale }}
        >
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="absolute inset-0 size-full" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
            <defs>
              {(["verified", "heuristic", "ai"] as const).map((k) => (
                <marker key={k} id={`repo-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={EVIDENCE_COLOR[k]} />
                </marker>
              ))}
              <marker id="repo-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.22)" />
              </marker>
            </defs>
            {layout.columns.map((c) => (
              <g key={c.column}>
                <line x1={c.x} y1={30} x2={c.x} y2={layout.height - 10} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 6" />
                <text x={c.x + 12} y={22} fill="rgba(255,255,255,0.32)" fontSize="10" letterSpacing="2" className="mono">
                  {`0${c.column + 1} · ${c.label.toUpperCase()}`}
                </text>
              </g>
            ))}
            {layout.edges.map((pe) => (
              <EdgePath key={pe.edge.id} pe={pe} focus={focusNode ? focusEdges.has(pe.edge.id) : null} traceOn={traceState.edgesOn.has(pe.edge.id)} tracePlaying={traceState.playing} reducedMotion={reducedMotion} />
            ))}
          </svg>

          {layout.nodes.map((pn) => (
            <NodeCard
              key={pn.node.id}
              pn={pn}
              layoutW={layout.width}
              layoutH={layout.height}
              selected={selectedNodeId === pn.node.id}
              dimmed={(traceState.playing && !traceState.visited.has(pn.node.id)) || (focusNode !== undefined && focusNode !== pn.node.id && !analysis.graph.edges.some((e) => focusEdges.has(e.id) && (e.from === pn.node.id || e.to === pn.node.id)))}
              active={traceState.active === pn.node.id}
              visited={traceState.visited.has(pn.node.id)}
              onSelect={() => select(selection?.kind === "node" && selection.id === pn.node.id ? null : { kind: "node", id: pn.node.id })}
              onHover={(on) => setHovered(on ? pn.node.id : null)}
              reducedMotion={reducedMotion}
            />
          ))}

          {!reducedMotion ? <TraceParticles layoutEdges={layout.edges} layoutNodes={layout.nodes} width={layout.width} height={layout.height} scale={scale} /> : null}
        </div>
      </div>
    </div>
  );
}

function EdgePath({ pe, focus, traceOn, tracePlaying, reducedMotion }: { pe: PositionedEdge; focus: boolean | null; traceOn: boolean; tracePlaying: boolean; reducedMotion: boolean }) {
  const k = pe.edge.evidence.kind;
  const color = EVIDENCE_COLOR[k];
  const dim = (focus === false || (tracePlaying && !traceOn)) && !traceOn;
  const strong = focus === true || traceOn;
  const dash = k === "heuristic" ? "6 6" : k === "ai" ? "2 5" : undefined;
  return (
    <g>
      <path d={pe.d} fill="none" stroke="transparent" strokeWidth={10} />
      <path
        d={pe.d}
        fill="none"
        stroke={dim ? "rgba(255,255,255,0.10)" : color}
        strokeWidth={strong ? 2.6 : Math.min(2.2, 1 + Math.log2(1 + pe.edge.weight) * 0.4)}
        strokeDasharray={dash}
        strokeLinecap="round"
        opacity={dim ? 0.6 : strong ? 1 : 0.55}
        markerEnd={`url(#repo-arrow-${dim ? "dim" : k})`}
        style={{ filter: strong ? `drop-shadow(0 0 5px ${color})` : undefined, transition: "stroke 200ms, opacity 200ms" }}
      />
      {traceOn && !reducedMotion ? <path d={pe.d} fill="none" stroke="#ffffff" strokeWidth={1.4} strokeDasharray="5 16" strokeLinecap="round" opacity={0.8} className="animate-dash" /> : null}
    </g>
  );
}

function NodeCard({ pn, layoutW, layoutH, selected, dimmed, active, visited, onSelect, onHover, reducedMotion }: { pn: PositionedNode; layoutW: number; layoutH: number; selected: boolean; dimmed: boolean; active: boolean; visited: boolean; onSelect: () => void; onHover: (on: boolean) => void; reducedMotion: boolean }) {
  const n = pn.node;
  const Icon = ICON[n.category];
  const color = CATEGORY_COLOR[n.category];
  const hasVerified = n.evidence.some((e) => e.kind === "verified") || n.files.length > 0;
  const counts = [n.files.length ? `${n.files.length} files` : null, n.routes.length ? `${n.routes.length} routes` : null, n.symbols.length ? `${n.symbols.length} symbols` : null].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      data-arch-node={n.id}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-pressed={selected}
      aria-label={`${n.label}, ${CATEGORY_LABEL[n.category]}${counts ? `, ${counts}` : ""}`}
      className={cn(
        "absolute rounded-lg border text-left transition-all duration-200 overflow-hidden",
        "bg-bg-elevated/85 border-line hover:border-line-strong",
        selected && "ring-2 ring-accent-soft/70 ring-offset-2 ring-offset-bg",
        active && "border-accent-soft/80 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-soft)_55%,transparent),0_0_26px_color-mix(in_srgb,var(--color-accent-soft)_35%,transparent)]",
        visited && !active && "border-ok/50",
        dimmed && "opacity-35",
      )}
      style={{
        left: `${(pn.x / layoutW) * 100}%`,
        top: `${(pn.y / layoutH) * 100}%`,
        width: `${(NODE_W / layoutW) * 100}%`,
        height: `${(NODE_H / layoutH) * 100}%`,
        fontSize: "calc(12px * var(--fs))",
        transform: active && !reducedMotion ? "scale(1.04)" : undefined,
        boxShadow: !active && !dimmed ? `inset 3px 0 0 ${color}` : undefined,
      }}
    >
      <span className="flex size-full flex-col justify-between gap-[0.2em] px-[0.9em] py-[0.55em]">
        <span className="flex items-start gap-[0.5em]">
          <Icon className="mt-[0.1em] size-[1.15em] shrink-0" style={{ color }} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-ink text-[1em] leading-tight">{n.label}</span>
            <span className="block truncate text-[0.82em] text-muted leading-tight">{n.summary}</span>
          </span>
          <span className="flex flex-col items-end gap-[0.2em]">
            <EvidenceDot kind={hasVerified ? "verified" : "heuristic"} />
            {n.aiSummary ? <EvidenceDot kind="ai" /> : null}
          </span>
        </span>
        <span className="mono flex items-center gap-[0.6em] text-[0.74em] text-faint">
          <span className="uppercase tracking-[0.1em]" style={{ color }}>{CATEGORY_LABEL[n.category]}</span>
          <span className="truncate">{counts}</span>
          {n.evidence.length === 0 && n.files.length === 0 ? <AlertTriangle className="size-[1em] text-warn" aria-label="no direct file evidence" /> : null}
        </span>
      </span>
    </button>
  );
}

/** Canvas particle overlay: fires a burst along the edge entering the current trace step. */
function TraceParticles({ layoutEdges, layoutNodes, width, height, scale }: { layoutEdges: PositionedEdge[]; layoutNodes: PositionedNode[]; width: number; height: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const systemRef = useRef<ParticleSystem | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const trace = useRepoStore((s) => s.trace);
  const cursor = useRepoStore((s) => s.traceCursor);
  const hovered = useRepoStore((s) => s.hoveredNodeId);

  useEffect(() => {
    const system = new ParticleSystem();
    for (const pe of layoutEdges) system.registerPath(pe.edge.id, pe.points);
    for (const a of layoutNodes) for (const b of layoutNodes) if (a !== b) system.registerPath(`direct:${a.node.id}→${b.node.id}`, [[a.x + a.w / 2, a.y + a.h / 2], [b.x + b.w / 2, b.y + b.h / 2]]);
    systemRef.current = system;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = scaleRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(width * s);
      const h = Math.round(height * s);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      system.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (system.particles.length) system.draw(ctx, s);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [layoutEdges, layoutNodes, width, height]);

  // Emit on trace step change
  useEffect(() => {
    const system = systemRef.current;
    if (!system || !trace || cursor < 0) return;
    const step = trace.steps[cursor];
    const prev = trace.steps.slice(0, cursor).reverse().find((s) => s.nodeId && s.nodeId !== step?.nodeId);
    if (!step?.nodeId) return;
    const color = EVIDENCE_COLOR[step.kind];
    const edge = step.edgeId ? layoutEdges.find((e) => e.edge.id === step.edgeId) : prev?.nodeId ? layoutEdges.find((e) => (e.edge.from === prev.nodeId && e.edge.to === step.nodeId) || (e.edge.to === prev.nodeId && e.edge.from === step.nodeId)) : undefined;
    if (edge) system.emit(edge.edge.id, { count: 10, color, size: 3, speed: 420, stagger: 0.6 });
    else if (prev?.nodeId) system.emit(`direct:${prev.nodeId}→${step.nodeId}`, { count: 8, color, size: 2.6, speed: 420, stagger: 0.6 });
  }, [trace, cursor, layoutEdges]);

  // Gentle flow on hover
  useEffect(() => {
    const system = systemRef.current;
    if (!system || !hovered) return;
    const out = layoutEdges.filter((e) => e.edge.from === hovered);
    for (const e of out.slice(0, 6)) system.emit(e.edge.id, { count: 3, color: EVIDENCE_COLOR[e.edge.evidence.kind], size: 2.2, speed: 380, stagger: 0.4 });
  }, [hovered, layoutEdges]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}
