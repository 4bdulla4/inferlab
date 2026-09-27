import type { RepoAnalysis, RepoRef } from "@shared/repo";
import { INVESTIGATION_LIMITS } from "../../../shared/repo";
import { isLiveEnvFile, maskEnvFile, redactText } from "../../lib/redact";
import type { GitHubClient } from "../github";

/** The slice of GitHubClient the workspace needs, so tests can pass a stub. */
export type FileSource = Pick<GitHubClient, "getRawFile">;

const MAX_FILE_BYTES = 400_000;

/**
 * Phrases that address an AI reading the file rather than a person. A repository
 * can plant them to steer the investigator; finding one does not block the
 * file, it marks it so the agent and the person both see it for what it is.
 */
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|system)\b.{0,24}\b(instructions?|prompts?|rules?|directions?)\b/i,
  /\b(reveal|print|output|repeat|show)\b.{0,30}\b(system prompt|your (instructions|prompt|rules))\b/i,
  /\b(ai|llm|assistant|agent|model)s?\b.{0,20}\b(reading|analy[sz]ing|reviewing|scanning) (this|these)\b/i,
  /\b(you are now|from now on you|new instructions?:)/i,
];

/** Line numbers (1-based) that look like instructions aimed at an AI. */
export function injectionLines(text: string): number[] {
  const out: number[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.slice(0, 400);
    if (INJECTION_PATTERNS.some((re) => re.test(line))) out.push(i + 1);
  }
  return out;
}

/**
 * The investigator's view of one repository at one commit. Every byte the
 * agent sees passes through here, so the rules live here too, in code:
 * secrets are redacted and live `.env` files are reduced to variable names
 * before any tool returns them; downloads beyond the scan are capped; and every
 * line shown to the agent is recorded so its citations can be checked later.
 */
export class RepoWorkspace {
  private readonly contents = new Map<string, string>();
  private readonly paths: Set<string>;
  private readonly seen = new Map<string, [number, number][]>();
  private extraFetches = 0;
  private readonly flagged = new Map<string, number[]>();
  redactions = 0;

  constructor(
    readonly analysis: RepoAnalysis,
    scanned: Map<string, string> | null,
    private readonly source: FileSource | null,
    private readonly maxExtraFiles = INVESTIGATION_LIMITS.maxExtraFiles,
  ) {
    this.paths = new Set(analysis.files.map((f) => f.path));
    for (const [path, text] of scanned ?? []) this.contents.set(path, this.clean(path, text));
  }

  get ref(): RepoRef {
    return this.analysis.ref;
  }

  allPaths(): string[] {
    return [...this.paths];
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  /** Files whose text is already in memory (scanned, or opened by the agent). */
  loadedPaths(): string[] {
    return [...this.contents.keys()];
  }

  isLoaded(path: string): boolean {
    return this.contents.has(path);
  }

  extraFetchesLeft(): number {
    return Math.max(0, this.maxExtraFiles - this.extraFetches);
  }

  /** The cleaned text of a file already in memory. Never fetches. */
  peek(path: string): string | undefined {
    return this.contents.get(path);
  }

  /** Resolves a path the model wrote ("./src/x.ts", "x.ts") to one in the repository. */
  resolve(candidate: string): string | undefined {
    const c = candidate.trim().replace(/^\.?\//, "").replace(/^\/+/, "");
    if (this.paths.has(c)) return c;
    const matches = [...this.paths].filter((p) => p.endsWith(`/${c}`));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Returns a file's cleaned text, downloading it once if the scan skipped it. */
  async read(path: string, signal: AbortSignal): Promise<{ text: string; fetched: boolean }> {
    const cached = this.contents.get(path);
    if (cached !== undefined) return { text: cached, fetched: false };
    if (!this.paths.has(path)) throw new Error(`No file at ${path} in this repository.`);
    if (!this.source) throw new Error(`${path} was not read by the scan, and this investigation cannot download more files.`);
    if (this.extraFetches >= this.maxExtraFiles) throw new Error(`The download budget (${this.maxExtraFiles} files beyond the scan) is spent; work with the files already open.`);
    this.extraFetches++;
    const raw = await this.source.getRawFile(this.analysis.ref, this.analysis.meta.sha, path, MAX_FILE_BYTES, signal);
    if (raw === null) throw new Error(`${path} could not be downloaded (too large, binary, or unreadable).`);
    const text = this.clean(path, raw);
    this.contents.set(path, text);
    return { text, fetched: true };
  }

  /** Records that lines start..end (1-based, inclusive) of a file were shown to the agent. */
  markSeen(path: string, start: number, end: number): void {
    const ranges = this.seen.get(path) ?? [];
    ranges.push([Math.max(1, start), Math.max(start, end)]);
    this.seen.set(path, ranges);
  }

  /** True when every cited line was inside something a tool showed the agent. */
  wasSeen(path: string, start: number, end: number): boolean {
    const ranges = this.seen.get(path);
    if (!ranges) return false;
    for (let line = start; line <= end; line++) if (!ranges.some(([a, b]) => line >= a && line <= b)) return false;
    return true;
  }

  seenFiles(): string[] {
    return [...this.seen.keys()];
  }

  /** Lines of a file that read like instructions to an AI, within start..end. */
  flaggedLines(path: string, start = 1, end = Number.MAX_SAFE_INTEGER): number[] {
    return (this.flagged.get(path) ?? []).filter((n) => n >= start && n <= end);
  }

  /** Files with flagged lines that a tool actually showed the agent. */
  flaggedSeen(): { path: string; lines: number[] }[] {
    return [...this.flagged.entries()].map(([path, lines]) => ({ path, lines: lines.filter((n) => this.wasSeen(path, n, n)) })).filter((f) => f.lines.length > 0);
  }

  private clean(path: string, raw: string): string {
    if (isLiveEnvFile(path)) return maskEnvFile(raw);
    const { text, redactions } = redactText(raw);
    this.redactions += redactions;
    const flagged = injectionLines(text);
    if (flagged.length) this.flagged.set(path, flagged);
    return text;
  }
}
