import type { MemoryEntry } from "@shared/agent";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_MEMORY_ENTRIES = 40;
const MAX_FILES = 40;
const MAX_FILE_CHARS = 60_000;

const README = `# Agent workspace

This is a private, in-memory workspace for the agent runs in this browser
session. Files written here survive between runs until the session expires,
and are never written to disk on the server.
`;

/**
 * State an agent keeps between steps and between runs: a key-value memory and
 * a small virtual filesystem. Both are real (the agent really reads back what
 * it wrote) and both live only in this process, keyed by the browser session.
 */
export class AgentSession {
  readonly memory = new Map<string, MemoryEntry>();
  readonly files = new Map<string, string>();
  touchedAt = Date.now();

  constructor(readonly id: string) {
    this.files.set("README.md", README);
  }

  touch(): void {
    this.touchedAt = Date.now();
  }

  memoryEntries(): MemoryEntry[] {
    return [...this.memory.values()].sort((a, b) => a.at - b.at);
  }

  remember(key: string, value: string): MemoryEntry {
    const entry: MemoryEntry = { key, value, at: Date.now() };
    this.memory.set(key, entry);
    if (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memoryEntries()[0];
      if (oldest) this.memory.delete(oldest.key);
    }
    return entry;
  }

  forget(key: string): boolean {
    return this.memory.delete(key);
  }

  fileNames(): string[] {
    return [...this.files.keys()].sort();
  }

  writeFile(path: string, content: string, append = false): { path: string; chars: number } {
    const clean = normalizePath(path);
    if (!this.files.has(clean) && this.files.size >= MAX_FILES) throw new Error(`The workspace holds at most ${MAX_FILES} files.`);
    const next = (append ? (this.files.get(clean) ?? "") : "") + content;
    if (next.length > MAX_FILE_CHARS) throw new Error(`Files are limited to ${MAX_FILE_CHARS.toLocaleString()} characters.`);
    this.files.set(clean, next);
    return { path: clean, chars: next.length };
  }

  readFile(path: string): string | undefined {
    return this.files.get(normalizePath(path));
  }

  deleteFile(path: string): boolean {
    return this.files.delete(normalizePath(path));
  }
}

/** Keeps paths flat and predictable: no directories, no traversal, no hidden files. */
export function normalizePath(path: string): string {
  const base = String(path).trim().split(/[\\/]/).filter(Boolean).pop() ?? "";
  const clean = base.replace(/[^\w.\- ]/g, "_").replace(/^\.+/, "");
  if (!clean) throw new Error("A file name is required.");
  return clean.slice(0, 80);
}

export class AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();

  get(id: string): AgentSession {
    this.sweep();
    let s = this.sessions.get(id);
    if (!s) {
      s = new AgentSession(id);
      this.sessions.set(id, s);
    }
    s.touch();
    return s;
  }

  private sweep(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of this.sessions) if (s.touchedAt < cutoff) this.sessions.delete(id);
  }
}
