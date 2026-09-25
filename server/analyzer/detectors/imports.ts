import type { ImportRef, Language } from "@shared/repo";

export interface ResolveContext {
  /** All repository paths (blobs), for existence checks. */
  paths: Set<string>;
  /** All directory prefixes in the tree. */
  dirs: Set<string>;
  /** Workspace package name → directory. */
  packageDirs: Record<string, string>;
  goModule?: string;
  /** tsconfig path aliases: "@/*" → ["./src/*"]. */
  aliases: Record<string, string[]>;
}

const JS_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

export function buildResolveContext(paths: string[], packageDirs: Record<string, string>, goModule: string | undefined, tsconfigs: Map<string, string>): ResolveContext {
  const set = new Set(paths);
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const aliases: Record<string, string[]> = {};
  for (const [file, content] of tsconfigs) {
    try {
      const json = JSON.parse(content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const baseDir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      const baseUrl = json.compilerOptions?.baseUrl ?? ".";
      for (const [alias, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        aliases[alias] = targets.map((t) => normalize(join(join(baseDir, baseUrl), t)));
      }
    } catch {
      /* ignore unparsable tsconfig */
    }
  }
  return { paths: set, dirs, packageDirs, goModule, aliases };
}

export function join(a: string, b: string): string {
  if (!a) return normalize(b);
  return normalize(`${a}/${b}`);
}

export function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function resolveJsPath(base: string, ctx: ResolveContext): string | undefined {
  for (const c of JS_CANDIDATES) {
    const candidate = base + c;
    if (ctx.paths.has(candidate)) return candidate;
  }
  // ESM-style ".js" imports pointing at ".ts" sources
  if (/\.jsx?$/.test(base)) {
    const stripped = base.replace(/\.jsx?$/, "");
    for (const c of [".ts", ".tsx"]) if (ctx.paths.has(stripped + c)) return stripped + c;
  }
  return undefined;
}

function resolveAlias(spec: string, ctx: ResolveContext): string | undefined {
  for (const [alias, targets] of Object.entries(ctx.aliases)) {
    const prefix = alias.replace(/\*$/, "");
    if (alias.endsWith("*") ? spec.startsWith(prefix) : spec === alias) {
      const rest = alias.endsWith("*") ? spec.slice(prefix.length) : "";
      for (const t of targets) {
        const r = resolveJsPath(normalize(t.replace(/\*$/, "") + rest), ctx);
        if (r) return r;
      }
    }
  }
  // Common conventions when tsconfig is absent/unparsed
  const m = /^(?:@|~|#|src)\/(.+)$/.exec(spec);
  if (m) {
    for (const root of ["src", "", "app", "lib", "client/src", "web/src", "frontend/src", "server/src", "apps/web", "apps/web/src", "packages/ui/src"]) {
      const r = resolveJsPath(join(root, m[1]!), ctx);
      if (r) return r;
    }
  }
  return undefined;
}

function resolveWorkspace(spec: string, ctx: ResolveContext): string | undefined {
  for (const [name, dir] of Object.entries(ctx.packageDirs)) {
    if (spec === name || spec.startsWith(`${name}/`)) {
      const rest = spec.slice(name.length).replace(/^\//, "");
      const bases = rest ? [join(dir, rest), join(join(dir, "src"), rest)] : [join(dir, "src/index"), join(dir, "index"), join(dir, "src/main"), join(dir, "src/index.ts")];
      for (const b of bases) {
        const r = resolveJsPath(b, ctx);
        if (r) return r;
      }
      return ctx.dirs.has(dir) ? dir : undefined;
    }
  }
  return undefined;
}

export function detectImports(path: string, content: string, lang: Language, ctx: ResolveContext): ImportRef[] {
  const out: ImportRef[] = [];
  const lines = content.split("\n");
  const dir = dirname(path);
  const push = (source: string, line: number, resolved: string | undefined, external: boolean) => {
    if (out.length >= 200) return;
    if (out.some((o) => o.source === source && o.line === line)) return;
    out.push({ source, line, resolved, external });
  };

  if (lang === "typescript" || lang === "javascript") {
    const re = /(?:import\s+(?:type\s+)?(?:[\w*\s{},$]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"\n]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[1]!;
      const line = lineOf(content, m.index);
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const resolved = resolveJsPath(spec.startsWith("/") ? spec.slice(1) : join(dir, spec), ctx);
        push(spec, line, resolved, false);
      } else {
        const aliased = resolveAlias(spec, ctx) ?? resolveWorkspace(spec, ctx);
        push(spec, line, aliased, aliased === undefined && !/^(?:@|~|#)\//.test(spec));
      }
    }
  } else if (lang === "python") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m = /^\s*from\s+(\.*)([\w.]*)\s+import\s+/.exec(line);
      if (m) {
        const dots = m[1]!.length;
        const mod = m[2]!;
        const resolved = resolvePython(dots, mod, dir, ctx);
        push(`${m[1]}${mod}`, i + 1, resolved, dots === 0 && resolved === undefined);
        continue;
      }
      m = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line);
      if (m) {
        for (const mod of m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!)) {
          const resolved = resolvePython(0, mod, dir, ctx);
          push(mod, i + 1, resolved, resolved === undefined);
        }
      }
    }
  } else if (lang === "go") {
    const block = /import\s*\(([\s\S]*?)\)/g;
    let m: RegExpExecArray | null;
    const specs: { spec: string; line: number }[] = [];
    while ((m = block.exec(content))) {
      const start = lineOf(content, m.index);
      m[1]!.split("\n").forEach((l, k) => {
        const s = /"([^"]+)"/.exec(l);
        if (s) specs.push({ spec: s[1]!, line: start + k });
      });
    }
    const single = /^import\s+(?:\w+\s+)?"([^"]+)"/gm;
    while ((m = single.exec(content))) specs.push({ spec: m[1]!, line: lineOf(content, m.index) });
    for (const { spec, line } of specs) {
      if (ctx.goModule && spec.startsWith(ctx.goModule)) {
        const rel = spec.slice(ctx.goModule.length).replace(/^\//, "");
        push(spec, line, ctx.dirs.has(rel) ? rel : undefined, false);
      } else push(spec, line, undefined, spec.includes("."));
    }
  } else if (lang === "rust") {
    const re = /^\s*(?:pub\s+)?(?:use|mod)\s+(crate::|super::|self::)?([\w:]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = `${m[1] ?? ""}${m[2]}`;
      const segs = m[2]!.split("::").filter((s) => s && s !== "*" && !/^\{/.test(s));
      let resolved: string | undefined;
      if (m[1] === "crate::" || (m[0].includes("mod ") && !m[1])) {
        const base = m[1] === "crate::" ? "src" : dir;
        for (const c of [join(base, segs.join("/")) + ".rs", join(base, segs.join("/")) + "/mod.rs", join(base, segs[0] ?? "") + ".rs"]) if (ctx.paths.has(c)) { resolved = c; break; }
      }
      push(spec, lineOf(content, m.index), resolved, !m[1] && !m[0].includes("mod ") && !ctx.paths.has(join("src", (segs[0] ?? "") + ".rs")));
    }
  } else if (lang === "java" || lang === "kotlin") {
    const re = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?;?/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[1]!;
      let resolved: string | undefined;
      const rel = spec.replace(/\./g, "/");
      for (const root of ["src/main/java", "src/main/kotlin", "src", "app/src/main/java", ""]) {
        for (const ext of [".java", ".kt"]) {
          const c = join(root, rel) + ext;
          if (ctx.paths.has(c)) { resolved = c; break; }
        }
        if (resolved) break;
      }
      push(spec, lineOf(content, m.index), resolved, resolved === undefined);
    }
  } else if (lang === "ruby") {
    const re = /^\s*require(_relative)?\s+['"]([^'"]+)['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[2]!;
      const base = m[1] ? join(dir, spec) : join("lib", spec);
      const resolved = ctx.paths.has(base + ".rb") ? base + ".rb" : undefined;
      push(spec, lineOf(content, m.index), resolved, !m[1] && resolved === undefined);
    }
  } else if (lang === "php") {
    const re = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?;/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[1]!;
      const rel = spec.replace(/^App\\/, "app/").replace(/^Database\\/, "database/").replace(/\\/g, "/");
      const resolved = ctx.paths.has(rel + ".php") ? rel + ".php" : undefined;
      push(spec, lineOf(content, m.index), resolved, resolved === undefined && !spec.startsWith("App\\"));
    }
  }
  return out;
}

function resolvePython(dots: number, mod: string, dir: string, ctx: ResolveContext): string | undefined {
  const rel = mod.replace(/\./g, "/");
  const bases: string[] = [];
  if (dots > 0) {
    let d = dir;
    for (let i = 1; i < dots; i++) d = dirname(d);
    bases.push(join(d, rel));
  } else {
    for (const root of ["", "src", "app", "backend", "server", "api", "apps", "services"]) bases.push(join(root, rel));
  }
  for (const b of bases) {
    if (!b) continue;
    if (ctx.paths.has(b + ".py")) return b + ".py";
    if (ctx.paths.has(b + "/__init__.py")) return b + "/__init__.py";
    if (ctx.dirs.has(b)) return b;
  }
  return undefined;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
