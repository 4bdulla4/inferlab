import type { EnvCategory, EnvVar, Language } from "@shared/repo";

const PATTERNS: { langs: Language[] | "any"; re: RegExp }[] = [
  { langs: ["typescript", "javascript"], re: /process\.env\.([A-Z][A-Z0-9_]{1,})/g },
  { langs: ["typescript", "javascript"], re: /process\.env\[['"]([A-Z][A-Z0-9_]{1,})['"]\]/g },
  { langs: ["typescript", "javascript"], re: /import\.meta\.env\.([A-Z][A-Z0-9_]{1,})/g },
  { langs: ["typescript", "javascript"], re: /(?:Deno|Bun)\.env\.(?:get\()?['"]?([A-Z][A-Z0-9_]{1,})['"]?/g },
  { langs: ["python"], re: /os\.environ(?:\.get)?\s*[\[(]\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g },
  { langs: ["python"], re: /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g },
  { langs: ["python"], re: /\bconfig\(\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g },
  { langs: ["python"], re: /environ\[['"]([A-Z][A-Z0-9_]{1,})['"]\]/g },
  { langs: ["go"], re: /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{1,})"/g },
  { langs: ["ruby"], re: /ENV(?:\.fetch)?\s*[\[(]\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g },
  { langs: ["java", "kotlin"], re: /System\.getenv\(\s*"([A-Z][A-Z0-9_]{1,})"/g },
  { langs: ["java", "kotlin"], re: /@Value\(\s*"\$\{([A-Z][A-Z0-9_]{1,})/g },
  { langs: ["rust"], re: /env::var\(\s*"([A-Z][A-Z0-9_]{1,})"/g },
  { langs: ["php"], re: /(?:env|getenv)\(\s*['"]([A-Z][A-Z0-9_]{1,})['"]/g },
  { langs: ["php"], re: /\$_ENV\[['"]([A-Z][A-Z0-9_]{1,})['"]\]/g },
  { langs: ["csharp"], re: /Environment\.GetEnvironmentVariable\(\s*"([A-Z][A-Z0-9_]{1,})"/g },
  { langs: ["shell", "dockerfile", "yaml"], re: /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g },
];

const DECLARATION_FILES = /(^|\/)\.env(\.[\w.-]+)?$|(^|\/)env\.(example|sample|template)$/i;

export function categorizeEnv(name: string): EnvCategory {
  if (/(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|SIGNING|SALT|DSN|AUTH$)/.test(name)) return "secret";
  if (/(URL|URI|HOST|ENDPOINT|ORIGIN|DOMAIN|PORT|ADDRESS)/.test(name)) return "url";
  if (/(ENABLE|DISABLE|FLAG|DEBUG|MODE|FEATURE|VERBOSE|DRY_RUN)/.test(name)) return "flag";
  return "config";
}

const NOISE = new Set(["NODE_ENV", "PATH", "HOME", "PWD", "USER", "SHELL", "TERM", "CI", "TZ", "LANG", "TMPDIR", "GITHUB_WORKSPACE", "RUNNER_OS", "GITHUB_SHA", "GITHUB_REF", "GITHUB_ACTOR", "GITHUB_REPOSITORY", "GITHUB_EVENT_NAME", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_STEP_SUMMARY", "BASH_ENV"]);

export function detectEnvVars(files: { path: string; content: string; language: Language }[]): EnvVar[] {
  const map = new Map<string, EnvVar>();
  const ensure = (name: string) => {
    let v = map.get(name);
    if (!v) {
      v = { name, category: categorizeEnv(name), usages: [], declaredIn: [] };
      map.set(name, v);
    }
    return v;
  };

  for (const f of files) {
    const base = f.path.split("/").pop()!;
    if (DECLARATION_FILES.test(f.path) && !/\.(ts|js|py)$/.test(base)) {
      for (const line of f.content.split("\n")) {
        const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/.exec(line);
        if (m && !NOISE.has(m[1]!)) ensure(m[1]!).declaredIn.push(f.path);
      }
      continue;
    }
    for (const { langs, re } of PATTERNS) {
      if (langs !== "any" && !langs.includes(f.language)) continue;
      if (f.language === "yaml" && !/\.github\/workflows|docker-compose|compose\.ya?ml|render\.yaml|serverless/.test(f.path)) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = re.exec(f.content)) && count < 200) {
        const name = m[1]!;
        if (NOISE.has(name)) continue;
        if (f.language === "shell" || f.language === "yaml" || f.language === "dockerfile") {
          if (name.length < 4 || /^(ARG|RUN|CMD|ENV|FROM|COPY|ADD|EXPOSE|WORKDIR|USER|VOLUME|LABEL|ENTRYPOINT|SHELL|STOPSIGNAL|HEALTHCHECK|ONBUILD|MAINTAINER|HTTP|HTTPS|TRUE|FALSE|NULL|JSON|YAML|README|TODO|FIXME|NOTE|WARNING|ERROR|INFO|DEBUG|GET|POST|PUT|DELETE|PATCH|NPM|YARN|PNPM|UTF|SIGTERM)$/.test(name)) continue;
        }
        const v = ensure(name);
        const line = lineOf(f.content, m.index);
        if (!v.usages.some((u) => u.file === f.path && u.line === line)) v.usages.push({ file: f.path, line });
        count++;
      }
    }
  }

  return [...map.values()]
    .filter((v) => v.usages.length > 0 || v.declaredIn.length > 0)
    .sort((a, b) => b.usages.length - a.usages.length || a.name.localeCompare(b.name));
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
