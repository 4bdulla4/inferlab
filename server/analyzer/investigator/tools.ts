import type { AgentToolDescriptor, ToolInputSchema, ToolResult } from "@shared/agent";
import { AGENT_LIMITS } from "../../../shared/agent";
import { INVESTIGATION_LIMITS } from "../../../shared/repo";
import { numberArg, stringArg, truncateContent } from "../../agent/tools/shared";
import { ToolExecutionError, type ToolImpl } from "../../agent/types";
import type { RepoWorkspace } from "./workspace";

/**
 * The investigator's tools. Each one reads the repository, or the scanner's
 * facts about it, through the workspace; none runs the repository's code.
 * Their results are live: they are what the files really contain at the
 * analysed commit, with secrets already redacted.
 */

const schema = (properties: ToolInputSchema["properties"], required: string[] = []): ToolInputSchema => ({ type: "object", properties, required });

const LIVE_NOTE = "Live: read from the repository at the analysed commit. Secrets are redacted and .env values removed before the agent sees anything.";
const FACTS_NOTE = "Live: the static scan's deterministic facts about this repository, each with the file and line it came from.";

const FACT_KINDS = ["modules", "edges", "routes", "schema", "jobs", "integrations", "env", "infra", "dependencies"] as const;
type FactKind = (typeof FACT_KINDS)[number];

const MAX_LINE_CHARS = 400;
/**
 * Results are sized to fit under the tool-result cap before anything is marked
 * seen, so a line the cap would have cut can never count as evidence.
 */
