import type {
  ApiRoute, ArchEdge, ArchNode, EdgeKind, EnvVar, Evidence, InfraConfig, Integration, NodeCategory, RepoFile, SchemaModel, ScheduledJob,
} from "@shared/repo";
import { BACKEND_FRAMEWORK_IDS, FRONTEND_FRAMEWORK_IDS, normalizeSpecifier } from "./detectors/integrations";
import { labelForKind } from "./detectors/infra";

export interface HttpCallSite { file: string; path: string; line: number; method: string }

export interface GraphInput {
  files: RepoFile[];
  routes: ApiRoute[];
  integrations: Integration[];
  envVars: EnvVar[];
  infra: InfraConfig[];
  schema: SchemaModel[];
  jobs: ScheduledJob[];
  httpCalls: HttpCallSite[];
  enqueueSites: Map<string, number[]>;
}

export const LAYER: Record<NodeCategory, number> = { client: 0, frontend: 1, api: 2, auth: 3, service: 3, async: 3, data: 4, ai: 5, external: 5, infra: 6 };

const DATA_CATEGORIES = new Set(["database", "orm", "cache", "vector-db"]);
const ASYNC_CATEGORIES = new Set(["queue", "worker", "cron"]);
const EXTERNAL_CATEGORIES = new Set(["payments", "email", "storage", "analytics", "monitoring", "realtime", "search", "external"]);
const NON_CODE_ROLES = new Set(["test", "config", "infra", "docs", "styles", "script"]);

class GraphBuilder {
  readonly nodes = new Map<string, ArchNode>();
  readonly fileNode = new Map<string, string>();
  readonly edges = new Map<string, ArchEdge>();

  node(id: string, label: string, category: NodeCategory, summaryHint = ""): ArchNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, label, category, layer: LAYER[category], summary: summaryHint, files: [], routes: [], symbols: [], dependencies: [], envVars: [], integrations: [], evidence: [] };
      this.nodes.set(id, n);
    }
    return n;
  }

  attach(nodeId: string, file: RepoFile, primary = true): void {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    if (!n.files.includes(file.path)) n.files.push(file.path);
    if (primary && !this.fileNode.has(file.path)) this.fileNode.set(file.path, nodeId);
    for (const s of file.symbols) {
      if (n.symbols.length >= 120) break;
      if (["function", "class", "component", "hook", "method", "route-handler"].includes(s.kind) && (s.exported || s.kind === "component" || s.kind === "class"))
        n.symbols.push({ file: file.path, name: s.name, kind: s.kind, line: s.line });
    }
  }

  edge(from: string, to: string, kind: EdgeKind, label: string, evidence: Evidence): ArchEdge | null {
    if (from === to || !this.nodes.has(from) || !this.nodes.has(to)) return null;
    const id = `${from}→${to}:${kind}`;
    let e = this.edges.get(id);
    if (!e) {
      e = { id, from, to, kind, label, evidence, weight: 1 };
      this.edges.set(id, e);
    } else {
      e.weight += 1;
      if (e.evidence.kind !== "verified" && evidence.kind === "verified") e.evidence = evidence;
    }
    return e;
  }
}

function routeGroupKey(route: ApiRoute): string {
  if (route.kind === "webhook") return "webhooks";
  if (route.kind === "graphql") return "graphql";
  if (route.kind === "rpc") return "rpc";
  const segs = route.path.split("/").filter(Boolean);
  while (segs.length && (segs[0] === "api" || /^v\d+$/i.test(segs[0]!) || segs[0] === "rest")) segs.shift();
  const first = segs[0];
  if (!first || first.startsWith(":") || first.startsWith("*") || first.startsWith("[")) return "root";
  return first.replace(/\.[a-z]+$/, "").toLowerCase();
}

const AUTHISH = /^(auth|authn|login|logout|signin|signup|sign-in|sign-up|register|session|sessions|oauth|sso|token|tokens|password|verify|magic-link|callback|account|me)$/;

