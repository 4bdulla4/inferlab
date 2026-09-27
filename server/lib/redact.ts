/**
 * Credential patterns shared by every analyzer that shows source code to a
 * person or a model. Redaction is code, not an instruction: a secret committed
 * to a repository never leaves this process, whatever the prompt says.
 */
export const SECRET_PATTERNS: { re: RegExp; title: string }[] = [
  { re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/, title: "API key literal (OpenAI/Anthropic-style)" },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/, title: "Google API key literal" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, title: "AWS access key id literal" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, title: "GitHub token literal" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, title: "Slack token literal" },
  { re: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{20,}["']/i, title: "Hardcoded credential assignment" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, title: "Private key block" },
];

const GLOBAL = SECRET_PATTERNS.map((s) => new RegExp(s.re.source, s.re.flags.includes("g") ? s.re.flags : `${s.re.flags}g`));

/** Replaces credential literals in one line, keeping an assignment's shape readable. */
export function redactLine(line: string): string {
  let out = line;
  for (const re of GLOBAL) out = out.replace(re, (m) => (m.includes("=") || m.includes(":") ? m.replace(/["'][^"']+["']/, '"<REDACTED>"') : "<REDACTED>"));
  return out;
}

/** Redacts a whole file and reports how many lines were changed. */
export function redactText(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const lines = text.split("\n").map((l) => {
    const r = redactLine(l);
    if (r !== l) redactions++;
    return r;
  });
  return { text: lines.join("\n"), redactions };
}

/** `.env`, `.env.local`, `.env.production`… but not the committed templates. */
export function isLiveEnvFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return /^\.env(\..+)?$/i.test(base) && !/^\.env\.(example|sample|template|dist|defaults?)$/i.test(base);
}

/** Keeps the variable names of an env file and drops every value. */
export function maskEnvFile(text: string): string {
  return text
    .split("\n")
    .map((l) => {
      const m = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
      if (m) return `${m[1] ?? ""}${m[2]}=<REDACTED>`;
      return /^\s*#/.test(l) || !l.trim() ? l : "<REDACTED>";
    })
    .join("\n");
}
