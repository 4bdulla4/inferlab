import type { TreeEntry } from "./github";
import { languageFor, isCodeLanguage } from "./language";

export const LIMITS = {
  maxFiles: 260,
  maxFileBytes: 200_000,
  maxTotalBytes: 7_000_000,
  concurrency: 8,
};

const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.turbo|\.cache|coverage|vendor|target|bin|obj|__pycache__|\.venv|venv|env|\.git|\.idea|\.vscode|storybook-static|public\/assets|static\/vendor|third_party|generated|\.yarn|\.pnpm)(\/|$)/;
const IGNORED_FILES = /(\.min\.(js|css)|\.(png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|mp4|mp3|wav|pdf|zip|gz|tar|jar|class|pyc|so|dylib|dll|exe|bin|lock|lockb|snap|map|ipynb|csv|parquet|db|sqlite))$/i;
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "poetry.lock", "Pipfile.lock", "Cargo.lock", "Gemfile.lock", "composer.lock", "go.sum"]);

const MANIFESTS = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "Pipfile", "setup.py", "setup.cfg", "go.mod", "Cargo.toml",
  "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json", "pubspec.yaml", "mix.exs",
]);

const INFRA_NAMES = /^(Dockerfile(\..*)?|docker-compose(\..*)?\.ya?ml|compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|serverless\.ya?ml|railway\.(json|toml)|app\.yaml|nixpacks\.toml|wrangler\.toml|firebase\.json|amplify\.yml|skaffold\.yaml|Makefile|turbo\.json|nx\.json|lerna\.json)$/i;
const CONFIG_NAMES = /^(\.env(\..*)?|tsconfig(\..*)?\.json|next\.config\.(js|mjs|ts)|vite\.config\.(js|ts|mjs)|nuxt\.config\.(js|ts)|svelte\.config\.js|astro\.config\.(mjs|ts)|remix\.config\.js|tailwind\.config\.(js|ts|cjs)|webpack\.config\.(js|ts)|babel\.config\.js|\.babelrc|angular\.json|schema\.prisma|drizzle\.config\.ts|knexfile\.(js|ts)|alembic\.ini|manage\.py|settings\.py|urls\.py|wsgi\.py|asgi\.py|celery\.py|routes\.rb|config\.ru|schema\.rb|main\.go|main\.py|app\.py|server\.py|index\.(js|ts)|server\.(js|ts)|app\.(js|ts)|main\.(ts|tsx|js|jsx)|README\.md)$/i;

export interface Selection {
  chosen: TreeEntry[];
  skipped: number;
  total: number;
}

/**
 * Picks which blobs to download. Manifests, infra and config files first, then
 * source files ordered by how "central" their path looks, within a byte budget.
 */
export function selectFiles(entries: TreeEntry[], limits = LIMITS): Selection {
  const blobs = entries.filter((e) => e.type === "blob");
  const candidates = blobs.filter((e) => {
    if (IGNORED_DIRS.test(e.path)) return false;
    if (IGNORED_FILES.test(e.path)) return false;
    const base = e.path.split("/").pop()!;
    if (LOCKFILES.has(base)) return false;
    if ((e.size ?? 0) > limits.maxFileBytes) return false;
    return true;
  });

  const scored = candidates.map((e) => ({ e, score: scoreFile(e) })).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.e.size ?? 0) - (b.e.size ?? 0));

  const chosen: TreeEntry[] = [];
  let bytes = 0;
  for (const { e } of scored) {
    if (chosen.length >= limits.maxFiles) break;
    const size = e.size ?? 0;
    if (bytes + size > limits.maxTotalBytes) continue;
    chosen.push(e);
    bytes += size;
  }
  return { chosen, skipped: blobs.length - chosen.length, total: blobs.length };
}

export function scoreFile(e: TreeEntry): number {
  const path = e.path;
  const base = path.split("/").pop()!;
  const depth = path.split("/").length;
  const lang = languageFor(path);
  let score = 0;
  if (MANIFESTS.has(base)) score += 1000;
  if (INFRA_NAMES.test(base) || /^\.github\/workflows\/.+\.ya?ml$/.test(path) || /(^|\/)(k8s|kubernetes|helm|terraform|infra|deploy)\//i.test(path)) score += 800;
  if (CONFIG_NAMES.test(base)) score += 600;
  if (/^\.env\.(example|sample|template)$/i.test(base) || base === ".env.example") score += 900;
  if (lang === "prisma" || lang === "graphql") score += 500;
  if (/(^|\/)(migrations?|prisma|drizzle|models?|schemas?|entities)\//i.test(path)) score += 250;
  if (/(^|\/)(api|routes?|routers?|controllers?|handlers?|endpoints?|server|backend|services?|lib|core|auth|middleware|workers?|jobs?|queues?|cron|tasks?|webhooks?|ai|llm|agents?)\//i.test(path)) score += 300;
  if (/(^|\/)(app|pages|src|components|hooks|store|features|modules|packages|apps)\//i.test(path)) score += 150;
  if (isCodeLanguage(lang)) score += 200;
  else if (lang === "yaml" || lang === "json" || lang === "toml") score += 40;
  else if (lang === "markdown") score += base.toLowerCase() === "readme.md" && depth === 1 ? 300 : 5;
  else if (lang === "html" || lang === "css") score += 20;
  else if (lang === "sql") score += 120;
  else if (lang === "shell") score += 30;
  else score += 1;
  if (/(^|\/)(__tests__|tests?|spec|e2e|cypress|__mocks__|fixtures|stories)\//i.test(path) || /\.(test|spec|stories)\.[jt]sx?$/.test(base) || /_test\.go$/.test(base) || /^test_.*\.py$/.test(base)) score = Math.floor(score * 0.35);
  if (/(^|\/)(docs?|examples?|samples?|demo|benchmarks?|scripts?)\//i.test(path)) score = Math.floor(score * 0.5);
  if (/\.d\.ts$/.test(base)) score = Math.floor(score * 0.2);
  score -= Math.min(120, depth * 12);
  if ((e.size ?? 0) > 60_000) score -= 100;
  return Math.max(0, score);
}
