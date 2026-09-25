import type { ApiRoute, Language, RouteKind } from "@shared/repo";

const SERVER_RECEIVER = /^(app|router|server|api|fastify|hono|koa|routes?|v\d+|admin|auth|public|private|protected|[a-zA-Z]*[rR]outer|[a-zA-Z]*[rR]outes|[a-zA-Z]*[aA]pp|group|g|r|e|mux|http)$/;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "options", "head"]);
const WEBHOOK_HINT = /webhook|constructEvent|verifySignature|x-hub-signature|svix|Webhooks?\(|verify_webhook|HMAC/i;

let counter = 0;
function id(): string {
  counter += 1;
  return `route-${counter}`;
}

export function resetRouteIds(): void {
  counter = 0;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function classify(path: string, content: string, method: string): RouteKind {
  if (/webhook/i.test(path)) return "webhook";
  if (method === "POST" && WEBHOOK_HINT.test(content) && /webhook/i.test(content)) return "webhook";
  return "http";
}

function make(partial: Omit<ApiRoute, "id" | "evidence" | "kind"> & { kind?: RouteKind }, content: string): ApiRoute {
  return {
    id: id(),
    ...partial,
    kind: partial.kind ?? classify(partial.path, content, partial.method),
    evidence: { kind: "verified", file: partial.file, line: partial.line, note: `${partial.framework} route definition` },
  };
}

function handlerAfter(content: string, index: number): string | undefined {
  const rest = content.slice(index, index + 240);
  // skip middleware arrays / identifiers until we hit a plausible handler reference
  const m = /,\s*(?:\[[^\]]*\]\s*,\s*)?(?:[a-zA-Z_$][\w$.]*\s*,\s*)*([a-zA-Z_$][\w$.]*)\s*\)/.exec(rest);
  if (m && !/^(async|function)$/.test(m[1]!)) return m[1];
  if (/,\s*(async\s*)?\(/.test(rest) || /,\s*(async\s+)?function/.test(rest)) return "inline handler";
  return undefined;
}

/** Framework-agnostic route extraction for one file. */
export function detectRoutes(path: string, content: string, lang: Language): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const base = path.split("/").pop()!;

  // ── File-system routing (Next.js, Nuxt, SvelteKit, Remix, Astro) ──
  const fsRoutes = fileSystemRoutes(path, content);
  routes.push(...fsRoutes.map((r) => make(r, content)));

  if (lang === "typescript" || lang === "javascript") {
    // Express / Fastify / Koa-router / Hono / itty-router style
    const re = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*(['"`])((?:\/|\$\{)[^'"`\n]*)\3/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const receiver = m[1]!;
      if (!SERVER_RECEIVER.test(receiver) || !HTTP_METHODS.has(m[2]!)) continue;
      routes.push(make({ method: m[2]!.toUpperCase(), path: m[4]!, file: path, line: lineOf(content, m.index), framework: "express-style", handler: handlerAfter(content, m.index + m[0].length) }, content));
    }
    const chain = /\b(?:router|app)\.route\s*\(\s*(['"`])(\/[^'"`\n]*)\1\s*\)((?:\s*\.(?:get|post|put|patch|delete|all)\s*\([^()]*\))+)?/g;
    while ((m = chain.exec(content))) {
      const methods = m[3] ? [...m[3].matchAll(/\.(get|post|put|patch|delete|all)/g)].map((x) => x[1]!.toUpperCase()) : ["ALL"];
      for (const method of methods) routes.push(make({ method, path: m[2]!, file: path, line: lineOf(content, m.index), framework: "express-style" }, content));
    }
    // NestJS decorators
    const controller = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/.exec(content);
    if (controller) {
      const prefix = controller[1] ? `/${controller[1].replace(/^\//, "")}` : "";
      const dec = /@(Get|Post|Put|Patch|Delete|All|Options|Head)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)[\s\S]{0,200}?\n\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/g;
      while ((m = dec.exec(content))) {
        const sub = m[2] ? `/${m[2].replace(/^\//, "")}` : "";
        routes.push(make({ method: m[1]!.toUpperCase(), path: `${prefix}${sub}` || "/", file: path, line: lineOf(content, m.index), framework: "nestjs", handler: m[3] }, content));
      }
    }
    // tRPC procedures
    const trpc = /\b([a-zA-Z_$][\w$]*)\s*:\s*(?:t\.)?(?:publicProcedure|protectedProcedure|procedure|[a-zA-Z]*Procedure)\b[\s\S]{0,400}?\.(query|mutation|subscription)\s*\(/g;
    while ((m = trpc.exec(content))) {
      routes.push(make({ method: m[2]!.toUpperCase(), path: m[1]!, file: path, line: lineOf(content, m.index), framework: "trpc", kind: "rpc" }, content));
    }
    // GraphQL SDL embedded in gql`` templates
    if (/gql`|graphql`|buildSchema\(/.test(content)) routes.push(...graphqlRoutes(path, content).map((r) => make(r, content)));
  }

  if (lang === "graphql") routes.push(...graphqlRoutes(path, content).map((r) => make(r, content)));

  if (lang === "python") {
    let prefix = "";
    const bp = /Blueprint\([^)]*url_prefix\s*=\s*['"]([^'"]+)['"]/.exec(content) ?? /APIRouter\([^)]*prefix\s*=\s*['"]([^'"]+)['"]/.exec(content);
    if (bp) prefix = bp[1]!;
    const re = /@([a-zA-Z_][\w.]*)\.(get|post|put|patch|delete|route|api_route|websocket|head|options)\(\s*['"]([^'"]+)['"]([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const kindName = m[2]!;
      let methods: string[] = kindName === "route" || kindName === "api_route" ? ["GET"] : [kindName.toUpperCase()];
      const mm = /methods\s*=\s*\[([^\]]+)\]/.exec(m[4] ?? "");
      if (mm) methods = mm[1]!.split(",").map((s) => s.trim().replace(/['"]/g, "").toUpperCase()).filter(Boolean);
      const handler = /\n\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)/.exec(content.slice(m.index + m[0].length, m.index + m[0].length + 300))?.[1];
      for (const method of methods) {
        routes.push(make({ method: kindName === "websocket" ? "WS" : method, path: `${prefix}${m[3]!}`, file: path, line: lineOf(content, m.index), framework: /fastapi|APIRouter|router/.test(content) ? "fastapi" : "flask", handler }, content));
      }
    }
    if (base === "urls.py") {
      const dj = /\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+)/g;
      while ((m = dj.exec(content))) routes.push(make({ method: "ANY", path: `/${m[1]!.replace(/^\^|\$$/g, "")}`, file: path, line: lineOf(content, m.index), framework: "django", handler: m[2] }, content));
    }
  }

  if (lang === "go") {
    const re = /\b([a-zA-Z_]\w*)\.(GET|POST|PUT|PATCH|DELETE|Any|Handle|HandleFunc|Get|Post|Put|Patch|Delete|Options|Head|Route|Group)\(\s*"([^"]+)"\s*,?\s*([a-zA-Z_][\w.]*)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const method = m[2]!;
      const upper = method.toUpperCase();
      if (method === "Group" || method === "Route") continue;
      if (!/^\//.test(m[3]!)) continue;
      routes.push(make({ method: ["HANDLE", "HANDLEFUNC", "ANY"].includes(upper) ? "ANY" : upper, path: m[3]!, file: path, line: lineOf(content, m.index), framework: "go-http", handler: m[4] }, content));
    }
  }

  if (lang === "ruby" && base === "routes.rb") {
    const re = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"](?:\s*,\s*to:\s*['"]([^'"]+)['"])?/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) routes.push(make({ method: m[1]!.toUpperCase(), path: m[2]!.startsWith("/") ? m[2]! : `/${m[2]!}`, file: path, line: lineOf(content, m.index), framework: "rails", handler: m[3] }, content));
    const res = /^\s*resources?\s+:(\w+)/gm;
    while ((m = res.exec(content))) routes.push(make({ method: "REST", path: `/${m[1]!}`, file: path, line: lineOf(content, m.index), framework: "rails", handler: `${m[1]!}#index/show/create/update/destroy` }, content));
  }

  if (lang === "java" || lang === "kotlin") {
    const cls = /@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?"([^"]*)"/.exec(content);
    const prefix = cls?.[1] ?? "";
    const re = /@(Get|Post|Put|Delete|Patch|Request)Mapping\(?\s*(?:(?:value|path)\s*=\s*)?(?:"([^"]*)")?[^)]*\)?[\s\S]{0,200}?\s(?:fun\s+)?([a-zA-Z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      if (m.index === (cls?.index ?? -1)) continue;
      routes.push(make({ method: m[1] === "Request" ? "ANY" : m[1]!.toUpperCase(), path: `${prefix}${m[2] ?? ""}` || "/", file: path, line: lineOf(content, m.index), framework: "spring", handler: m[3] }, content));
    }
  }

  if (lang === "php") {
    const re = /Route::(get|post|put|patch|delete|any|match|resource|apiResource)\(\s*['"]([^'"]+)['"]\s*,\s*(?:\[?\s*([A-Za-z_\\]+(?:::class)?))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) routes.push(make({ method: m[1]!.toUpperCase(), path: m[2]!.startsWith("/") ? m[2]! : `/${m[2]!}`, file: path, line: lineOf(content, m.index), framework: "laravel", handler: m[3] }, content));
  }

  if (lang === "rust") {
    const actix = /#\[(get|post|put|delete|patch)\("([^"]+)"\)\]\s*(?:pub\s+)?async\s+fn\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = actix.exec(content))) routes.push(make({ method: m[1]!.toUpperCase(), path: m[2]!, file: path, line: lineOf(content, m.index), framework: "actix", handler: m[3] }, content));
    const axum = /\.route\(\s*"([^"]+)"\s*,\s*(get|post|put|delete|patch|any)\(\s*([\w:]+)/g;
    while ((m = axum.exec(content))) routes.push(make({ method: m[2]!.toUpperCase(), path: m[1]!, file: path, line: lineOf(content, m.index), framework: "axum", handler: m[3] }, content));
  }

  // De-duplicate identical method+path+line
  const seen = new Set<string>();
  return routes.filter((r) => {
    const k = `${r.method} ${r.path} ${r.file}:${r.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type PartialRoute = Omit<ApiRoute, "id" | "evidence" | "kind"> & { kind?: RouteKind };

function toRoutePath(segments: string[]): string {
  const cleaned = segments
    .filter((s) => !/^\(.*\)$/.test(s)) // route groups
    .map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, "*$1").replace(/^\[\[\.\.\.(\w+)\]\]$/, "*$1?").replace(/^\[(\w+)\]$/, ":$1").replace(/^\$(\w+)$/, ":$1"));
  return `/${cleaned.join("/")}`.replace(/\/index$/, "") || "/";
}

function exportedHttpMethods(content: string): string[] {
  const methods = new Set<string>();
  const re = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) methods.add(m[1]!);
  const alias = /export\s*\{\s*([^}]+)\}/g;
  while ((m = alias.exec(content))) for (const name of m[1]!.split(",")) {
    const n = name.trim().split(/\s+as\s+/).pop()?.trim();
    if (n && /^(GET|POST|PUT|PATCH|DELETE)$/.test(n)) methods.add(n);
  }
  return [...methods];
}

function fileSystemRoutes(path: string, content: string): PartialRoute[] {
  const out: PartialRoute[] = [];
  const stripped = path.replace(/^(apps\/[^/]+\/|packages\/[^/]+\/)?(src\/)?/, "");
  const parts = stripped.split("/");
  const file = parts[parts.length - 1]!;
  const stem = file.replace(/\.(tsx?|jsx?|mjs|vue|svelte|astro|md|mdx)$/, "");

  // Next.js pages router
  if (parts[0] === "pages") {
    if (parts[1] === "api") {
      const segs = parts.slice(1, -1).concat(stem === "index" ? [] : [stem]);
      const methods = detectReqMethodChecks(content);
      for (const method of methods.length ? methods : ["ANY"]) out.push({ method, path: toRoutePath(segs), file: path, line: 1, framework: "nextjs-pages-api" });
    } else if (!/^_(app|document|error)$/.test(stem) && !stem.startsWith("_") && /\.(tsx?|jsx?|mdx?)$/.test(file)) {
      const segs = parts.slice(1, -1).concat(stem === "index" ? [] : [stem]);
      out.push({ method: "PAGE", path: toRoutePath(segs), file: path, line: 1, framework: "nextjs-pages", kind: "page" });
    }
  }
  // Next.js app router
  if (parts[0] === "app") {
    if (stem === "route") {
      const segs = parts.slice(1, -1);
      const methods = exportedHttpMethods(content);
      for (const method of methods.length ? methods : ["ANY"]) out.push({ method, path: toRoutePath(segs), file: path, line: 1, framework: "nextjs-app-route" });
    } else if (stem === "page") {
      out.push({ method: "PAGE", path: toRoutePath(parts.slice(1, -1)), file: path, line: 1, framework: "nextjs-app", kind: "page" });
    }
  }
  // SvelteKit
  if (parts[0] === "routes" && (stem === "+server" || stem === "+page")) {
    const segs = parts.slice(1, -1);
    if (stem === "+server") for (const method of exportedHttpMethods(content).length ? exportedHttpMethods(content) : ["ANY"]) out.push({ method, path: toRoutePath(segs), file: path, line: 1, framework: "sveltekit" });
    else out.push({ method: "PAGE", path: toRoutePath(segs), file: path, line: 1, framework: "sveltekit", kind: "page" });
  }
  // Nuxt server routes
  if (parts[0] === "server" && (parts[1] === "api" || parts[1] === "routes")) {
    const segs = parts.slice(parts[1] === "api" ? 1 : 2, -1).concat(stem === "index" ? [] : [stem.replace(/\.(get|post|put|delete|patch)$/, "")]);
    const methodFromName = /\.(get|post|put|delete|patch)$/.exec(stem)?.[1]?.toUpperCase();
    out.push({ method: methodFromName ?? "ANY", path: toRoutePath(segs), file: path, line: 1, framework: "nuxt-server" });
  }
  // Remix flat routes
  if (parts[0] === "app" && parts[1] === "routes" && parts.length === 3 && /\.(tsx?|jsx?)$/.test(file)) {
    const segs = stem === "_index" ? [] : stem.split(".").filter((s) => s !== "_index" && !s.startsWith("_"));
    const hasAction = /export\s+(?:async\s+)?function\s+action|export\s+const\s+action/.test(content);
    const hasLoader = /export\s+(?:async\s+)?function\s+loader|export\s+const\s+loader/.test(content);
    out.push({ method: "PAGE", path: toRoutePath(segs), file: path, line: 1, framework: "remix", kind: "page" });
    if (hasAction) out.push({ method: "POST", path: toRoutePath(segs), file: path, line: 1, framework: "remix-action", handler: "action" });
    if (hasLoader && !/\.tsx$/.test(file)) out.push({ method: "GET", path: toRoutePath(segs), file: path, line: 1, framework: "remix-loader", handler: "loader" });
  }
  // Astro pages / endpoints
  if (parts[0] === "pages" && file.endsWith(".astro")) out.push({ method: "PAGE", path: toRoutePath(parts.slice(1, -1).concat(stem === "index" ? [] : [stem])), file: path, line: 1, framework: "astro", kind: "page" });
  return out;
}

function detectReqMethodChecks(content: string): string[] {
  const methods = new Set<string>();
  const re = /req\.method\s*[!=]==?\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) methods.add(m[1]!);
  return [...methods];
}

function graphqlRoutes(path: string, content: string): PartialRoute[] {
  const out: PartialRoute[] = [];
  const blocks = /type\s+(Query|Mutation|Subscription)\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blocks.exec(content))) {
    const kind = m[1]!.toUpperCase();
    const body = m[2]!;
    const fields = [...body.matchAll(/^\s*([a-zA-Z_]\w*)\s*(?:\([^)]*\))?\s*:/gm)].map((f) => f[1]!);
    for (const f of fields.slice(0, 40)) out.push({ method: kind, path: f, file: path, line: lineOf(content, m.index), framework: "graphql", kind: "graphql" });
  }
  return out;
}

/** Literal HTTP calls made from code (fetch / axios / SWR / useChat), used to verify frontend → API edges. */
export function detectHttpCalls(content: string): { path: string; line: number; method: string }[] {
  const out: { path: string; line: number; method: string }[] = [];
  const seen = new Set<string>();
  const add = (rawPath: string, index: number, method: string) => {
    let p = rawPath;
    if (/^https?:\/\//.test(p)) p = p.replace(/^https?:\/\/[^/]+/, "");
    p = p.replace(/\$\{[^}]+\}/g, ":param").replace(/\?.*$/, "").replace(/^[^/]*(?=\/)/, "");
    if (p.length <= 1 || !p.startsWith("/")) return;
    const key = `${p}@${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: p, line: lineOf(content, index), method: method.toUpperCase() });
  };
  const re = /\b(fetch|fetcher|axios(?:\.(get|post|put|patch|delete))?|api(?:Client)?\.(get|post|put|patch|delete)|useSWR(?:Infinite|Mutation)?|useQuery|useMutation|ky(?:\.(get|post|put|patch|delete))?|got(?:\.(get|post))?|request\.(get|post|put|delete)|client\.(get|post|put|patch|delete)|\$fetch|useFetch)\s*(?:<[^()]*>)?\s*\(\s*(['"`])((?:\/|https?:\/\/[^/'"`]+\/|\$\{[^}]+\}\/)[^'"`\n]*)\8/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const method = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? (m[1] === "fetch" || m[1] === "fetcher" ? bodyMethod(content, m.index) : "GET");
    add(m[9]!, m.index, method);
  }
  // useChat({ api: '/api/chat' }), action: '/api/x', url: '/api/x'
  const opt = /\b(?:api|url|endpoint|action)\s*:\s*(['"`])((?:\/|\$\{[^}]+\}\/)[^'"`\n]*)\1/g;
  while ((m = opt.exec(content))) add(m[2]!, m.index, "ANY");
  // Bare API path literals (e.g. passed to a fetcher helper): weaker but still a verified literal in this file.
  const bare = /(['"`])(\/api\/[A-Za-z0-9_\-/[\]$.{}:]*)\1/g;
  while ((m = bare.exec(content))) add(m[2]!, m.index, "ANY");
  return out.slice(0, 60);
}

function bodyMethod(content: string, index: number): string {
  const window = content.slice(index, index + 300);
  return /method\s*:\s*['"](POST|PUT|PATCH|DELETE|GET)['"]/i.exec(window)?.[1] ?? "GET";
}
