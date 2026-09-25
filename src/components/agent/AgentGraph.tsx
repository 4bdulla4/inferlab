import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { motion } from "motion/react";
import { ArrowDownFromLine, ArrowRightFromLine, Maximize2, Minus, MonitorSmartphone, Plus } from "lucide-react";
import type { DataSource } from "@shared/llm";
import type { NodeState } from "@/types/execution";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { AGENT_NODE_H, AGENT_NODE_W, edgeMidpoint, edgePath, layoutAgentGraph, type AgentLayout, type GraphOrientation, type PlacedNode } from "@/labs/agent/layout";
import { AGENT_NODES, AGENT_STATUS_LABEL, TOOL_CATEGORY_LABEL } from "@/labs/agent/stages";
import type { AgentGraphEdge, AgentGraphNode, AgentRunState, AgentVisualState } from "@/labs/agent/state";
import { cn } from "@/lib/cn";
import { formatMs, formatNumber } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";
import { SourceDot } from "@/components/layout/SourceBadge";
import { NODE_STATE_LABEL, StatusIcon } from "@/components/layout/StatusIcon";
import { NodeGlyph } from "./ToolGlyph";

/* ────────────────────────────── edges ──────────────────────────────── */

type EdgeState = "idle" | "pending" | "active" | "done" | "error";

function edgeState(edge: AgentGraphEdge, nodes: Record<string, NodeState>): EdgeState {
  const from = nodes[edge.from];
  const to = nodes[edge.to];
  if (to === "error") return edge.kind === "fallback" ? "done" : "error";
  if (from === "error" && edge.kind === "fallback") return to === "completed" ? "done" : "active";
  if (to === "active" || to === "processing") return "active";
  if (from === "completed" && to === "completed") return "done";
  if (from === "completed" && (to === "idle" || to === "queued" || to === undefined)) return "pending";
  return "idle";
}

const STROKE: Record<EdgeState, string> = {
  idle: "stroke-line",
  pending: "stroke-line-strong",
  active: "stroke-live",
  done: "stroke-ok/60",
  error: "stroke-err",
};

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2];
/** Below this frame width the flow runs top-to-bottom. */
const VERTICAL_BELOW = 720;

/* ───────────────────────────── preview ─────────────────────────────── */

/** Placeholder drawn before anything runs, so the stage is never empty. */
const PREVIEW: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] } = {
  nodes: [
    { id: "p-goal", kind: "goal", label: "User Goal", sublabel: "what you ask for" },
    { id: "p-init", kind: "init", label: "Agent Initialization", sublabel: "model + tools" },
    { id: "p-instr", kind: "instructions", label: "System Instructions", sublabel: "standing orders" },
    { id: "p-ctx", kind: "context", label: "Context / Memory", sublabel: "what it already knows" },
    { id: "p-plan", kind: "plan", label: "Planning · 1", sublabel: "model request", iteration: 1 },
    { id: "p-dec", kind: "decision", label: "Decision", sublabel: "tools or answer?", iteration: 1 },
    { id: "p-t1", kind: "tool", label: "tool call", sublabel: "arguments → result", iteration: 1, category: "web" },
    { id: "p-t2", kind: "tool", label: "tool call", sublabel: "in parallel", iteration: 1, category: "compute" },
    { id: "p-obs", kind: "observation", label: "Observation / State", sublabel: "results into context", iteration: 1 },
    { id: "p-plan2", kind: "plan", label: "Planning · 2", sublabel: "…and around again", iteration: 2 },
    { id: "p-resp", kind: "response", label: "Final Response", sublabel: "the answer" },
    { id: "p-done", kind: "done", label: "Task Completion", sublabel: "why it ended" },
  ],
  edges: [
    { id: "e1", from: "p-goal", to: "p-init", kind: "flow" },
    { id: "e2", from: "p-init", to: "p-instr", kind: "flow" },
    { id: "e3", from: "p-instr", to: "p-ctx", kind: "flow" },
    { id: "e4", from: "p-ctx", to: "p-plan", kind: "flow" },
    { id: "e5", from: "p-plan", to: "p-dec", kind: "flow" },
    { id: "e6", from: "p-dec", to: "p-t1", kind: "parallel" },
    { id: "e7", from: "p-dec", to: "p-t2", kind: "parallel" },
    { id: "e8", from: "p-t1", to: "p-obs", kind: "flow" },
    { id: "e9", from: "p-t2", to: "p-obs", kind: "flow" },
    { id: "e10", from: "p-obs", to: "p-plan2", kind: "flow" },
    { id: "e11", from: "p-plan2", to: "p-resp", kind: "flow" },
    { id: "e12", from: "p-resp", to: "p-done", kind: "flow" },
  ],
};

