import vm from "node:vm";

export interface CodeRunResult {
  stdout: string;
  result: string | null;
  error: string | null;
  ms: number;
}

const TIMEOUT_MS = 2000;
const MAX_OUTPUT = 4000;

/**
 * Runs a JavaScript snippet in a fresh V8 context with only a console and the
 * standard built-ins. There is no `require`, no `process` and no network. The
 * context is a real execution environment, not a security boundary: this lab
 * runs on the operator's own machine.
 */
export function runJavaScript(code: string): CodeRunResult {
  const lines: string[] = [];
  const write = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "));
    if (lines.join("\n").length > MAX_OUTPUT) throw new Error(`Output exceeded ${MAX_OUTPUT} characters.`);
  };
  const sandbox = {
    console: { log: write, info: write, warn: write, error: write },
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Date,
    Map,
    Set,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const started = Date.now();
  try {
    const value = vm.runInContext(code, context, { timeout: TIMEOUT_MS, displayErrors: true, filename: "agent-snippet.js" });
    return { stdout: lines.join("\n"), result: value === undefined ? null : safeStringify(value).slice(0, 1000), error: null, ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { stdout: lines.join("\n"), result: null, error: /Script execution timed out/.test(message) ? `Timed out after ${TIMEOUT_MS} ms.` : message, ms: Date.now() - started };
  }
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
    const s = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}
