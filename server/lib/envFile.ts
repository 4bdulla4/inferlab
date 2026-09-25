import fs from "node:fs";

/**
 * Updates KEY=value lines in a dotenv file in place (preserving comments and
 * order), appending keys that are not present yet. An empty value clears the key.
 */
export function updateEnvFile(path: string, updates: Record<string, string>): void {
  const existing = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
  // Drop the trailing newline's empty segment so appended keys do not leave a blank line.
  const lines = existing === "" ? [] : existing.replace(/\n$/, "").split("\n");
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!m || !(m[1]! in updates)) return line;
    seen.add(m[1]!);
    return `${m[1]}=${updates[m[1]!]}`;
  });
  for (const [key, value] of Object.entries(updates)) if (!seen.has(key)) out.push(`${key}=${value}`);
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
}