const BODY_BUDGET = AGENT_LIMITS.maxToolResultChars - 500;
/** Nested quantifiers such as (a+)+ can backtrack for minutes on one line. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

const ok = (content: string, note: string, data?: unknown, latencyMs = 0): ToolResult => {
  const { text, truncated } = truncateContent(content);
  return { ok: true, content: text, data, source: "live", latencyMs, note, truncated };
};

function descriptor(d: Omit<AgentToolDescriptor, "available" | "sideEffects" | "source" | "id"> & { source?: AgentToolDescriptor["source"] }): AgentToolDescriptor {
  return { id: d.name, available: true, sideEffects: false, source: "live", ...d };
}

/** Compiles the model's pattern safely: literal by default, bounded regex when asked. */
export function compileSearch(pattern: string, isRegex: boolean): RegExp {
  const p = pattern.trim();
  if (!p) throw new ToolExecutionError("An empty pattern matches everything; search for a word, name or phrase.", "live", false);
  if (p.length > 200) throw new ToolExecutionError("Patterns are limited to 200 characters.", "live", false);
  if (!isRegex) return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (NESTED_QUANTIFIER.test(p)) throw new ToolExecutionError("Nested quantifiers like (a+)+ are refused because they can hang the search. Simplify the pattern.", "live", false);
  try {
    return new RegExp(p, "i");
  } catch (err) {
    throw new ToolExecutionError(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`, "live", false);
  }
}

export function buildInvestigatorTools(ws: RepoWorkspace): ToolImpl[] {
  const a = ws.analysis;

  const listFiles: ToolImpl = {
    descriptor: descriptor({
      name: "list_files",
      description: "List repository paths under a folder or matching a name fragment. Shows each file's size and whether its text is already loaded (search_code only searches loaded files; read_file opens any file). Use it to find where something lives.",
      category: "files",
      inputSchema: schema({
        path_prefix: { type: "string", description: "Folder to list, e.g. 'src/api/'. Empty for the whole repository." },
        name_contains: { type: "string", description: "Optional fragment the path must contain, case-insensitive, e.g. 'auth'." },
        limit: { type: "integer", description: "Maximum paths to return, 1–120. Default 60." },
      }),
      sourceNote: LIVE_NOTE,
    }),
    async execute(args) {
      const prefix = stringArg(args, "path_prefix").trim().replace(/^\.?\//, "");
      const frag = stringArg(args, "name_contains").trim().toLowerCase();
      const limit = Math.min(120, Math.max(1, Math.round(numberArg(args, "limit", 60))));
      const bySize = new Map(a.files.map((f) => [f.path, f.size]));
      const matches = ws.allPaths().filter((p) => p.startsWith(prefix) && (!frag || p.toLowerCase().includes(frag))).sort();
      const shown: string[] = [];
      let used = 0;
      for (const p of matches.slice(0, limit)) {
        if (used + p.length + 24 > BODY_BUDGET) break;
        shown.push(p);
        used += p.length + 24;
      }
      const lines = shown.map((p) => `${p}  (${formatBytes(bySize.get(p) ?? 0)}${ws.isLoaded(p) ? ", loaded" : ""})`);
      const head = `${matches.length} path${matches.length === 1 ? "" : "s"}${prefix ? ` under ${prefix}` : ""}${frag ? ` containing "${frag}"` : ""}${matches.length > shown.length ? `; first ${shown.length} shown` : ""}. ${ws.extraFetchesLeft()} more files can be downloaded with read_file.`;
      return ok([head, ...lines].join("\n"), `${matches.length} matching paths`, { total: matches.length, shown: shown.length });
    },
  };

  const searchCode: ToolImpl = {
    descriptor: descriptor({
      name: "search_code",
      description: "Search the text of loaded files (the ones the scan read plus any you opened) for a word, identifier or phrase. Returns path:line and the matching line. Literal and case-insensitive unless is_regex is true.",
      category: "files",
      inputSchema: schema(
        {
          pattern: { type: "string", description: "Text to find, e.g. 'signIn' or 'stripe.webhooks'." },
          is_regex: { type: "boolean", description: "Treat the pattern as a regular expression. Default false." },
          path_prefix: { type: "string", description: "Only search under this folder." },
          max_results: { type: "integer", description: `Maximum matching lines, 1–${INVESTIGATION_LIMITS.maxSearchResults}. Default 25.` },
        },
        ["pattern"],
      ),
      sourceNote: LIVE_NOTE,
    }),
    async execute(args) {
      const started = Date.now();
      const re = compileSearch(stringArg(args, "pattern"), args.is_regex === true || args.is_regex === "true");
      const prefix = stringArg(args, "path_prefix").trim().replace(/^\.?\//, "");
      const max = Math.min(INVESTIGATION_LIMITS.maxSearchResults, Math.max(1, Math.round(numberArg(args, "max_results", 25))));
      const hits: { file: string; line: number; text: string }[] = [];
      let total = 0;
      let used = 0;
      const files = ws.loadedPaths().filter((p) => p.startsWith(prefix)).sort();
      for (const path of files) {
        const lines = ws.peek(path)!.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!.slice(0, MAX_LINE_CHARS);
          if (!re.test(line)) continue;
          total++;
          const text = line.trim().slice(0, 200);
          if (hits.length < max && used + path.length + text.length + 12 <= BODY_BUDGET) {
            hits.push({ file: path, line: i + 1, text });
            used += path.length + text.length + 12;
            ws.markSeen(path, i + 1, i + 1);
          }
        }
      }
      const unloaded = ws.allPaths().length - ws.loadedPaths().length;
      const head = `${total} matching line${total === 1 ? "" : "s"} in ${files.length} loaded files${total > hits.length ? `; first ${hits.length} shown` : ""}.${unloaded ? ` ${unloaded} files are not loaded and were not searched; open one with read_file to include it.` : ""}`;
      return ok([head, ...hits.map((h) => `${h.file}:${h.line}: ${h.text}`)].join("\n"), `${total} matches across ${files.length} files`, { total, hits }, Date.now() - started);
    },
  };

  const readFile: ToolImpl = {
    descriptor: descriptor({
      name: "read_file",
      description: `Read lines of a repository file, numbered. Downloads the file if the scan did not load it. Up to ${INVESTIGATION_LIMITS.maxReadLines} lines per call; read the part you need, e.g. around a search hit or a symbol's line.`,
      category: "files",
      inputSchema: schema(
        {
          path: { type: "string", description: "Repository path exactly as listed, e.g. 'src/server/auth.ts'." },
          start_line: { type: "integer", description: "First line to return, 1-based. Default 1." },
          end_line: { type: "integer", description: `Last line to return. Default start_line + ${INVESTIGATION_LIMITS.maxReadLines - 1}.` },
        },
        ["path"],
      ),
      sourceNote: LIVE_NOTE,
    }),
    async execute(args, ctx) {
      const started = Date.now();
      const asked = stringArg(args, "path");
      const path = ws.resolve(asked);
      if (!path) {
        const near = ws.allPaths().filter((p) => p.toLowerCase().includes((asked.split("/").pop() ?? asked).toLowerCase())).slice(0, 8);
        throw new ToolExecutionError(`No file at "${asked}".${near.length ? ` Similar paths: ${near.join(", ")}` : " Use list_files to find it."}`, "live", false);
      }
      let text: string;
      let fetched: boolean;
      try {
        ({ text, fetched } = await ws.read(path, ctx.signal));
      } catch (err) {
        throw new ToolExecutionError(err instanceof Error ? err.message : String(err), "live", false);
      }
      const lines = text.split("\n");
      const start = Math.min(lines.length, Math.max(1, Math.round(numberArg(args, "start_line", 1))));
      const askedEnd = Math.min(lines.length, Math.max(start, Math.round(numberArg(args, "end_line", start + INVESTIGATION_LIMITS.maxReadLines - 1))), start + INVESTIGATION_LIMITS.maxReadLines - 1);
      const width = String(askedEnd).length;
      const body: string[] = [];
      let used = 0;
      let end = start - 1;
      for (let n = start; n <= askedEnd; n++) {
        const row = `${String(n).padStart(width)}  ${lines[n - 1]!.slice(0, MAX_LINE_CHARS)}`;
        if (body.length > 0 && used + row.length + 1 > BODY_BUDGET) break;
        body.push(row);
        used += row.length + 1;
        end = n;
      }
      ws.markSeen(path, start, end);
      const head = `${path} · lines ${start}–${end} of ${lines.length}${fetched ? " · downloaded now" : ""}${end < lines.length ? ` · continue with start_line ${end + 1}` : ""}`;
      return ok([head, ...body].join("\n"), fetched ? `Downloaded and read ${path}` : `Read ${path}`, { path, start, end, lines: lines.length, fetched }, Date.now() - started);
    },
  };

  const findSymbol: ToolImpl = {
    descriptor: descriptor({
      name: "find_symbol",
      description: "Find where a function, class, component or constant is defined (from the scan's symbol index) and where loaded files reference it, plus which files import the defining file. Use it to follow a call from one module to the next.",
      category: "files",
      inputSchema: schema({ name: { type: "string", description: "Identifier, e.g. 'createSession' or 'AuthProvider'." } }, ["name"]),
      sourceNote: LIVE_NOTE,
    }),
    async execute(args) {
      const started = Date.now();
      const name = stringArg(args, "name").trim().replace(/\(\)$/, "");
      if (!/^[\w$.]{1,120}$/.test(name)) throw new ToolExecutionError("Give a single identifier such as handleLogin or UserService.", "live", false);
      const last = name.split(".").pop()!;
      const defs = a.files.flatMap((f) => f.symbols.filter((s) => s.name === last).map((s) => ({ file: f.path, line: s.line, kind: s.kind, signature: s.signature, importedBy: f.importedBy })));
      const loose = defs.length ? [] : a.files.flatMap((f) => f.symbols.filter((s) => s.name.toLowerCase() === last.toLowerCase()).map((s) => ({ file: f.path, line: s.line, kind: s.kind, signature: s.signature, importedBy: f.importedBy })));
      const found = (defs.length ? defs : loose).slice(0, 10);
      for (const d of found) ws.markSeen(d.file, d.line, d.line);
      let used = found.length * 240;
      const defKeys = new Set(found.map((d) => `${d.file}:${d.line}`));
      const word = new RegExp(`\\b${last.replace(/[$]/g, "\\$")}\\b`);
      const refs: string[] = [];
      let refTotal = 0;
      for (const path of ws.loadedPaths().sort()) {
        const lines = ws.peek(path)!.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (defKeys.has(`${path}:${i + 1}`) || !word.test(lines[i]!.slice(0, MAX_LINE_CHARS))) continue;
          refTotal++;
          const row = `${path}:${i + 1}: ${lines[i]!.trim().slice(0, 160)}`;
          if (refs.length < 25 && used + row.length + 1 <= BODY_BUDGET) {
            refs.push(row);
            used += row.length + 1;
            ws.markSeen(path, i + 1, i + 1);
          }
        }
      }
      const out: string[] = [];
      if (found.length === 0) out.push(`No definition of "${last}" in the scan's symbol index. It may live in a file the scan did not load, or be defined in a way the scanner does not index.`);
      else {
        out.push(`${found.length} definition${found.length === 1 ? "" : "s"}${defs.length ? "" : " (case-insensitive match)"}:`);
        for (const d of found) out.push(`${d.file}:${d.line}  ${d.kind}${d.signature ? `  ${d.signature.slice(0, 160)}` : ""}${d.importedBy.length ? `  · imported by ${d.importedBy.slice(0, 6).join(", ")}${d.importedBy.length > 6 ? ` +${d.importedBy.length - 6}` : ""}` : ""}`);
      }
      out.push("", `${refTotal} reference line${refTotal === 1 ? "" : "s"} in loaded files${refTotal > refs.length ? `; first ${refs.length} shown` : ""}:`, ...refs);
      return ok(out.join("\n"), `${found.length} definitions · ${refTotal} references`, { definitions: found.length, references: refTotal }, Date.now() - started);
    },
  };

  const getFacts: ToolImpl = {
    descriptor: descriptor({
      name: "get_facts",
      description: "Look up the static scan's facts about this repository: modules, edges between them, API routes, database schema, background jobs, integrations, environment variable names, deployment config, or dependencies. Filter narrows to entries mentioning a word.",
      category: "data",
      inputSchema: schema(
        {
          kind: { type: "string", description: "Which facts to return.", enum: [...FACT_KINDS] },
          filter: { type: "string", description: "Optional word the entry must mention, e.g. 'auth', 'stripe', '/api/chat'." },
        },
        ["kind"],
      ),
      sourceNote: FACTS_NOTE,
    }),
    async execute(args) {
      const kind = stringArg(args, "kind") as FactKind;
      if (!FACT_KINDS.includes(kind)) throw new ToolExecutionError(`kind must be one of ${FACT_KINDS.join(", ")}.`, "live", false);
      const filter = stringArg(args, "filter").trim().toLowerCase();
      const rows = factRows(ws, kind);
      const kept = filter ? rows.filter((r) => r.text.toLowerCase().includes(filter)) : rows;
      const shown: string[] = [];
      let used = 0;
      for (const r of kept) {
        const row = `- ${r.text.slice(0, 400)}`;
        if (shown.length >= 80 || used + row.length + 1 > BODY_BUDGET) break;
        shown.push(row);
        used += row.length + 1;
        // A fact row cites its line, not the code on it, so it only counts as having seen that one line.
        if (r.file && r.line) ws.markSeen(r.file, r.line, r.line);
      }
      const head = `${kept.length} ${kind}${filter ? ` mentioning "${filter}"` : ""}${kept.length > shown.length ? `; first ${shown.length} shown, narrow with filter` : ""}.`;
      return ok([head, ...shown].join("\n"), `${kept.length} ${kind} from the scan`, { kind, total: kept.length });
    },
  };

  return [getFacts, searchCode, findSymbol, readFile, listFiles];
}