/** Per-node facts the card shows as badges, pulled from the run's call records. */
interface NodeMeta {
  attempts: number;
  retries: number;
  waiting: boolean;
  parallel: boolean;
  fallbackFor?: string;
  latencyMs?: number;
  category?: string;
}

function metaFor(node: AgentGraphNode, v: AgentVisualState | undefined, state: NodeState): NodeMeta {
  const meta: NodeMeta = { attempts: 0, retries: 0, waiting: false, parallel: false, category: node.category };
  if (!v || !node.callId) {
    if (node.kind === "plan" && v && node.iteration !== undefined) meta.latencyMs = v.iterations[node.iteration]?.response?.latencyMs;
    return meta;
  }
  const call = v.calls[node.callId];
  if (!call) return meta;
  const own = node.kind === "fallback" ? call.attempts.filter((a) => a.tool === call.fallback?.to) : call.attempts.filter((a) => a.tool === call.name);
  meta.attempts = own.length;
  meta.retries = own.filter((a) => a.error && a.willRetry).length;
  meta.parallel = call.parallel;
  meta.waiting = Boolean(call.approval && !call.approval.resolved && state !== "completed" && state !== "error");
  if (node.kind === "fallback") meta.fallbackFor = call.name;
  if (call.result && (node.kind === "fallback" ? call.completedTool === call.fallback?.to : call.completedTool === call.name)) meta.latencyMs = call.result.latencyMs;
  return meta;
}

/* ─────────────────────────────── graph ─────────────────────────────── */

/**
 * The agent as a graph that grows while it runs. Nodes appear as the agent
 * acts: a planning and decision node per iteration, one node per tool call,
 * approval gates and fallbacks where the run took them. The flow runs left to
 * right on a wide frame and top to bottom on a narrow one; the canvas pans by
 * dragging, zooms with the wheel, and follows the newest node until the reader
 * takes over.
 */
