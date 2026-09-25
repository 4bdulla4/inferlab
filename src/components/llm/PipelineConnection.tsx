import type { DataSource } from "@shared/llm";
import type { ConnectionLayout } from "@/labs/llm/layout";
import { toSvgPath } from "@/engine/animation/geometry";
import { cn } from "@/lib/cn";

export type ConnectionState = "idle" | "pending" | "active" | "done" | "error";

export interface PipelineConnectionProps {
  conn: ConnectionLayout;
  state: ConnectionState;
  source: DataSource;
  reducedMotion: boolean;
}

const COLOR: Record<DataSource, string> = { live: "var(--color-live)", simulation: "var(--color-sim)" };

export function PipelineConnection({ conn, state, source, reducedMotion }: PipelineConnectionProps) {
  const d = toSvgPath(conn.points, conn.kind === "loop" ? 14 : 8);
  const color = state === "error" ? "var(--color-err)" : state === "done" ? "var(--color-ok)" : COLOR[source];
  const markerId = state === "error" ? "arrow-err" : state === "done" ? "arrow-ok" : source === "live" ? "arrow-live" : "arrow-sim";
  const showMarker = conn.kind !== "internal";

  return (
    <g className="pipeline-connection" data-state={state}>
      {/* base track */}
      <path d={d} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={conn.kind === "internal" ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={conn.kind === "loop" ? "4 6" : undefined}
        markerEnd={showMarker && state === "idle" ? "url(#arrow-idle)" : undefined}
      />
      {state !== "idle" ? (
        <>
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={state === "active" ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={state === "pending" ? 0.35 : state === "done" ? 0.75 : 1}
            markerEnd={showMarker ? `url(#${markerId})` : undefined}
            style={{ filter: state === "active" ? `drop-shadow(0 0 6px ${color})` : undefined }}
          />
          {state === "active" && !reducedMotion ? (
            <path
              d={d}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="6 18"
              opacity={0.75}
              className={cn("animate-dash")}
            />
          ) : null}
        </>
      ) : null}
    </g>
  );
}

export function ConnectionMarkers() {
  const defs: [string, string][] = [
    ["arrow-idle", "rgba(255,255,255,0.18)"],
    ["arrow-live", "var(--color-live)"],
    ["arrow-sim", "var(--color-sim)"],
    ["arrow-ok", "var(--color-ok)"],
    ["arrow-err", "var(--color-err)"],
  ];
  return (
    <defs>
      {defs.map(([id, fill]) => (
        <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
        </marker>
      ))}
    </defs>
  );
}