function serviceBucket(path: string): string {
  let p = path.replace(/^(apps|packages|services)\/[^/]+\//, "").replace(/^(src|server|backend|api|lib\/server|internal|pkg|app)\//, "");
  p = p.replace(/^src\//, "");
  const parts = p.split("/");
  if (parts.length <= 1) return "root";
  return parts[0]!.toLowerCase();
}

export function buildGraph(input: GraphInput): { nodes: ArchNode[]; edges: ArchEdge[]; fileNode: Map<string, string> } {
  const b = new GraphBuilder();
  const { files, routes, integrations, envVars, infra, schema, jobs, httpCalls, enqueueSites } = input;
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const frontendFw = integrations.filter((i) => FRONTEND_FRAMEWORK_IDS.has(i.id));
  const backendFw = integrations.filter((i) => BACKEND_FRAMEWORK_IDS.has(i.id));

  // ── 1. API nodes from routes ──
  const apiRoutes = routes.filter((r) => r.kind !== "page");
  const groups = new Map<string, ApiRoute[]>();
  for (const r of apiRoutes) {
    const k = routeGroupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const kept = sortedGroups.slice(0, 9);
  const overflow = sortedGroups.slice(9).flatMap(([, rs]) => rs);
  if (overflow.length) kept.push(["other", overflow]);
  for (const [key, rs] of kept) {
    const id = `api:${key}`;
    const label = key === "webhooks" ? "Webhooks" : key === "graphql" ? "GraphQL API" : key === "rpc" ? "tRPC API" : key === "root" ? "API · root" : key === "other" ? "API · other routes" : `API · /${key}`;
    const n = b.node(id, label, AUTHISH.test(key) ? "auth" : "api");
    n.layer = LAYER.api;
    for (const r of rs) {
      n.routes.push(r.id);
      const f = fileByPath.get(r.file);
      if (f) b.attach(id, f);
    }
    const fws = [...new Set(rs.map((r) => r.framework))];
    n.summary = `${rs.length} route${rs.length === 1 ? "" : "s"} · ${fws.join(", ")}`;
  }
  if (apiRoutes.length === 0 && backendFw.length > 0) {
    const n = b.node("api:server", `HTTP Server · ${backendFw.map((f) => f.name).join(", ")}`, "api");
    for (const f of files) if ((f.roles.includes("entry") || f.roles.includes("api-route")) && f.roles.includes("backend")) b.attach("api:server", f);
    n.summary = "No route definitions matched the scanner; server entry files attached.";
  }

  // ── 3. Auth node ──
  const authIntegrations = integrations.filter((i) => i.category === "auth");
  const authFiles = files.filter((f) => f.roles.includes("auth") && !f.roles.includes("page") && !/\.(tsx|jsx|vue|svelte|astro)$/.test(f.path) && !b.fileNode.has(f.path) && !f.roles.some((r) => NON_CODE_ROLES.has(r)));
  if (authIntegrations.length > 0 || authFiles.length > 0) {
    const n = b.node("auth", authIntegrations.length ? `Authentication · ${authIntegrations.slice(0, 2).map((i) => i.name).join(", ")}` : "Authentication", "auth");
    for (const f of authFiles) b.attach("auth", f);
    for (const i of authIntegrations) {
      n.integrations.push(i.id);
      n.dependencies.push(...i.dependencies.filter((d) => !n.dependencies.includes(d)));
      n.envVars.push(...i.envVars.filter((e) => !n.envVars.includes(e)));
      for (const p of i.files) {
        const f = fileByPath.get(p);
        if (f && !n.files.includes(p)) b.attach("auth", f, false);
      }
      n.evidence.push(...i.evidence.slice(0, 2));
    }
    n.summary = `${n.files.length} files${authIntegrations.length ? ` · ${authIntegrations.map((i) => i.name).join(", ")}` : ""}`;
  }

  // ── 4. AI orchestration layer ──
  const aiIntegrations = integrations.filter((i) => i.category === "ai");
  const aiFiles = files.filter((f) => f.roles.includes("ai") && !b.fileNode.has(f.path) && !f.roles.includes("frontend") && !f.roles.some((r) => NON_CODE_ROLES.has(r)));
  if (aiFiles.length > 0 && aiIntegrations.length > 0) {
    const n = b.node("ai-layer", "AI Orchestration", "service");
    for (const f of aiFiles) b.attach("ai-layer", f);
    n.summary = `${aiFiles.length} files calling ${aiIntegrations.map((i) => i.name).join(", ")}`;
  }

  // ── 5. Data nodes ──
  const schemaKindToIntegration: Record<string, string[]> = { prisma: ["prisma"], mongoose: ["mongoose", "mongodb"], sqlalchemy: ["sqlalchemy", "postgres", "mysql", "sqlite"], django: ["django"], typeorm: ["typeorm"], drizzle: ["drizzle"], sequelize: ["sequelize"], sql: ["postgres", "mysql", "sqlite", "prisma", "drizzle"], other: [] };
  const dataIntegrations = integrations.filter((i) => DATA_CATEGORIES.has(i.category));
  const modelFiles = files.filter((f) => (f.roles.includes("model") || f.roles.includes("migration")) && !b.fileNode.has(f.path));
  for (const i of dataIntegrations) {
    const id = `data:${i.id}`;
    const n = b.node(id, i.name, "data");
    n.integrations.push(i.id);
    n.dependencies.push(...i.dependencies);
    n.envVars.push(...i.envVars);
    n.evidence.push(...i.evidence.slice(0, 3));
    for (const p of i.files) {
      const f = fileByPath.get(p);
      if (f) b.attach(id, f, false);
    }
    const models = schema.filter((s) => (schemaKindToIntegration[s.kind] ?? []).includes(i.id));
    for (const s of models) {
      const f = fileByPath.get(s.file);
      if (f) b.attach(id, f, !b.fileNode.has(s.file));
    }
    n.summary = `${i.category}${models.length ? ` · ${models.length} model${models.length === 1 ? "" : "s"}: ${models.slice(0, 5).map((m) => m.name).join(", ")}${models.length > 5 ? "…" : ""}` : ""}${i.files.length ? ` · used in ${i.files.length} files` : ""}`;
  }
  const orphanModels = schema.filter((s) => !dataIntegrations.some((i) => (schemaKindToIntegration[s.kind] ?? []).includes(i.id)));
  if (orphanModels.length > 0 || (modelFiles.length > 0 && dataIntegrations.length === 0)) {
    const n = b.node("data:schema", "Database access · schema & queries", "data");
    for (const s of orphanModels) {
      const f = fileByPath.get(s.file);
      if (f) b.attach("data:schema", f);
    }
    for (const f of modelFiles) if (!b.fileNode.has(f.path)) b.attach("data:schema", f);
    n.summary = `${orphanModels.length || modelFiles.length} model/migration definitions`;
  }
  const vectorDbs = dataIntegrations.filter((i) => i.category === "vector-db");
  for (const v of vectorDbs) {
    const n = b.nodes.get(`data:${v.id}`);
    if (n) n.layer = LAYER.ai;
  }

  // ── 5b. Frontend node (after specific roles are assigned) ──
  const frontendFiles = files.filter((f) => (f.roles.includes("frontend") || f.roles.includes("page")) && !f.roles.includes("api-route") && !b.fileNode.has(f.path) && !f.roles.some((r) => NON_CODE_ROLES.has(r)));
  if (frontendFiles.length > 0 || frontendFw.length > 0) {
    const label = frontendFw.length ? `Web App · ${frontendFw.slice(0, 2).map((f) => f.name).join(" + ")}` : "Web App";
    const n = b.node("frontend", label, "frontend");
    for (const f of frontendFiles) b.attach("frontend", f);
    for (const r of routes) if (r.kind === "page") n.routes.push(r.id);
    n.integrations = frontendFw.map((f) => f.id);
    const pages = routes.filter((r) => r.kind === "page").length;
    const comps = n.symbols.filter((s) => s.kind === "component").length;
    n.summary = `${frontendFiles.length} files${pages ? ` · ${pages} pages` : ""}${comps ? ` · ${comps} components` : ""}`;
  }

  // ── 6. Async nodes ──
  const asyncIntegrations = integrations.filter((i) => ASYNC_CATEGORIES.has(i.category));
  for (const i of asyncIntegrations) {
    const id = `async:${i.id}`;
    const n = b.node(id, i.category === "cron" ? `Scheduled Jobs · ${i.name}` : `${i.category === "queue" ? "Queue" : "Workers"} · ${i.name}`, "async");
    n.integrations.push(i.id);
    n.dependencies.push(...i.dependencies);
    n.envVars.push(...i.envVars);
    n.evidence.push(...i.evidence.slice(0, 2));
    for (const p of i.files) {
      const f = fileByPath.get(p);
      if (f) b.attach(id, f, !b.fileNode.has(p) && (f.roles.includes("worker") || f.roles.includes("cron")));
    }
    const related = jobs.filter((j) => i.files.includes(j.file));
    n.summary = `${related.length || i.files.length} ${i.category === "cron" ? "schedules" : "jobs/workers"}${related.length ? `: ${related.slice(0, 4).map((j) => j.name).join(", ")}` : ""}`;
  }
  const unassignedJobs = jobs.filter((j) => !asyncIntegrations.some((i) => i.files.includes(j.file)));
  if (unassignedJobs.length > 0) {
    const crons = unassignedJobs.filter((j) => j.kind === "cron");
    const workers = unassignedJobs.filter((j) => j.kind !== "cron");
    if (crons.length) {
      const n = b.node("async:scheduler", "Scheduled Jobs", "async");
      for (const j of crons) {
        const f = fileByPath.get(j.file);
        if (f) b.attach("async:scheduler", f, f.roles.includes("cron") && !b.fileNode.has(f.path));
        n.evidence.push(j.evidence);
      }
      n.summary = `${crons.length} schedule${crons.length === 1 ? "" : "s"}: ${crons.slice(0, 4).map((j) => `${j.name}${j.schedule ? ` (${j.schedule})` : ""}`).join(", ")}`;
    }
    if (workers.length) {
      const n = b.node("async:workers", "Background Workers", "async");
      for (const j of workers) {
        const f = fileByPath.get(j.file);
        if (f) b.attach("async:workers", f, !b.fileNode.has(f.path));
        n.evidence.push(j.evidence);
      }
      n.summary = `${workers.length} worker/task definition${workers.length === 1 ? "" : "s"}: ${workers.slice(0, 4).map((j) => j.name).join(", ")}`;
    }
  }

  // ── 7. AI provider nodes ──
  for (const i of aiIntegrations) {
    const id = `ai:${i.id}`;
    const n = b.node(id, i.name, "ai");
    n.integrations.push(i.id);
    n.dependencies.push(...i.dependencies);
    n.envVars.push(...i.envVars);
    n.evidence.push(...i.evidence.slice(0, 3));
    for (const p of i.files) {
      const f = fileByPath.get(p);
      if (f) b.attach(id, f, false);
    }
    n.summary = `${i.files.length ? `called from ${i.files.length} file${i.files.length === 1 ? "" : "s"}` : "declared as dependency"}${i.envVars.length ? ` · env ${i.envVars.slice(0, 2).join(", ")}` : ""}`;
  }

  // ── 8. External services ──
  const external = integrations.filter((i) => EXTERNAL_CATEGORIES.has(i.category) && !["logging", "otel", "react-email", "multer"].includes(i.id))
    .sort((a, b2) => b2.files.length + b2.evidence.length - (a.files.length + a.evidence.length)).slice(0, 10);
  for (const i of external) {
    const id = `ext:${i.id}`;
    const n = b.node(id, i.name, "external");
    n.integrations.push(i.id);
    n.dependencies.push(...i.dependencies);
    n.envVars.push(...i.envVars);
    n.evidence.push(...i.evidence.slice(0, 3));
    for (const p of i.files) {
      const f = fileByPath.get(p);
      if (f) b.attach(id, f, false);
    }
    n.summary = `${i.category}${i.files.length ? ` · used in ${i.files.length} file${i.files.length === 1 ? "" : "s"}` : ""}`;
  }

  // ── 9. Service nodes from remaining backend code ──
  const remaining = files.filter((f) => !b.fileNode.has(f.path) && (f.roles.includes("backend") || f.roles.includes("shared") || f.roles.includes("worker")) && !f.roles.some((r) => NON_CODE_ROLES.has(r)) && !f.roles.includes("frontend"));
  const buckets = new Map<string, RepoFile[]>();
  for (const f of remaining) {
    const k = serviceBucket(f.path);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(f);
  }
  const sortedBuckets = [...buckets.entries()].sort((a, b2) => b2[1].length - a[1].length);
  const keptBuckets = sortedBuckets.slice(0, 7);
  const rest = sortedBuckets.slice(7).flatMap(([, fs]) => fs);
  if (rest.length) keptBuckets.push(["other", rest]);
  for (const [k, fs] of keptBuckets) {
    const id = `svc:${k}`;
    const n = b.node(id, k === "root" ? "Core modules" : `Services · ${k}`, "service");
    for (const f of fs) b.attach(id, f);
    const fns = n.symbols.filter((s) => s.kind === "function" || s.kind === "method").length;
    const classes = n.symbols.filter((s) => s.kind === "class").length;
    n.summary = `${fs.length} files${fns ? ` · ${fns} functions` : ""}${classes ? ` · ${classes} classes` : ""}`;
  }

  // ── 10. Infra node ──
  if (infra.length > 0) {
    const kinds = [...new Set(infra.map((c) => labelForKind(c.kind)))];
    const n = b.node("infra", `Deployment · ${kinds.slice(0, 3).join(", ")}${kinds.length > 3 ? ` +${kinds.length - 3}` : ""}`, "infra");
    for (const c of infra) {
      const f = fileByPath.get(c.file);
      if (f) b.attach("infra", f);
      else if (!n.files.includes(c.file)) n.files.push(c.file);
      n.evidence.push({ kind: "verified", file: c.file, note: c.summary });
    }
    const declared = envVars.filter((v) => v.declaredIn.length > 0).map((v) => v.name);
    n.envVars.push(...declared.slice(0, 40));
    n.summary = `${infra.length} config file${infra.length === 1 ? "" : "s"}${declared.length ? ` · ${declared.length} env vars declared` : ""}`;
  }

  // ── 11. Client node ──
  const hasFrontend = b.nodes.has("frontend");
  const apiNodeIds = [...b.nodes.values()].filter((n) => n.id.startsWith("api:")).map((n) => n.id);
  if (hasFrontend || apiNodeIds.length > 0) {
    const n = b.node("client", hasFrontend ? "Users · Browser" : "API Clients", "client");
    n.summary = hasFrontend ? "People using the web application" : "Callers of the HTTP API";
  }

  // ── Env vars → nodes ──
  for (const v of envVars) {
    for (const u of v.usages) {
      const nodeId = b.fileNode.get(u.file);
      const n = nodeId ? b.nodes.get(nodeId) : undefined;
      if (n && !n.envVars.includes(v.name) && n.envVars.length < 30) n.envVars.push(v.name);
    }
  }

  // ── Edges: verified import relationships ──
  for (const f of files) {
    const from = b.fileNode.get(f.path);
    if (!from) continue;
    for (const imp of f.imports) {
      if (!imp.resolved) continue;
      let to = b.fileNode.get(imp.resolved);
      if (!to) {
        // directory import → first file in that directory with a node
        const prefix = `${imp.resolved}/`;
        for (const [p, nid] of b.fileNode) if (p.startsWith(prefix)) { to = nid; break; }
      }
      if (to) b.edge(from, to, "imports", "imports", { kind: "verified", file: f.path, line: imp.line, note: `imports ${imp.source}` });
    }
  }

  // ── Edges: external integration usage ──
  const integrationNode = (i: Integration): string | undefined => {
    if (DATA_CATEGORIES.has(i.category)) return `data:${i.id}`;
    if (ASYNC_CATEGORIES.has(i.category)) return `async:${i.id}`;
    if (i.category === "ai") return `ai:${i.id}`;
    if (EXTERNAL_CATEGORIES.has(i.category)) return b.nodes.has(`ext:${i.id}`) ? `ext:${i.id}` : undefined;
    if (i.category === "auth") return b.nodes.has("auth") ? "auth" : undefined;
    return undefined;
  };
  for (const i of integrations) {
    const target = integrationNode(i);
    if (!target || !b.nodes.has(target)) continue;
    for (const p of i.files) {
      const from = b.fileNode.get(p);
      const f = fileByPath.get(p);
      if (!from || !f || from === target) continue;
      const imp = f.imports.find((x) => x.external && i.dependencies.some((d) => normalizeSpecifier(x.source) === d || x.source === d || x.source.startsWith(`${d}/`)));
      const evidence: Evidence = { kind: "verified", file: p, line: imp?.line, note: `imports ${imp?.source ?? i.dependencies[0] ?? i.name}` };
      let kind: EdgeKind = "uses";
      let label = "uses";
      if (DATA_CATEGORIES.has(i.category)) { kind = "reads-writes"; label = i.category === "cache" ? "caches in" : "reads / writes"; }
      else if (i.category === "ai") { kind = "calls"; label = "calls model API"; }
      else if (ASYNC_CATEGORIES.has(i.category)) { const enq = enqueueSites.get(p); kind = enq && enq.length ? "enqueues" : "uses"; label = kind === "enqueues" ? "enqueues jobs" : "uses"; if (kind === "enqueues") evidence.line = enq![0]; }
      else if (i.category === "auth") { kind = "authenticates"; label = "authenticates via"; }
      else { kind = "calls"; label = "calls"; }
      b.edge(from, target, kind, label, evidence);
    }
  }

  // ── Edges: verified HTTP calls from the frontend ──
  const normalizePath = (p: string) => p.replace(/\/+$/, "").replace(/:[^/]+|\*[^/]*|\[[^\]]+\]/g, "*").replace(/\/\*\?$/, "");
  const routeIndex = new Map<string, ApiRoute>();
  for (const r of apiRoutes) routeIndex.set(normalizePath(r.path), r);
  let httpMatches = 0;
  if (hasFrontend) {
    for (const call of httpCalls) {
      const from = b.fileNode.get(call.file);
      if (from !== "frontend") continue;
      const norm = normalizePath(call.path);
      let route = routeIndex.get(norm);
      if (!route) {
        for (const [k, r] of routeIndex) if (norm.startsWith(k) || k.startsWith(norm)) { route = r; break; }
      }
      if (!route) continue;
      const to = b.fileNode.get(route.file);
      if (!to) continue;
      const e = b.edge("frontend", to, "http", `${call.method} ${call.path}`, { kind: "verified", file: call.file, line: call.line, note: `${call.method} ${call.path} → ${route.method} ${route.path}` });
      if (e) httpMatches++;
    }
    if (httpMatches === 0 && apiNodeIds.length > 0) {
      for (const id of apiNodeIds.slice(0, 3)) b.edge("frontend", id, "http", "calls (inferred)", { kind: "heuristic", note: "No literal fetch/axios call matched a route; inferred from co-located frontend and API code." });
    }
  }

  // ── Edges: client entry ──
  if (b.nodes.has("client")) {
    if (hasFrontend) b.edge("client", "frontend", "http", "loads app", { kind: "heuristic", note: "Users load the web application in a browser." });
    else for (const id of apiNodeIds.slice(0, 4)) b.edge("client", id, "http", "requests", { kind: "heuristic", note: "External callers invoke the HTTP API." });
  }

  // ── Edges: webhooks ← providers ──
  if (b.nodes.has("api:webhooks")) {
    for (const i of external) {
      const webhookFiles = b.nodes.get("api:webhooks")!.files;
      if (i.files.some((p) => webhookFiles.includes(p))) b.edge(`ext:${i.id}`, "api:webhooks", "http", "posts webhook events", { kind: "heuristic", note: `${i.name} SDK is imported by the webhook handler; the provider is inferred to call it.` });
    }
  }

  // ── Edges: workers consume queues ──
  for (const j of jobs) {
    if (j.kind !== "worker" && j.kind !== "task") continue;
    const from = b.fileNode.get(j.file);
    if (!from) continue;
    for (const i of asyncIntegrations) {
      if (i.category !== "queue") continue;
      if (from !== `async:${i.id}` && i.files.includes(j.file)) b.edge(`async:${i.id}`, from, "consumes", "dispatches jobs to", { kind: "verified", file: j.file, line: j.line, note: `${j.library} ${j.kind} "${j.name}"` });
    }
  }

  // ── Edges: ORM → database (heuristic) ──
  const orms = dataIntegrations.filter((i) => i.category === "orm");
  const dbs = dataIntegrations.filter((i) => i.category === "database");
  for (const o of orms) for (const d of dbs) b.edge(`data:${o.id}`, `data:${d.id}`, "uses", "connects to", { kind: "heuristic", note: `${o.name} is an ORM/query layer and ${d.name} driver is present; the pairing is inferred.` });

  // ── Edges: infra deploys (heuristic) ──
  if (b.nodes.has("infra")) {
    const targets = [hasFrontend ? "frontend" : null, ...apiNodeIds.slice(0, 2), ...[...b.nodes.keys()].filter((k) => k.startsWith("svc:")).slice(0, 1)].filter((x): x is string => Boolean(x));
    for (const t of targets) b.edge("infra", t, "deploys", "deploys", { kind: "heuristic", note: `Inferred from ${infra.slice(0, 3).map((c) => c.file).join(", ")}.` });
  }

  // ── Edges: data fallback (heuristic) ──
  const incoming = new Map<string, number>();
  for (const e of b.edges.values()) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const codeNodes = [...b.nodes.values()].filter((n) => (n.category === "api" || n.category === "service" || n.category === "auth") && n.files.length > 0).sort((a, b2) => b2.files.length - a.files.length);
  for (const n of b.nodes.values()) {
    if ((n.category === "data" || n.category === "ai" || n.category === "external") && !incoming.get(n.id)) {
      const integration = integrations.find((i) => n.integrations.includes(i.id));
      const clientSide = integration ? ["analytics", "realtime", "monitoring"].includes(integration.category) : false;
      const from = clientSide && hasFrontend ? "frontend" : codeNodes[0]?.id;
      if (!from) continue;
      b.edge(from, n.id, n.category === "data" ? "reads-writes" : "calls", "uses (inferred)", { kind: "heuristic", note: `${n.label} is declared as a dependency but no scanned file imports it directly; attached to ${clientSide && hasFrontend ? "the web app" : "the largest code module"}.` });
    }
  }

  // ── Finalize: evidence + dependency lists ──
  for (const n of b.nodes.values()) {
    if (n.evidence.length === 0) for (const p of n.files.slice(0, 3)) n.evidence.push({ kind: "verified", file: p, note: "member file" });
    n.files.sort();
    n.envVars = [...new Set(n.envVars)];
    n.dependencies = [...new Set(n.dependencies)];
    n.integrations = [...new Set(n.integrations)];
  }
  const order: NodeCategory[] = ["client", "frontend", "api", "auth", "service", "async", "data", "ai", "external", "infra"];
  const nodes = [...b.nodes.values()].sort((a, b2) => order.indexOf(a.category) - order.indexOf(b2.category) || b2.files.length - a.files.length);
  const edges = [...b.edges.values()].sort((a, b2) => b2.weight - a.weight);
  return { nodes, edges, fileNode: b.fileNode };
}