/** `note` replaces the run HUD, for graphs that were not produced by a run (an inferred flow from code). */
export function AgentGraph({ run, dimmed, note }: { run: AgentRunState | undefined; dimmed?: boolean; note?: string }) {
  const visual = run?.visual;
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const selectNode = useAgentStore((s) => s.selectNode);
  const reducedMotion = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  // Runs draw at actual size by default; the preview alone fits the frame.
  const [zoomIdx, setZoomIdx] = useState(ZOOMS.indexOf(1));
  const [fitPref, setFitPref] = useState<boolean | null>(null);
  const [orientationPref, setOrientationPref] = useState<"auto" | GraphOrientation>("auto");
  const [frame, setFrame] = useState({ w: 1200, h: 400 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ left: 0, top: 0, w: 0, h: 0 });
  const following = useRef(true);
  const programmatic = useRef(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  const graph = visual && visual.nodes.length ? { nodes: visual.nodes, edges: visual.edges } : PREVIEW;
  const isPreview = graph === PREVIEW;
  const orientation: GraphOrientation = orientationPref === "auto" ? (frame.w < VERTICAL_BELOW ? "vertical" : "horizontal") : orientationPref;
  const layout = useMemo(() => layoutAgentGraph(graph.nodes, graph.edges, orientation), [graph.nodes, graph.edges, orientation]);
  // Fit is opt-in: squeezing a dozen columns into the frame makes nothing readable.
  const fit = fitPref ?? false;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = Math.min(1, Math.max(0.36, (frame.w - 8) / layout.width));
  // The idle preview is a sketch, so it draws smaller than a run and stays dimmed.
  const scale = fit ? fitScale : isPreview && fitPref === null ? 0.65 : ZOOMS[zoomIdx]!;
  const canvasW = layout.width * scale;
  const canvasH = layout.height * scale;
  // The frame is as tall as the drawing needs, within a band that keeps the page readable.
  const frameH = Math.round(Math.min(orientation === "vertical" ? 640 : 520, Math.max(220, canvasH + 8)));

  const updateViewport = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport({ left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight });
  }, []);
  useEffect(updateViewport, [updateViewport, canvasW, canvasH, frameH]);

  // Follow the newest node while the run grows, unless the reader scrolled away.
  const currentId = visual?.currentNodeId;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !currentId || fit || !following.current) return;
    const node = layout.nodes[currentId];
    if (!node) return;
    const cx = (node.x + node.w / 2) * scale;
    const cy = (node.y + node.h / 2) * scale;
    const left = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, cx - el.clientWidth * 0.6));
    const top = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, cy - el.clientHeight * 0.6));
    programmatic.current = true;
    el.scrollTo({ left, top, behavior: reducedMotion ? "auto" : "smooth" });
    window.setTimeout(() => {
      programmatic.current = false;
    }, 600);
  }, [currentId, layout, scale, fit, reducedMotion]);

  const onScroll = useCallback(() => {
    updateViewport();
    if (programmatic.current) return;
    const el = scroller.current;
    if (!el) return;
    // Scrolling back near the newest content resumes following; anywhere else holds still.
    const nearEnd = orientation === "vertical" ? el.scrollHeight - el.scrollTop - el.clientHeight < 160 : el.scrollWidth - el.scrollLeft - el.clientWidth < 160;
    following.current = nearEnd;
  }, [orientation, updateViewport]);

  /* drag to pan */
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const el = scroller.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  }, []);
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = scroller.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
    el.dataset.dragging = "true";
  }, []);
  const endDrag = useCallback(() => {
    const el = scroller.current;
    if (el) delete el.dataset.dragging;
    drag.current = null;
  }, []);

  /* wheel zoom with a modifier, plain wheel scrolls */
  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setFitPref(false);
    setZoomIdx((i) => Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1))));
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const current = (e.target as HTMLElement).dataset.agentNode;
      if (!current) return;
      const idx = layout.order.indexOf(current);
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(layout.order.length - 1, idx + 1);
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, idx - 1);
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = layout.order.length - 1;
      if (next !== null) {
        e.preventDefault();
        scroller.current?.querySelector<HTMLElement>(`[data-agent-node="${layout.order[next]}"]`)?.focus();
      }
    },
    [layout.order],
  );

  const jumpTo = useCallback(
    (fx: number, fy: number) => {
      const el = scroller.current;
      if (!el) return;
      programmatic.current = true;
      el.scrollTo({ left: fx * canvasW - el.clientWidth / 2, top: fy * canvasH - el.clientHeight / 2, behavior: reducedMotion ? "auto" : "smooth" });
      following.current = false;
      window.setTimeout(() => {
        programmatic.current = false;
      }, 600);
    },
    [canvasW, canvasH, reducedMotion],
  );

  const fontScale = Math.min(1.1, Math.max(0.84, scale));
  const overflowing = canvasW > frame.w + 4 || canvasH > frameH + 4;
  const hoveredNode = hovered ? graph.nodes.find((n) => n.id === hovered) : undefined;

  return (
    <div className={cn("relative min-w-0 grid gap-2", dimmed && "opacity-60")}>
      <GraphHud
        visual={visual}
        run={run}
        isPreview={isPreview}
        note={note}
        orientation={orientation}
        orientationPref={orientationPref}
        onOrientation={setOrientationPref}
        fit={fit}
        onFit={() => setFitPref(!fit)}
        scale={scale}
        onZoom={(dir) => {
          setFitPref(false);
          setZoomIdx((i) => Math.max(0, Math.min(ZOOMS.length - 1, i + dir)));
        }}
      />

      <div
        ref={scroller}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onWheel={onWheel}
        className="agent-canvas relative w-full min-w-0 overflow-auto panel-scroll select-none rounded-lg border border-line cursor-grab data-[dragging=true]:cursor-grabbing"
        style={{ height: frameH }}
        aria-label={`Agent graph, ${graph.nodes.length} steps, ${orientation}`}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, ["--fs" as string]: fontScale }}>
          {layout.bands.map((band) => (
            <div key={band.iteration} className="absolute rounded-xl border border-dashed border-line/80 bg-[color-mix(in_srgb,var(--color-accent)_3%,transparent)]" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} aria-hidden="true">
              <span className="mono absolute left-3 top-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-faint" style={{ fontSize: `calc(10.5px * var(--fs))` }}>
                <span className="inline-block size-1.5 rounded-full bg-accent/60" />
                iteration {band.iteration}
                {visual?.iterations[band.iteration]?.response ? <span className="normal-case tracking-normal text-faint/80">· {formatMs(visual.iterations[band.iteration]!.response!.latencyMs)}</span> : null}
              </span>
            </div>
          ))}

          <svg className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="agent-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className="fill-line-strong" />
              </marker>
              <marker id="agent-arrow-live" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className="fill-live" />
              </marker>
              <marker id="agent-arrow-ok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className="fill-ok/70" />
              </marker>
              <marker id="agent-arrow-err" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className="fill-err" />
              </marker>
            </defs>
            {graph.edges.map((edge, i) => {
              const from = layout.nodes[edge.from];
              const to = layout.nodes[edge.to];
              if (!from || !to) return null;
              return <GraphEdge key={edge.id} index={i} edge={edge} from={from} to={to} orientation={orientation} state={isPreview ? "idle" : edgeState(edge, visual!.nodeState)} reducedMotion={reducedMotion} />;
            })}
          </svg>

          {graph.nodes.map((node) => {
            const placed = layout.nodes[node.id];
            if (!placed) return null;
            const state = isPreview ? "idle" : visual!.nodeState[node.id] ?? "idle";
            return (
              <GraphNode
                key={node.id}
                node={node}
                placed={placed}
                state={state}
                source={isPreview ? "live" : visual!.nodeSource[node.id] ?? "live"}
                pulse={isPreview ? 0 : visual!.pulses[node.id] ?? 0}
                selected={selectedNodeId === node.id}
                current={!isPreview && currentId === node.id}
                meta={metaFor(node, isPreview ? undefined : visual, state)}
                reducedMotion={reducedMotion}
                onSelect={isPreview ? undefined : selectNode}
                onHover={setHovered}
              />
            );
          })}

          {hoveredNode && layout.nodes[hoveredNode.id] ? <NodeTooltip node={hoveredNode} placed={layout.nodes[hoveredNode.id]!} state={isPreview ? "idle" : visual!.nodeState[hoveredNode.id] ?? "idle"} source={isPreview ? "live" : visual!.nodeSource[hoveredNode.id] ?? "live"} layout={layout} /> : null}
        </div>
      </div>

      {overflowing && !isPreview && graph.nodes.length > 4 ? <Minimap layout={layout} nodes={graph.nodes} states={visual!.nodeState} currentId={currentId ?? null} viewport={viewport} canvasW={canvasW} canvasH={canvasH} onJump={jumpTo} /> : null}
    </div>
  );
}

