import type { Dependency } from "@shared/repo";

export interface ManifestFacts {
  dependencies: Dependency[];
  /** package.json "scripts" and similar, for deploy/worker hints. */
  scripts: { manifest: string; name: string; command: string }[];
  /** Workspace package name → directory (monorepos). */
  packageDirs: Record<string, string>;
  goModule?: string;
  projectNames: string[];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function parseManifests(files: Map<string, string>): ManifestFacts {
  const deps: Dependency[] = [];
  const scripts: ManifestFacts["scripts"] = [];
  const packageDirs: Record<string, string> = {};
  const projectNames: string[] = [];
  let goModule: string | undefined;

  const push = (name: string, manifest: string, ecosystem: Dependency["ecosystem"], dev = false, version?: string) => {
    const n = name.trim();
    if (!n) return;
    deps.push({ name: n, manifest, ecosystem, dev, version });
  };

  for (const [path, content] of files) {
    const base = path.split("/").pop()!;
    try {
      if (base === "package.json") {
        const json = JSON.parse(content) as Record<string, unknown>;
        const name = typeof json.name === "string" ? json.name : undefined;
        if (name) {
          packageDirs[name] = dirOf(path);
          projectNames.push(name);
        }
        for (const [field, dev] of [["dependencies", false], ["devDependencies", true], ["peerDependencies", false], ["optionalDependencies", false]] as const) {
          const obj = json[field];
          if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj as Record<string, string>)) push(k, path, "npm", dev, String(v));
        }
        if (json.scripts && typeof json.scripts === "object") {
          for (const [k, v] of Object.entries(json.scripts as Record<string, string>)) scripts.push({ manifest: path, name: k, command: String(v) });
        }
      } else if (/^requirements[\w.-]*\.txt$/.test(base)) {
        for (const line of content.split("\n")) {
          const l = line.trim();
          if (!l || l.startsWith("#") || l.startsWith("-")) continue;
          const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(l);
          if (m) push(m[1]!.toLowerCase(), path, "pypi", /dev|test/i.test(base));
        }
      } else if (base === "pyproject.toml") {
        parseToml(content, (section, key, value) => {
          if (section === "project" && key === "dependencies") for (const d of listItems(value)) push(pyName(d), path, "pypi");
          else if (section.startsWith("project.optional-dependencies")) for (const d of listItems(value)) push(pyName(d), path, "pypi", true);
          else if (section === "tool.poetry.dependencies" && key !== "python") push(key.toLowerCase(), path, "pypi");
          else if (/^tool\.poetry\.(dev-dependencies|group\.\w+\.dependencies)$/.test(section)) push(key.toLowerCase(), path, "pypi", true);
          else if (section === "project" && key === "name") projectNames.push(value.replace(/["']/g, ""));
        });
      } else if (base === "Pipfile") {
        parseToml(content, (section, key) => {
          if (section === "packages") push(key.toLowerCase(), path, "pypi");
          if (section === "dev-packages") push(key.toLowerCase(), path, "pypi", true);
        });
      } else if (base === "go.mod") {
        const mod = /^module\s+(\S+)/m.exec(content);
        if (mod) goModule = mod[1];
        const block = /require\s*\(([\s\S]*?)\)/g;
        let m: RegExpExecArray | null;
        while ((m = block.exec(content))) {
          for (const line of m[1]!.split("\n")) {
            const r = /^\s*(\S+)\s+(v\S+)/.exec(line);
            if (r) push(r[1]!, path, "go", /\/\/\s*indirect/.test(line), r[2]);
          }
        }
        const single = /^require\s+(\S+)\s+(v\S+)/gm;
        while ((m = single.exec(content))) push(m[1]!, path, "go", false, m[2]);
      } else if (base === "Cargo.toml") {
        parseToml(content, (section, key, value) => {
          if (section === "dependencies") push(key, path, "cargo", false, value.replace(/["']/g, "").slice(0, 20));
          if (section === "dev-dependencies" || section === "build-dependencies") push(key, path, "cargo", true);
          if (section === "package" && key === "name") projectNames.push(value.replace(/["']/g, ""));
        });
      } else if (base === "Gemfile") {
        const re = /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content))) push(m[1]!, path, "rubygems", false, m[2]);
      } else if (base === "composer.json") {
        const json = JSON.parse(content) as Record<string, unknown>;
        for (const [field, dev] of [["require", false], ["require-dev", true]] as const) {
          const obj = json[field];
          if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj as Record<string, string>)) if (k !== "php" && !k.startsWith("ext-")) push(k, path, "composer", dev, v);
        }
      } else if (base === "pom.xml") {
        const re = /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content))) push(`${m[1]!.trim()}:${m[2]!.trim()}`, path, "maven", /<scope>test<\/scope>/.test(m[0]));
      } else if (/^build\.gradle(\.kts)?$/.test(base)) {
        const re = /(implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content))) push(m[2]!.split(":").slice(0, 2).join(":"), path, "maven", m[1] === "testImplementation");
      } else if (base === "pubspec.yaml") {
        let section = "";
        for (const line of content.split("\n")) {
          const h = /^(\w[\w_]*):\s*$/.exec(line);
          if (h) { section = h[1]!; continue; }
          const d = /^  ([a-z_][\w]*):/.exec(line);
          if (d && (section === "dependencies" || section === "dev_dependencies")) push(d[1]!, path, "other", section === "dev_dependencies");
        }
      }
    } catch {
      /* malformed manifest: skip silently, the file still appears in the tree */
    }
  }

  // De-duplicate by (name, manifest)
  const seen = new Set<string>();
  const unique = deps.filter((d) => {
    const k = `${d.manifest}::${d.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { dependencies: unique, scripts, packageDirs, goModule, projectNames };
}

function pyName(spec: string): string {
  return (/^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec.trim())?.[1] ?? spec).toLowerCase();
}

function listItems(value: string): string[] {
  const inner = value.replace(/^\[/, "").replace(/\]$/, "");
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Minimal TOML walker: reports (section, key, rawValue) for top-level key/value lines. */
function parseToml(content: string, onEntry: (section: string, key: string, value: string) => void): void {
  let section = "";
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const h = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (h) { section = h[1]!.trim(); continue; }
    const kv = /^("?[\w.-]+"?)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2]!;
    // multi-line arrays
    if (value.startsWith("[") && !value.includes("]")) {
      while (i + 1 < lines.length && !value.includes("]")) value += lines[++i]!.trim();
    }
    onEntry(section, kv[1]!.replace(/"/g, ""), value);
  }
}
