import type { EvidenceCitation } from "@shared/agent";
import type { RepoWorkspace } from "./workspace";

/** `path:12`, `path:12-40`, `path:12–40`, optionally wrapped in backticks or brackets. */
const CITATION = /([\w@.~+\-[\]()/]+):(\d{1,6})(?:\s*[-–]\s*(\d{1,6}))?/g;
/** Host names ("api.example.com:443") look like paths but are not. */
const HOSTLIKE = /^(?:[\w-]+\.)+(?:com|org|net|io|dev|app|ai|co|cloud|local)$/i;

/** Pulls every file citation out of the answer text, in order, without duplicates. */
export function extractCitations(text: string, ws: RepoWorkspace): { ref: string; candidate: string; start: number; end: number }[] {
  const out: { ref: string; candidate: string; start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CITATION)) {
    // The path class accepts brackets and parentheses for Next.js paths like app/(chat)/[id],
    // so a citation written as "(src/a.ts:3)" arrives with a stray "(" to peel off.
    let candidate = m[1]!;
    while (candidate && !ws.resolve(candidate) && /^[([]/.test(candidate)) candidate = candidate.slice(1);
    if (!/[A-Za-z]/.test(candidate) || HOSTLIKE.test(candidate) || /^https?$/i.test(candidate)) continue;
    const looksLikePath = candidate.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(candidate) || ws.resolve(candidate) !== undefined;
    if (!looksLikePath) continue;
    const start = Number(m[2]);
    const end = m[3] ? Math.max(start, Number(m[3])) : start;
    if (start < 1) continue;
    const ref = `${candidate}:${start}${end !== start ? `-${end}` : ""}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({ ref, candidate, start, end });
  }
  return out;
}

/**
 * Checks each citation against the repository and against what the agent was
 * actually shown. This is the part of the investigator that does not depend on
 * the model behaving: a citation to a file that does not exist, a line past the
 * end, or lines no tool ever returned is reported as such.
 */
export function checkEvidence(text: string, ws: RepoWorkspace): EvidenceCitation[] {
  return extractCitations(text, ws).map(({ ref, candidate, start, end }) => {
    const file = ws.resolve(candidate);
    if (!file) {
      const base = candidate.split("/").pop()!;
      const same = ws.allPaths().filter((p) => p.endsWith(`/${base}`) || p === base).length;
      return { ref, file: candidate, startLine: start, endLine: end, status: "missing", note: same > 1 ? `Ambiguous: ${same} files are named ${base}; the citation needs the full path.` : "No such file in the repository." };
    }
    const text = ws.peek(file);
    if (text === undefined) return { ref, file, startLine: start, endLine: end, status: "unseen", note: "The file exists, but the agent never opened it." };
    const lines = text.split("\n").length;
    if (start > lines) return { ref, file, startLine: start, endLine: end, status: "out_of_range", note: `The file has ${lines} lines.` };
    const last = Math.min(end, lines);
    if (!ws.wasSeen(file, start, last)) return { ref, file, startLine: start, endLine: end, status: "unseen", note: "The lines exist, but no tool result showed them to the agent." };
    return { ref, file, startLine: start, endLine: end, status: "verified", note: end > lines ? `Seen by the agent; the file ends at line ${lines}.` : "The agent read these lines before citing them." };
  });
}
