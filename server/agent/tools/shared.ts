import { AGENT_LIMITS } from "../../../shared/agent";

/** Caps what a tool hands back to the model, saying so when it did. */
export function truncateContent(text: string, limit = AGENT_LIMITS.maxToolResultChars): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n\n[… ${text.length - limit} more characters were cut to fit the tool-result limit]`, truncated: true };
}

/** JSON for the model with a hard cap. */
export function jsonForModel(value: unknown, limit = AGENT_LIMITS.maxToolResultChars): { text: string; truncated: boolean } {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    s = String(value);
  }
  return truncateContent(s, limit);
}

export function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return v === undefined || v === null ? "" : String(v);
}

export function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
