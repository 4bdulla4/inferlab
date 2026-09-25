import type { ApiRoute, ArchEdge, ArchNode, RepoAnalysis, RepoFile, TraceResult, TraceStep } from "@shared/repo";

const STOPWORDS = new Set(["how", "does", "do", "the", "a", "an", "is", "are", "what", "when", "where", "why", "which", "who", "to", "of", "in", "on", "for", "with", "and", "or", "it", "this", "that", "work", "works", "working", "happen", "happens", "happening", "get", "gets", "user", "users", "i", "you", "we", "they", "there", "flow", "process", "explain", "show", "me", "please", "can", "app", "application", "system", "code", "part", "step", "steps"]);

const GROUPS: Record<string, string[]> = {
  auth: ["auth", "authentication", "authenticate", "authorization", "login", "signin", "sign", "signup", "register", "registration", "session", "sessions", "jwt", "token", "tokens", "oauth", "password", "passport", "cookie", "cookies", "logout", "permission", "permissions", "protected", "clerk", "nextauth", "supabase", "verify", "credentials", "account"],
  ai: ["ai", "llm", "model", "models", "chat", "completion", "completions", "generate", "generated", "generation", "prompt", "prompts", "openai", "anthropic", "claude", "gpt", "gemini", "embedding", "embeddings", "stream", "streaming", "agent", "agents", "assistant", "response", "answer", "inference", "tool", "tools", "rag", "vector"],
  payments: ["payment", "payments", "pay", "stripe", "checkout", "billing", "subscription", "subscriptions", "subscribe", "invoice", "price", "pricing", "plan", "plans", "purchase", "webhook", "webhooks"],
  email: ["email", "emails", "mail", "notification", "notifications", "notify", "resend", "sendgrid", "smtp", "message"],
  upload: ["upload", "uploads", "file", "files", "image", "images", "storage", "s3", "blob", "bucket", "media", "attachment", "download"],
  data: ["database", "db", "query", "queries", "save", "saved", "store", "stored", "persist", "prisma", "drizzle", "table", "record", "records", "crud", "create", "created", "update", "updated", "delete", "deleted", "fetch", "list", "read", "write", "schema", "migration"],
  deploy: ["deploy", "deployed", "deployment", "docker", "vercel", "ci", "cd", "build", "pipeline", "workflow", "release", "kubernetes", "k8s", "container", "hosting", "infra", "infrastructure"],
  search: ["search", "searching", "index", "indexing", "algolia", "elastic", "meilisearch", "filter", "filtering"],
  async: ["queue", "queues", "job", "jobs", "worker", "workers", "background", "cron", "schedule", "scheduled", "scheduler", "task", "tasks", "async", "retry", "periodic"],
  realtime: ["socket", "sockets", "websocket", "websockets", "realtime", "live", "push", "subscribe", "event", "events", "broadcast"],
  ui: ["button", "click", "clicks", "clicked", "form", "submit", "submits", "page", "pages", "component", "components", "render", "renders", "navigate", "route", "screen", "modal", "input", "ui", "frontend", "display"],
  api: ["api", "endpoint", "endpoints", "request", "requests", "http", "rest", "graphql", "trpc", "server", "backend", "handler", "controller", "middleware"],
};

interface Scored<T> { item: T; score: number }

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s/_.:-]/g, " ").split(/[\s/_.:-]+/).filter((t) => t.length > 1);
}

export function extractKeywords(question: string): { direct: Set<string>; expanded: Set<string>; groups: string[] } {
  const direct = new Set(tokenize(question).filter((t) => !STOPWORDS.has(t)));
  const expanded = new Set<string>();
  const groups: string[] = [];
  for (const [g, words] of Object.entries(GROUPS)) {
    if ([...direct].some((d) => words.includes(d) || words.some((w) => w.startsWith(d) && d.length >= 4))) {
      groups.push(g);
      for (const w of words) expanded.add(w);
    }
  }
  return { direct, expanded, groups };
}

function scoreText(text: string, kw: ReturnType<typeof extractKeywords>): number {
  const tokens = new Set(tokenize(text));
  let s = 0;
  for (const t of tokens) {
    if (kw.direct.has(t)) s += 3;
    else if (kw.expanded.has(t)) s += 1;
    else for (const d of kw.direct) if (d.length >= 4 && (t.startsWith(d) || d.startsWith(t) && t.length >= 4)) { s += 1.5; break; }
  }
  return s;
}

/**
 * Deterministic code-path tracer used when no model is configured (or as a
 * fallback). Every step points at real files/routes/nodes; the *selection* of
 * those steps is keyword-driven, so the steps are labelled "heuristic".
 */
