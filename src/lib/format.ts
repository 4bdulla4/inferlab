export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatPct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString();
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function formatDelta(from: number, to: number | undefined): string {
  if (to === undefined) return "…";
  return formatMs(to - from);
}

/** Makes whitespace visible inside token chips. */
export function visibleToken(token: string): string {
  return token.replace(/ /g, "␣").replace(/\n/g, "↵").replace(/\t/g, "⇥");
}