function factRows(ws: RepoWorkspace, kind: FactKind): { text: string; file?: string; line?: number }[] {
  const a = ws.analysis;
  switch (kind) {
    case "modules":
      return a.graph.nodes.map((n) => ({ text: `${n.id} · ${n.label} [${n.category}] · ${n.summary} · files: ${n.files.slice(0, 8).join(", ")}${n.files.length > 8 ? ` +${n.files.length - 8}` : ""}` }));
    case "edges":
      return a.graph.edges.map((e) => ({ text: `${e.from} → ${e.to} (${e.kind}) ${e.label}${e.evidence.file ? ` · ${e.evidence.file}:${e.evidence.line ?? ""}` : ""}`, file: e.evidence.file, line: e.evidence.line }));
    case "routes":
      return a.routes.map((r) => ({ text: `${r.method} ${r.path} · ${r.file}:${r.line}${r.handler ? ` · handler ${r.handler}` : ""} · ${r.kind} (${r.framework})`, file: r.file, line: r.line }));
    case "schema":
      return a.schema.map((s) => ({ text: `${s.name} (${s.kind}) · ${s.file}:${s.line} · fields ${s.fields.slice(0, 16).join(", ")}`, file: s.file, line: s.line }));
    case "jobs":
      return a.jobs.map((j) => ({ text: `${j.kind} ${j.name}${j.schedule ? ` [${j.schedule}]` : ""} · ${j.file}:${j.line} (${j.library})`, file: j.file, line: j.line }));
    case "integrations":
      return a.integrations.map((i) => ({ text: `${i.name} [${i.category}] · deps ${i.dependencies.slice(0, 4).join(", ") || "-"} · files ${i.files.slice(0, 6).join(", ") || "-"}${i.envVars.length ? ` · env ${i.envVars.slice(0, 6).join(", ")}` : ""}` }));
    case "env":
      // Names and where they are read, never values.
      return a.envVars.map((v) => ({ text: `${v.name} (${v.category}) · read at ${v.usages.slice(0, 4).map((u) => `${u.file}:${u.line}`).join(", ") || "-"}${v.declaredIn.length ? ` · declared in ${v.declaredIn.join(", ")}` : ""}`, file: v.usages[0]?.file, line: v.usages[0]?.line }));
    case "infra":
      return a.infra.map((c) => ({ text: `${c.kind} · ${c.file} · ${c.summary}` }));
    case "dependencies":
      return a.dependencies.map((d) => ({ text: `${d.name}${d.version ? `@${d.version}` : ""} (${d.ecosystem}${d.dev ? ", dev" : ""}) · ${d.manifest}` }));
  }
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`;
}
