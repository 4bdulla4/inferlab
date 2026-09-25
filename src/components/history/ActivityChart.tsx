import type { DailyBucket } from "@shared/history";
import { cn } from "@/lib/cn";

const SERIES = [
  { key: "llmRuns" as const, label: "LLM runs", color: "var(--color-live)" },
  { key: "analyses" as const, label: "Analyses", color: "var(--color-accent-soft)" },
  { key: "questions" as const, label: "Questions", color: "var(--color-ok)" },
  { key: "ragQueries" as const, label: "RAG", color: "var(--color-warn)" },
];

const totalOf = (d: DailyBucket) => d.llmRuns + d.analyses + d.questions + (d.ragQueries ?? 0);

/** Stacked daily activity for the last two weeks. Pure SVG, no chart library. */
export function ActivityChart({ daily }: { daily: DailyBucket[] }) {
  const max = Math.max(1, ...daily.map(totalOf));
  const barW = 100 / Math.max(1, daily.length);
  const today = daily[daily.length - 1]?.date;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="label-caps">Activity · last {daily.length} days</p>
        <ul className="flex items-center gap-3">
          {SERIES.map((s) => (
            <li key={s.key} className="mono flex items-center gap-1.5 text-[10px] text-muted">
              <span className="inline-block size-2 rounded-[2px]" style={{ backgroundColor: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative h-28 rounded-lg border border-line bg-bg-elevated/50 p-2">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="size-full" role="img" aria-label={`Daily activity for the last ${daily.length} days`}>
          {[10, 20, 30].map((y) => (
            <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={0.3} />
          ))}
          {daily.map((d, i) => {
            const total = totalOf(d);
            let y = 40;
            const x = i * barW + barW * 0.2;
            const w = barW * 0.6;
            return (
              <g key={d.date}>
                <title>{`${d.date}: ${d.llmRuns} runs · ${d.analyses} analyses · ${d.questions} questions · ${d.ragQueries ?? 0} RAG · ${d.tokens.toLocaleString()} tokens`}</title>
                {total === 0 ? <rect x={x} y={39.4} width={w} height={0.6} fill="rgba(255,255,255,0.08)" /> : null}
                {SERIES.map((s) => {
                  const v = d[s.key] ?? 0;
                  if (!v) return null;
                  const h = (v / max) * 38;
                  y -= h;
                  return <rect key={s.key} x={x} y={y} width={w} height={h} fill={s.color} opacity={0.85} />;
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex justify-between mono text-[9.5px] text-faint">
        <span>{daily[0]?.date}</span>
        <span className={cn(today && "text-muted")}>{today} (today)</span>
      </div>
    </div>
  );
}