export function heuristicTrace(analysis: RepoAnalysis, question: string, id: string): TraceResult {
  const kw = extractKeywords(question);
  const { nodes, edges } = analysis.graph;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fileById = new Map(analysis.files.map((f) => [f.path, f]));
  const fileNode = new Map<string, string>();
  for (const f of analysis.files) if (f.nodeId) fileNode.set(f.path, f.nodeId);
  for (const n of nodes) for (const p of n.files) if (!fileNode.has(p)) fileNode.set(p, n.id);
  const notes: string[] = [];
  const steps: TraceStep[] = [];
  let matched = 0;

  const rank = <T,>(items: T[], text: (t: T) => string): Scored<T>[] =>
    items.map((item) => ({ item, score: scoreText(text(item), kw) })).sort((a, b) => b.score - a.score);

  const push = (s: Omit<TraceStep, "index" | "verification" | "kind"> & { kind?: TraceStep["kind"] }) => {
    const file = s.file ? (fileById.has(s.file) ? s.file : undefined) : undefined;
    const symbolExists = Boolean(file && s.symbol && fileById.get(file)?.symbols.some((x) => x.name === s.symbol));
    steps.push({
      index: steps.length + 1,
      kind: s.kind ?? "heuristic",
      ...s,
      file,
      verification: { nodeExists: Boolean(s.nodeId && nodeById.has(s.nodeId)), fileExists: Boolean(file), symbolExists },
    });
  };

  const frontend = nodeById.get("frontend");
  const client = nodeById.get("client");
  const apiNodes = nodes.filter((n) => n.category === "api" || (n.category === "auth" && n.id.startsWith("api:")));

  // 1. Entry point
  if (client) push({ title: "User action", description: kw.groups.includes("ui") ? "A user interacts with the interface (click, submit, navigation)." : "The flow starts with a user or API client request.", nodeId: client.id });

  // 2. API route (ranked by keywords + graph affinity to the question's topic)
  const apiRoutes = analysis.routes.filter((r) => r.kind !== "page");
  const affinityTargets: Record<string, (n: ArchNode) => boolean> = {
    ai: (n) => n.category === "ai" || n.id === "ai-layer",
    auth: (n) => n.category === "auth",
    data: (n) => n.category === "data",
    async: (n) => n.category === "async",
    payments: (n) => n.id.startsWith("ext:") && /stripe|paypal|paddle|lemon|razorpay/.test(n.id),
    email: (n) => n.id.startsWith("ext:") && /resend|sendgrid|nodemailer|postmark|mailgun/.test(n.id),
    upload: (n) => n.id.startsWith("ext:") && /s3|blob|cloudinary|gcs|uploadthing|multer/.test(n.id),
    search: (n) => n.id.startsWith("ext:") && /algolia|meili|elastic|typesense/.test(n.id),
    realtime: (n) => n.id.startsWith("ext:") && /socket|pusher|ably|liveblocks|ws/.test(n.id),
  };
  const affinity = (r: ApiRoute): number => {
    const nid = fileNode.get(r.file);
    if (!nid) return 0;
    let a = 0;
    for (const g of kw.groups) {
      const test = affinityTargets[g];
      if (!test) continue;
      for (const e of edges) if (e.from === nid && test(nodeById.get(e.to)!)) a += e.evidence.kind === "verified" ? 2 : 1;
    }
    return Math.min(a, 4);
  };
  const rankedRoutes = apiRoutes
    .map((r) => {
      const pathScore = scoreText(r.path, kw) * 1.5;
      const fileScore = scoreText(`${r.handler ?? ""} ${r.file}`, kw) * 0.6;
      const base = pathScore + fileScore;
      const bonus = base > 0 || affinity(r) > 0 ? affinity(r) - Math.min(1, r.path.length / 120) + (r.method === "POST" && kw.groups.some((g) => ["ai", "auth", "payments", "upload", "email"].includes(g)) ? 0.6 : 0) : 0;
      return { item: r, score: base + bonus };
    })
    .sort((a, b) => b.score - a.score);
  let route: ApiRoute | undefined = rankedRoutes[0]?.score ? rankedRoutes[0].item : undefined;
  if (!route && kw.groups.includes("auth")) route = apiRoutes.find((r) => /auth|login|session/.test(r.path));
  if (!route && kw.groups.includes("ai")) route = apiRoutes.find((r) => /chat|complet|generate|ai|message/.test(r.path));
  if (!route && apiRoutes.length) { route = apiRoutes[0]; notes.push("No route matched the question keywords; showing the first detected route as a generic example."); }
  let routeNodeId: string | undefined = route ? fileNode.get(route.file) : undefined;
  const httpEdgeForRoute = frontend && routeNodeId ? edges.find((e) => e.from === "frontend" && e.to === routeNodeId && e.kind === "http") : undefined;

  // 3. Frontend step: the verified call site when we have one, otherwise the best keyword match
  let frontendFile: RepoFile | undefined;
  if (frontend) {
    const callSite = httpEdgeForRoute?.evidence.kind === "verified" && httpEdgeForRoute.evidence.file ? fileById.get(httpEdgeForRoute.evidence.file) : undefined;
    const candidates = frontend.files.map((p) => fileById.get(p)).filter((f): f is RepoFile => Boolean(f));
    const ranked = rank(candidates, (f) => `${f.path} ${f.symbols.map((s) => s.name).join(" ")}`);
    const best = callSite ?? (ranked[0] && ranked[0].score > 0 ? ranked[0].item : undefined);
    if (best) {
      matched++;
      frontendFile = best;
      const sym = rank(best.symbols.filter((s) => s.kind === "component" || s.kind === "hook" || s.kind === "function"), (s) => s.name)[0];
      const symbol = sym && sym.score > 0 ? sym.item : best.symbols.find((s) => s.kind === "component" || s.kind === "hook");
      push({ title: `Frontend: ${best.path.split("/").pop()}`, description: callSite ? `${best.path} contains the call to ${route?.method ?? ""} ${route?.path ?? "the API"} (line ${httpEdgeForRoute?.evidence.line}).` : `The UI logic for this flow most likely lives in ${best.path}${symbol ? `, around ${symbol.name}()` : ""}.`, nodeId: frontend.id, file: best.path, line: callSite ? httpEdgeForRoute?.evidence.line : symbol?.line, symbol: symbol?.name, kind: callSite ? "verified" : "heuristic" });
    } else {
      push({ title: "Frontend", description: `No frontend file matched the question directly; the web app (${frontend.label}) issues the request.`, nodeId: frontend.id });
    }
  }

  if (route) {
    routeNodeId = fileNode.get(route.file);
    const routeNode = routeNodeId ? nodeById.get(routeNodeId) : undefined;
    if (rankedRoutes[0]?.score) matched++;
    const httpEdge = httpEdgeForRoute;
    if (frontend) push({ title: `HTTP ${route.method} ${route.path}`, description: httpEdge?.evidence.kind === "verified" ? `The frontend calls this endpoint (literal call found at ${httpEdge.evidence.file}:${httpEdge.evidence.line}).` : "The frontend is expected to call this endpoint; no literal call site was found in scanned files.", nodeId: routeNodeId, edgeId: httpEdge?.id, file: httpEdge?.evidence.file, line: httpEdge?.evidence.line, kind: httpEdge?.evidence.kind === "verified" ? "verified" : "heuristic" });
    push({ title: `Route handler in ${route.file.split("/").pop()}`, description: `${route.method} ${route.path} is defined at ${route.file}:${route.line}${route.handler ? ` and handled by ${route.handler}` : ""}${routeNode ? ` (module: ${routeNode.label})` : ""}.`, nodeId: routeNodeId, file: route.file, line: route.line, symbol: route.handler && route.handler !== "inline handler" ? route.handler : undefined, kind: "verified" });
  } else if (apiNodes.length === 0) {
    notes.push("No HTTP routes were detected in the scanned files; the trace stays at module level.");
  }

  // 4. Internal calls: follow imports from the handler file
  const visited = new Set<string>([route?.file ?? "", frontendFile?.path ?? ""]);
  let frontier: RepoFile[] = route ? [fileById.get(route.file)].filter((f): f is RepoFile => Boolean(f)) : [];
  if (!route) {
    const ranked = rank(analysis.files.filter((f) => f.roles.includes("backend") || f.roles.includes("shared")), (f) => `${f.path} ${f.symbols.map((s) => s.name).join(" ")}`);
    frontier = ranked.filter((r) => r.score > 0).slice(0, 2).map((r) => r.item);
    if (frontier.length) { matched++; for (const f of frontier) { const sym = rank(f.symbols, (s) => s.name)[0]; push({ title: `Module: ${f.path.split("/").pop()}`, description: `${f.path} matches the question${sym?.score ? `; see ${sym.item.name}()` : ""}.`, nodeId: fileNode.get(f.path), file: f.path, line: sym?.item.line, symbol: sym?.item.name }); } }
  }
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next: RepoFile[] = [];
    for (const f of frontier) {
      const targets = f.imports.map((i) => i.resolved).filter((p): p is string => Boolean(p) && !visited.has(p!)).map((p) => fileById.get(p)).filter((x): x is RepoFile => Boolean(x));
      const ranked = rank(targets, (t) => `${t.path} ${t.symbols.map((s) => s.name).join(" ")}`);
      for (const r of ranked.slice(0, depth === 0 ? 2 : 1)) {
        if (visited.has(r.item.path)) continue;
        visited.add(r.item.path);
        if (r.score > 0) matched++;
        const sym = rank(r.item.symbols.filter((s) => s.exported), (s) => s.name)[0]?.item ?? r.item.symbols.find((s) => s.exported);
        const imp = f.imports.find((i) => i.resolved === r.item.path);
        push({ title: `Calls into ${r.item.path.split("/").pop()}`, description: `${f.path.split("/").pop()} imports ${r.item.path}${imp ? ` (line ${imp.line})` : ""}${sym ? `; likely entry: ${sym.name}()` : ""}.`, nodeId: fileNode.get(r.item.path), file: r.item.path, line: sym?.line ?? imp?.line, symbol: sym?.name, kind: imp ? "verified" : "heuristic" });
        next.push(r.item);
      }
    }
    frontier = next;
  }

  // 5. Integrations reached from visited nodes
  const routeStepIndex = steps.findIndex((s) => s.title.startsWith("Route handler") || s.title.startsWith("Module:"));
  const visitedNodes = new Set(steps.slice(routeStepIndex === -1 ? 0 : routeStepIndex).map((s) => s.nodeId).filter((x): x is string => Boolean(x) && x !== "client" && x !== "frontend"));
  const integrationEdges = edges.filter((e) => visitedNodes.has(e.from) && ["data", "ai", "external", "async", "auth"].includes(nodeById.get(e.to)?.category ?? "") && !visitedNodes.has(e.to));
  const rankedEdges = integrationEdges.map((e) => ({ e, score: scoreText(`${nodeById.get(e.to)!.label} ${e.label} ${nodeById.get(e.to)!.integrations.join(" ")}`, kw) + (e.evidence.kind === "verified" ? 0.5 : 0) })).sort((a, b) => b.score - a.score);
  const relevantEdges = rankedEdges.filter((r) => r.score > 0.5);
  const chosenEdges = relevantEdges.length ? relevantEdges.slice(0, 3) : rankedEdges.filter((r) => r.e.evidence.kind === "verified").slice(0, 2);
  for (const { e, score } of chosenEdges) {
    const to = nodeById.get(e.to)!;
    if (score > 0) matched++;
    const desc: Record<ArchEdge["kind"], string> = { "reads-writes": "reads and writes data in", calls: "calls", enqueues: "enqueues background work in", consumes: "consumes jobs from", uses: "uses", authenticates: "authenticates via", http: "sends HTTP requests to", imports: "imports", deploys: "deploys", configures: "configures" };
    push({ title: `${desc[e.kind] ?? e.label} ${to.label}`, description: `${nodeById.get(e.from)?.label ?? e.from} ${desc[e.kind] ?? e.label} ${to.label}${e.evidence.file ? ` (evidence: ${e.evidence.file}${e.evidence.line ? `:${e.evidence.line}` : ""})` : ""}.${to.summary ? ` ${to.summary}.` : ""}`, nodeId: to.id, edgeId: e.id, file: e.evidence.file, line: e.evidence.line, kind: e.evidence.kind });
  }

  // 6. Response
  if (frontend || client) push({ title: "Response returned", description: frontend ? "The handler responds and the frontend updates the interface." : "The handler returns the HTTP response to the caller.", nodeId: frontend?.id ?? client?.id });

  const confidence: TraceResult["confidence"] = matched >= 3 ? "high" : matched >= 1 ? "medium" : "low";
  if (confidence === "low") notes.push("Few files matched the question; this is a generic path through the detected architecture.");
  notes.push("Heuristic tracer: step selection is keyword-based. Every file, line and route referenced exists in the repository index; the relevance to your question is inferred.");
  const answer = buildAnswer(question, steps, route, nodeById, kw.groups);
  return { id, analysisId: analysis.id, question, answer, steps, source: "heuristic", confidence, notes, createdAt: Date.now() };
}

function buildAnswer(question: string, steps: TraceStep[], route: ApiRoute | undefined, nodeById: Map<string, ArchNode>, groups: string[]): string {
  const parts: string[] = [];
  const files = steps.filter((s) => s.file).map((s) => s.file!);
  parts.push(`Based on the repository index, "${question.trim()}" most likely follows this path:`);
  if (route) parts.push(`the request reaches ${route.method} ${route.path} (${route.file}:${route.line})`);
  const modules = [...new Set(steps.map((s) => s.nodeId).filter((x): x is string => Boolean(x)).map((id) => nodeById.get(id)?.label).filter(Boolean))];
  if (modules.length) parts.push(`touching ${modules.join(" → ")}`);
  if (files.length) parts.push(`across ${new Set(files).size} file${new Set(files).size === 1 ? "" : "s"}`);
  if (groups.length) parts.push(`(topic: ${groups.join(", ")})`);
  return parts.join(", ") + ".";
}