/* ─────────────────────────────── HUD ───────────────────────────────── */

function GraphHud({ visual, run, isPreview, note, orientation, orientationPref, onOrientation, fit, onFit, scale, onZoom }: { visual: AgentVisualState | undefined; run: AgentRunState | undefined; isPreview: boolean; note?: string; orientation: GraphOrientation; orientationPref: "auto" | GraphOrientation; onOrientation: (o: "auto" | GraphOrientation) => void; fit: boolean; onFit: () => void; scale: number; onZoom: (dir: 1 | -1) => void }) {
  const snap = visual?.snapshot;
  const max = snap?.maxIterations ?? run?.config.maxIterations ?? 0;
  const done = snap?.iteration ?? 0;
  const status = snap ? AGENT_STATUS_LABEL[snap.status] : run ? "Starting" : "Idle";
  const tone = snap?.status === "failed" ? "text-err border-err/40 bg-err/10" : snap?.status === "awaiting_human" ? "text-warn border-warn/40 bg-warn/10" : snap?.status === "completed" ? "text-ok border-ok/40 bg-ok/10" : run?.status === "running" ? "text-live border-live/40 bg-live/10" : "text-muted border-line surface-1";
  const elapsed = visual?.completion?.totalMs ?? (run && visual?.timeline.length ? (visual.timeline.at(-1)!.endedAt ?? visual.timeline.at(-1)!.startedAt) - visual.timeline[0]!.startedAt : undefined);
  const iconBtn = "grid size-7 place-items-center rounded-md text-muted hover:text-ink hover:surface-2 disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
      {note ? (
        <p className="mono text-[10.5px] text-muted truncate">{note}</p>
      ) : isPreview ? (
        <p className="mono text-[10.5px] text-muted truncate">A preview of the shape a run takes. Every node here will be drawn by real events once you press RUN.</p>
      ) : (
        <>
          <span className={cn("mono inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[10.5px] uppercase tracking-[0.1em]", tone)}>
            {run?.status === "running" && snap?.status !== "awaiting_human" ? <span className="inline-block size-1.5 rounded-full bg-current animate-pulse" /> : null}
            {status}
          </span>
          {max ? (
            <span className="flex items-center gap-1" title={`iteration ${done} of ${max}`} aria-label={`iteration ${done} of ${max}`}>
              {Array.from({ length: max }, (_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-[width,background-color]", i < done ? "w-4 bg-accent" : i === done && run?.status === "running" ? "w-4 bg-accent/40 animate-pulse" : "w-2 bg-line-strong")} />
              ))}
              <span className="mono ml-1 text-[10.5px] text-muted">
                {done}/{max}
              </span>
            </span>
          ) : null}
          <span className="mono hidden sm:inline text-[10.5px] text-muted">
            {snap ? `${snap.toolCalls} tool call${snap.toolCalls === 1 ? "" : "s"}` : ""}
            {snap?.errors ? <span className="text-err"> · {snap.errors} error{snap.errors === 1 ? "" : "s"}</span> : null}
            {snap?.retries ? <span className="text-warn"> · {snap.retries} retr{snap.retries === 1 ? "y" : "ies"}</span> : null}
            {snap ? ` · ${formatNumber(snap.usage.totalTokens)} tok` : ""}
            {elapsed !== undefined ? ` · ${formatMs(elapsed)}` : ""}
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-0.5 rounded-lg border border-line surface-1 p-0.5">
        <button type="button" onClick={() => onOrientation(orientationPref === "auto" ? (orientation === "vertical" ? "horizontal" : "vertical") : orientationPref === "vertical" ? "horizontal" : "vertical")} className={iconBtn} title={`Flow: ${orientation}${orientationPref === "auto" ? " (auto)" : ""} · click to flip`} aria-label="Flip flow direction">
          {orientation === "vertical" ? <ArrowDownFromLine className="size-3.5" /> : <ArrowRightFromLine className="size-3.5" />}
        </button>
        {orientationPref !== "auto" ? (
          <button type="button" onClick={() => onOrientation("auto")} className={iconBtn} title="Choose the direction from the frame width" aria-label="Automatic flow direction">
            <MonitorSmartphone className="size-3.5" />
          </button>
        ) : null}
        <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
        <button type="button" onClick={() => onZoom(-1)} className={iconBtn} aria-label="Zoom out" title="Zoom out (⌘/Ctrl + wheel)">
          <Minus className="size-3.5" />
        </button>
        <span className="mono w-9 text-center text-[10px] text-faint">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => onZoom(1)} className={iconBtn} aria-label="Zoom in" title="Zoom in (⌘/Ctrl + wheel)">
          <Plus className="size-3.5" />
        </button>
        <button type="button" onClick={onFit} aria-pressed={fit} title={fit ? "Actual size; drag or scroll to pan" : "Fit the whole graph in the frame"} className={cn(iconBtn, fit && "surface-3 text-ink")}>
          <Maximize2 className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

/* ─────────────────────────────── edges ─────────────────────────────── */

const GraphEdge = memo(function GraphEdge({ index, edge, from, to, orientation, state, reducedMotion }: { index: number; edge: AgentGraphEdge; from: PlacedNode; to: PlacedNode; orientation: GraphOrientation; state: EdgeState; reducedMotion: boolean }) {
  const d = edgePath(from, to, orientation);
  const id = `agent-edge-${index}`;
  const animated = state === "active" && !reducedMotion;
  const marker = state === "active" ? "agent-arrow-live" : state === "done" ? "agent-arrow-ok" : state === "error" ? "agent-arrow-err" : "agent-arrow";
  const mid = edgeMidpoint(from, to, orientation);
  return (
    <g>
      <path id={id} d={d} fill="none" className={cn("transition-colors duration-300", STROKE[state], edge.kind === "fallback" && state !== "error" && "stroke-warn/70")} strokeWidth={state === "active" ? 2.2 : 1.5} strokeDasharray={edge.kind === "fallback" ? "6 5" : animated ? "9 9" : undefined} markerEnd={`url(#${marker})`} strokeLinejoin="round" strokeLinecap="round">
        {animated && edge.kind !== "fallback" ? <animate attributeName="stroke-dashoffset" from="36" to="0" dur="1.1s" repeatCount="indefinite" /> : null}
      </path>
      {animated
        ? [0, 0.5].map((offset) => (
            <circle key={offset} r={3.2} className="fill-live" opacity={0.9}>
              <animateMotion dur="1.6s" begin={`${offset * 1.6}s`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${id}`} />
              </animateMotion>
            </circle>
          ))
        : null}
      {edge.kind === "fallback" ? (
        <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="fill-warn mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          fallback
        </text>
      ) : null}
    </g>
  );
});

/* ─────────────────────────────── nodes ─────────────────────────────── */

const STATE_STYLE: Record<NodeState, string> = {
  idle: "border-line bg-[var(--color-panel)] text-muted",
  queued: "border-line-strong bg-[var(--color-panel)] text-ink-dim",
  active: "bg-[var(--color-bg-elevated)] text-ink",
  processing: "bg-[var(--color-bg-elevated)] text-ink",
  completed: "border-ok/45 bg-[color-mix(in_srgb,var(--color-ok)_7%,var(--color-panel))] text-ink",
  error: "border-err/60 bg-[color-mix(in_srgb,var(--color-err)_9%,var(--color-panel))] text-ink shadow-glow-err",
};

const KIND_ACCENT: Partial<Record<AgentGraphNode["kind"], string>> = {
  goal: "before:bg-accent-soft",
  plan: "before:bg-accent",
  decision: "before:bg-warn",
  approval: "before:bg-warn",
  fallback: "before:bg-warn",
  response: "before:bg-live",
  done: "before:bg-ok",
};

function kindChip(node: AgentGraphNode, meta: NodeMeta): string {
  if (node.kind === "tool" || node.kind === "fallback") return meta.category ? TOOL_CATEGORY_LABEL[meta.category as keyof typeof TOOL_CATEGORY_LABEL].toLowerCase() : "tool";
  if (node.kind === "plan") return "model";
  if (node.kind === "approval") return "human";
  return node.kind;
}

const GraphNode = memo(function GraphNode({ node, placed, state, source, pulse, selected, current, meta, reducedMotion, onSelect, onHover }: { node: AgentGraphNode; placed: PlacedNode; state: NodeState; source: DataSource; pulse: number; selected: boolean; current: boolean; meta: NodeMeta; reducedMotion: boolean; onSelect?: (id: string) => void; onHover: (id: string | null) => void }) {
  const live = state === "active" || state === "processing";
  const glow = live ? (source === "live" ? "border-live/70 shadow-glow-live" : "border-sim/70 shadow-glow-sim") : "";
  const waiting = meta.waiting || (node.human && live);
  return (
    <motion.div
      className="absolute"
      initial={reducedMotion ? false : { x: placed.x, y: placed.y, opacity: 0, scale: 0.86 }}
      animate={{ x: placed.x, y: placed.y, opacity: 1, scale: 1 }}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 30 }}
      style={{ width: AGENT_NODE_W, height: AGENT_NODE_H, left: 0, top: 0 }}
    >
      <button
        type="button"
        data-agent-node={node.id}
        onClick={() => onSelect?.(node.id)}
        onPointerEnter={() => onHover(node.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(node.id)}
        onBlur={() => onHover(null)}
        aria-pressed={selected}
        aria-label={`${node.label}: ${NODE_STATE_LABEL[state]}${node.sublabel ? `, ${node.sublabel}` : ""}`}
        className={cn(
          "relative size-full overflow-hidden rounded-xl border text-left transition-[border-color,background-color,box-shadow] duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft/70",
          "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-line-strong",
          STATE_STYLE[state],
          KIND_ACCENT[node.kind],
          glow,
          waiting && "border-dashed border-warn/70",
          selected && "ring-2 ring-accent-soft/80 ring-offset-2 ring-offset-bg",
          current && !selected && "ring-1 ring-accent/50",
        )}
        style={{ fontSize: `calc(11px * var(--fs))` }}
      >
        <span className="grid size-full grid-rows-[auto_auto_auto] content-center gap-y-[0.2em] pl-3.5 pr-2.5">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[1.2em] inline-flex shrink-0">
              <StatusIcon state={state} spin={!reducedMotion} />
            </span>
            <NodeGlyph kind={node.kind} category={node.category} className="size-[1em] shrink-0 text-muted" />
            <span className="mono font-semibold uppercase leading-[1.15] text-[0.84em] tracking-[0.07em] truncate">{node.label}</span>
            <span className="ml-auto shrink-0 inline-flex items-center gap-1">
              {meta.retries > 0 ? (
                <span className="mono rounded border border-warn/50 bg-warn/10 px-1 text-[0.72em] leading-[1.4] text-warn" title={`${meta.retries} retr${meta.retries === 1 ? "y" : "ies"}`}>
                  ↻{meta.retries}
                </span>
              ) : null}
              <SourceDot source={source} />
            </span>
          </span>
          <span className="mono text-[0.8em] truncate text-muted">{node.sublabel ?? ""}</span>
          <span className="flex items-center gap-1 min-w-0 text-[0.72em]">
            <span className="mono rounded border border-line px-1 leading-[1.5] text-faint uppercase tracking-[0.08em] truncate">{kindChip(node, meta)}</span>
            {meta.parallel && node.kind === "tool" ? <span className="mono rounded border border-accent/40 px-1 leading-[1.5] text-accent-soft uppercase tracking-[0.08em]">parallel</span> : null}
            {waiting ? <span className="mono rounded border border-warn/50 px-1 leading-[1.5] text-warn uppercase tracking-[0.08em] animate-pulse">waiting for you</span> : null}
            {meta.latencyMs !== undefined && state === "completed" ? <span className="mono ml-auto text-faint">{formatMs(meta.latencyMs)}</span> : null}
          </span>
        </span>
        {state === "processing" && !reducedMotion ? <span aria-hidden="true" className={cn("agent-sweep absolute inset-x-0 bottom-0 h-[3px]", source === "live" ? "text-live" : "text-sim")} /> : null}
      </button>
      {pulse > 0 && !reducedMotion ? <span key={pulse} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-xl animate-pulse-ring", source === "live" ? "shadow-glow-live" : "shadow-glow-sim")} /> : null}
    </motion.div>
  );
});

/* ────────────────────────────── tooltip ────────────────────────────── */

function NodeTooltip({ node, placed, state, source, layout }: { node: AgentGraphNode; placed: PlacedNode; state: NodeState; source: DataSource; layout: AgentLayout }) {
  const def = AGENT_NODES[node.kind];
  const below = placed.y + placed.h + 120 < layout.height || placed.y < 120;
  const width = 260;
  const left = Math.max(4, Math.min(layout.width - width - 4, placed.x + placed.w / 2 - width / 2));
  return (
    <div role="tooltip" className="pointer-events-none absolute z-20 rounded-lg popover px-3 py-2 grid gap-1 animate-fade-up" style={{ left, top: below ? placed.y + placed.h + 8 : placed.y - 8, transform: below ? undefined : "translateY(-100%)", width }}>
      <span className="flex items-center gap-2 min-w-0">
        <span className="mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink truncate">{node.label}</span>
        <span className="mono ml-auto text-[10px] uppercase tracking-wider text-muted">{NODE_STATE_LABEL[state]}</span>
        <SourceDot source={source} />
      </span>
      {node.sublabel ? <span className="mono text-[10.5px] text-ink-dim truncate">{node.sublabel}</span> : null}
      <span className="text-[11px] leading-snug text-muted">{def.beginner}</span>
      <span className="mono text-[9.5px] text-faint">click to inspect · arrow keys move between steps</span>
    </div>
  );
}

/* ────────────────────────────── minimap ────────────────────────────── */

const MINI_FILL: Record<NodeState, string> = {
  idle: "fill-line-strong",
  queued: "fill-line-strong",
  active: "fill-live",
  processing: "fill-live",
  completed: "fill-ok/70",
  error: "fill-err",
};

/** The whole graph at a glance, with the visible window drawn over it; click anywhere to jump there. */
function Minimap({ layout, nodes, states, currentId, viewport, canvasW, canvasH, onJump }: { layout: AgentLayout; nodes: AgentGraphNode[]; states: Record<string, NodeState>; currentId: string | null; viewport: { left: number; top: number; w: number; h: number }; canvasW: number; canvasH: number; onJump: (fx: number, fy: number) => void }) {
  const aspect = layout.width / layout.height;
  const w = Math.min(320, Math.max(160, aspect * 56));
  const h = Math.max(36, Math.min(120, w / aspect));
  const vx = canvasW ? viewport.left / canvasW : 0;
  const vy = canvasH ? viewport.top / canvasH : 0;
  const vw = canvasW ? Math.min(1, viewport.w / canvasW) : 1;
  const vh = canvasH ? Math.min(1, viewport.h / canvasH) : 1;
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="mono text-[9.5px] uppercase tracking-[0.14em] text-faint">overview</span>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Graph overview; click to move the view"
        className="rounded-md border border-line surface-1 cursor-pointer"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onJump((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }}
      >
        {nodes.map((n) => {
          const p = layout.nodes[n.id];
          if (!p) return null;
          return <rect key={n.id} x={p.x} y={p.y} width={p.w} height={p.h} rx={10} className={cn(MINI_FILL[states[n.id] ?? "idle"], n.id === currentId && "stroke-accent-soft")} strokeWidth={n.id === currentId ? 14 : 0} opacity={0.9} />;
        })}
        <rect x={vx * layout.width} y={vy * layout.height} width={vw * layout.width} height={vh * layout.height} className="fill-accent/10 stroke-accent-soft" strokeWidth={6} rx={12} />
      </svg>
    </div>
  );
}
