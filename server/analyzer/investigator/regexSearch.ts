import { Worker } from "node:worker_threads";

export interface RegexSearchInput {
  source: string;
  flags: string;
  files: [path: string, text: string][];
  maxHits: number;
  /** Characters of hit text the result may hold before hits stop being collected. */
  budget: number;
  maxLineChars: number;
}

export interface RegexSearchOutput {
  total: number;
  hits: { file: string; line: number; text: string }[];
}

/**
 * The search runs in a worker because a regular expression can backtrack for
 * minutes on one line, and the pattern comes from a model that has been reading
 * files an attacker may have written. The main thread cannot interrupt a regex,
 * so the worker is terminated when the time limit passes.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { source, flags, files, maxHits, budget, maxLineChars } = workerData;
const re = new RegExp(source, flags);
const hits = [];
let total = 0;
let used = 0;
for (const [path, text] of files) {
  const lines = text.split("\\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].slice(0, maxLineChars);
    if (!re.test(line)) continue;
    total++;
    const hit = line.trim().slice(0, 200);
    if (hits.length < maxHits && used + path.length + hit.length + 12 <= budget) {
      hits.push({ file: path, line: i + 1, text: hit });
      used += path.length + hit.length + 12;
    }
  }
}
parentPort.postMessage({ total, hits });
`;

const STARTUP_LIMIT_MS = 15_000;

export class RegexTimeoutError extends Error {
  constructor(ms: number) {
    super(`The pattern was still running after ${ms} ms and was stopped. Simplify it, or search for a literal word instead.`);
    this.name = "RegexTimeoutError";
  }
}

export function runRegexSearch(input: RegexSearchInput, timeoutMs: number, signal?: AbortSignal): Promise<RegexSearchOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: input, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      fn();
    };
    // The limit is on the search, not on starting a thread, which a busy machine can make slow;
    // startup gets its own, more generous allowance.
    let timer = setTimeout(() => finish(() => reject(new Error("The search worker did not start in time; try again."))), STARTUP_LIMIT_MS);
    worker.once("online", () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(() => reject(new RegexTimeoutError(timeoutMs))), timeoutMs);
    });
    const onAbort = () => finish(() => reject(new DOMException("aborted", "AbortError")));
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (out: RegexSearchOutput) => finish(() => resolve(out)));
    worker.once("error", (err) => finish(() => reject(err)));
    worker.once("exit", (code) => finish(() => reject(new Error(`The search worker exited unexpectedly (code ${code}).`))));
  });
}
