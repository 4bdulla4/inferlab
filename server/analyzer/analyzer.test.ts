import { describe, expect, it } from "vitest";
import type { RepoFile } from "@shared/repo";
import { detectEnvVars } from "./detectors/env";
import { buildResolveContext, detectImports } from "./detectors/imports";
import { detectIntegrations } from "./detectors/integrations";
import { detectJobs } from "./detectors/jobs";
import { parseManifests } from "./detectors/manifests";
import { detectHttpCalls, detectRoutes, resetRouteIds } from "./detectors/routes";
import { detectSchema } from "./detectors/schema";
import { detectSymbols } from "./detectors/symbols";
import { parseGitHubUrl } from "./github";
import { buildGraph } from "./graph";
import { selectFiles } from "./select";

describe("parseGitHubUrl", () => {
  it("accepts common URL shapes", () => {
    expect(parseGitHubUrl("https://github.com/vercel/ai-chatbot")).toMatchObject({ owner: "vercel", repo: "ai-chatbot", ref: "" });
    expect(parseGitHubUrl("github.com/vercel/ai-chatbot.git")).toMatchObject({ owner: "vercel", repo: "ai-chatbot" });
    expect(parseGitHubUrl("https://github.com/vercel/ai-chatbot/tree/canary/lib")).toMatchObject({ ref: "canary" });
    expect(parseGitHubUrl("vercel/ai-chatbot")).toMatchObject({ owner: "vercel", repo: "ai-chatbot" });
  });
  it("rejects non-GitHub hosts and malformed input", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/a/b")).toThrow(/github\.com/);
    expect(() => parseGitHubUrl("https://github.com/onlyowner")).toThrow();
    expect(() => parseGitHubUrl("not a url at all")).toThrow();
  });
});

describe("route detection", () => {
  it("finds express-style routes with handlers and webhook classification", () => {
    resetRouteIds();
    const src = `
      import express from "express";
      const router = express.Router();
      router.get("/users/:id", authenticate, getUser);
      app.post('/api/webhooks/stripe', express.raw({type:'application/json'}), handleStripe);
      axios.get("/not-a-server-route");
      router.route("/items").get(list).post(create);
    `;
    const routes = detectRoutes("src/routes/users.ts", src, "typescript");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(["GET /users/:id", "POST /api/webhooks/stripe", "GET /items", "POST /items"]));
    expect(routes.find((r) => r.path === "/users/:id")?.handler).toBe("getUser");
    expect(routes.find((r) => r.path.includes("webhooks"))?.kind).toBe("webhook");
    expect(routes.some((r) => r.path === "/not-a-server-route")).toBe(false);
  });
  it("derives Next.js app-router and pages-router routes from file paths", () => {
    const app = detectRoutes("app/(chat)/api/chat/[id]/stream/route.ts", "export async function GET() {}\nexport const POST = handler;", "typescript");
    expect(app.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["GET /api/chat/:id/stream", "POST /api/chat/:id/stream"]);
    const page = detectRoutes("src/app/dashboard/[team]/page.tsx", "export default function Page() {}", "typescript");
    expect(page[0]).toMatchObject({ method: "PAGE", path: "/dashboard/:team", kind: "page" });
    const pagesApi = detectRoutes("pages/api/users/[id].ts", "export default function handler(req,res){ if (req.method === 'DELETE') {} }", "typescript");
    expect(pagesApi[0]).toMatchObject({ method: "DELETE", path: "/api/users/:id" });
  });
  it("finds FastAPI, Flask, Django and Go routes", () => {
    const fast = detectRoutes("app/api/items.py", `router = APIRouter(prefix="/items")\n@router.get("/{id}")\nasync def read_item(id: int):\n    pass\n`, "python");
    expect(fast[0]).toMatchObject({ method: "GET", path: "/items/{id}", handler: "read_item", framework: "fastapi" });
    const flask = detectRoutes("app.py", `@app.route("/login", methods=["GET", "POST"])\ndef login():\n    pass`, "python");
    expect(flask.map((r) => r.method).sort()).toEqual(["GET", "POST"]);
    const dj = detectRoutes("core/urls.py", `urlpatterns = [ path('admin/', admin.site.urls), path("api/health", views.health) ]`, "python");
    expect(dj.map((r) => r.path)).toEqual(["/admin/", "/api/health"]);
    const go = detectRoutes("main.go", `r.GET("/ping", ping)\nhttp.HandleFunc("/health", healthHandler)`, "go");
    expect(go.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /ping", "ANY /health"]);
  });
  it("detects literal HTTP call sites including SWR generics and useChat options", () => {
    const calls = detectHttpCalls("useSWR<Array<Vote>>(`/api/vote?chatId=${id}`, fetcher); const { messages } = useChat({ api: '/api/chat' }); await fetch('/api/history', { method: 'DELETE' });");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(expect.arrayContaining(["GET /api/vote", "ANY /api/chat", "DELETE /api/history"]));
  });
});

describe("symbols, imports, env, schema, jobs", () => {
  it("extracts JS/TS functions, components, hooks, classes and methods", () => {
    const src = `export default function Page() { return <div/> }\nexport const useThing = () => 1;\nconst helper = async (a, b) => a + b;\nexport class Service {\n  run(x) {\n    return x;\n  }\n}\nexport type Foo = string;`;
    const syms = detectSymbols("app/page.tsx", src, "typescript");
    expect(syms.find((s) => s.name === "Page")).toMatchObject({ kind: "component", exported: true, line: 1 });
    expect(syms.find((s) => s.name === "useThing")?.kind).toBe("hook");
    expect(syms.find((s) => s.name === "helper")).toMatchObject({ kind: "function", exported: false });
    expect(syms.find((s) => s.name === "Service")?.kind).toBe("class");
    expect(syms.find((s) => s.name === "run")?.kind).toBe("method");
    expect(syms.find((s) => s.name === "Foo")?.kind).toBe("type");
  });
  it("extracts Python and Go symbols", () => {
    const py = detectSymbols("app/models.py", `class User(Base):\n    def full_name(self):\n        pass\n\ndef create_user(db, data):\n    pass`, "python");
    expect(py.map((s) => `${s.kind}:${s.name}`)).toEqual(["class:User", "method:full_name", "function:create_user"]);
    const go = detectSymbols("main.go", `type Server struct {}\nfunc (s *Server) Start() error { return nil }\nfunc main() {}`, "go");
    expect(go.map((s) => `${s.kind}:${s.name}`)).toEqual(["class:Server", "method:Start", "function:main"]);
  });
  it("resolves relative, alias and workspace imports against the tree", () => {
    const paths = ["src/lib/db.ts", "src/components/Button.tsx", "src/app/page.tsx", "packages/ui/src/index.ts", "packages/ui/package.json", "app/api/route.py", "app/services/users.py", "app/__init__.py"];
    const ctx = buildResolveContext(paths, { "@acme/ui": "packages/ui" }, undefined, new Map([["tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } })]]));
    const imps = detectImports("src/app/page.tsx", `import { db } from "../lib/db";\nimport Button from "@/components/Button";\nimport { Card } from "@acme/ui";\nimport React from "react";`, "typescript", ctx);
    expect(imps.map((i) => i.resolved)).toEqual(["src/lib/db.ts", "src/components/Button.tsx", "packages/ui/src/index.ts", undefined]);
    expect(imps[3]!.external).toBe(true);
    const py = detectImports("app/api/route.py", `from app.services.users import create_user\nfrom .. import config\nimport fastapi`, "python", ctx);
    expect(py[0]!.resolved).toBe("app/services/users.py");
    expect(py[1]!.resolved).toBe("app/__init__.py");
    expect(py[2]!.external).toBe(true);
  });
  it("collects env vars from code and declaration files with categories", () => {
    const vars = detectEnvVars([
      { path: "src/db.ts", content: "const url = process.env.DATABASE_URL; const k = process.env['STRIPE_SECRET_KEY']; const dbg = process.env.DEBUG_MODE;", language: "typescript" },
      { path: "app/main.py", content: 'os.environ.get("OPENAI_API_KEY"); os.getenv("PORT")', language: "python" },
      { path: ".env.example", content: "DATABASE_URL=\nSTRIPE_SECRET_KEY=\nNEW_ONE=1\n# comment", language: "other" },
    ]);
    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName.DATABASE_URL).toMatchObject({ category: "url", declaredIn: [".env.example"] });
    expect(byName.DATABASE_URL!.usages).toHaveLength(1);
    expect(byName.STRIPE_SECRET_KEY!.category).toBe("secret");
    expect(byName.DEBUG_MODE!.category).toBe("flag");
    expect(byName.OPENAI_API_KEY!.usages[0]).toMatchObject({ file: "app/main.py", line: 1 });
    expect(byName.NEW_ONE!.usages).toHaveLength(0);
  });
  it("detects Prisma, Drizzle and SQLAlchemy models but ignores non-mongoose Schema constructors", () => {
    expect(detectSchema("prisma/schema.prisma", "model User {\n  id Int @id\n  email String\n}\nmodel Post {\n  id Int\n}", "prisma").map((m) => `${m.name}:${m.fields.join(",")}`)).toEqual(["User:id,email", "Post:id"]);
    expect(detectSchema("lib/db/schema.ts", "export const users = pgTable('users', {\n  id: serial('id'),\n  email: text('email'),\n});", "typescript")[0]).toMatchObject({ name: "users", kind: "drizzle", fields: ["id", "email"] });
    expect(detectSchema("x.ts", "const diff = new Schema({ a: 1 });", "typescript")).toHaveLength(0);
    expect(detectSchema("x.ts", "import mongoose from 'mongoose';\nconst UserSchema = new mongoose.Schema({\n  name: String,\n});", "typescript")[0]).toMatchObject({ name: "User", kind: "mongoose" });
    expect(detectSchema("models.py", "class Item(Base):\n    __tablename__ = 'items'\n    id: Mapped[int] = mapped_column(primary_key=True)\n    title = Column(String)\n", "python")[0]).toMatchObject({ name: "Item", kind: "sqlalchemy" });
  });
  it("detects cron, queue and worker definitions", () => {
    const js = detectJobs("src/jobs.ts", `cron.schedule("0 * * * *", sync);\nconst q = new Queue("emails");\nnew Worker("emails", processor);`, "typescript");
    expect(js.map((j) => `${j.kind}:${j.name}`)).toEqual(["cron:cron 0 * * * *", "queue:emails", "worker:emails"]);
    const py = detectJobs("tasks.py", `@shared_task\ndef send_email(to):\n    pass\n\napp.conf.beat_schedule = {\n  'nightly': {'task': 'tasks.cleanup', 'schedule': crontab(hour=2)},\n}`, "python");
    expect(py.map((j) => `${j.kind}:${j.name}`)).toEqual(expect.arrayContaining(["task:send_email", "cron:nightly"]));
  });
});

describe("manifests, integrations, selection", () => {
  it("parses package.json, requirements and go.mod", () => {
    const facts = parseManifests(new Map([
      ["package.json", JSON.stringify({ name: "web", dependencies: { next: "15", "@anthropic-ai/sdk": "^0.1", stripe: "1" }, devDependencies: { vitest: "1" }, scripts: { dev: "next dev" } })],
      ["api/requirements.txt", "fastapi==0.110\nSQLAlchemy>=2\n# comment\n-r base.txt\n"],
      ["go.mod", "module github.com/acme/svc\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/lib/pq v1.10.0 // indirect\n)\n"],
    ]));
    expect(facts.dependencies.map((d) => d.name)).toEqual(expect.arrayContaining(["next", "@anthropic-ai/sdk", "stripe", "vitest", "fastapi", "sqlalchemy", "github.com/gin-gonic/gin", "github.com/lib/pq"]));
    expect(facts.dependencies.find((d) => d.name === "vitest")?.dev).toBe(true);
    expect(facts.goModule).toBe("github.com/acme/svc");
    expect(facts.packageDirs.web).toBe("");
  });
  it("maps dependencies, imports and env vars to catalog integrations with evidence", () => {
    const facts = parseManifests(new Map([["package.json", JSON.stringify({ dependencies: { next: "1", "@prisma/client": "1", "next-auth": "1", openai: "1", bullmq: "1", stripe: "1" } })]]));
    const file: RepoFile = { path: "lib/ai.ts", size: 1, language: "typescript", scanned: true, loc: 1, symbols: [], imports: [{ source: "openai", external: true, line: 1 }], roles: [], importedBy: [] };
    const ints = detectIntegrations(facts.dependencies, [file], ["STRIPE_WEBHOOK_SECRET", "DATABASE_URL"]);
    const ids = ints.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["nextjs", "prisma", "nextauth", "openai", "bullmq", "stripe"]));
    expect(ints.find((i) => i.id === "openai")?.files).toEqual(["lib/ai.ts"]);
    expect(ints.find((i) => i.id === "stripe")?.envVars).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(ints.every((i) => i.evidence.every((e) => e.kind === "verified"))).toBe(true);
  });
  it("prioritises manifests/infra/source and skips vendored, binary and lock files", () => {
    const sel = selectFiles([
      { path: "package.json", type: "blob", size: 100, sha: "a" },
      { path: "node_modules/x/index.js", type: "blob", size: 100, sha: "b" },
      { path: "src/server/routes/users.ts", type: "blob", size: 500, sha: "c" },
      { path: "public/logo.png", type: "blob", size: 500, sha: "d" },
      { path: "pnpm-lock.yaml", type: "blob", size: 500, sha: "e" },
      { path: "Dockerfile", type: "blob", size: 50, sha: "f" },
      { path: "dist/bundle.min.js", type: "blob", size: 5000, sha: "g" },
    ]);
    expect(sel.chosen.map((e) => e.path)).toEqual(["package.json", "Dockerfile", "src/server/routes/users.ts"]);
    expect(sel.skipped).toBe(4);
  });
});

describe("buildGraph", () => {
  it("builds nodes for frontend, API groups, data, AI and infra with verified and heuristic edges", () => {
    const mk = (path: string, roles: RepoFile["roles"], imports: RepoFile["imports"] = [], symbols: RepoFile["symbols"] = []): RepoFile => ({ path, size: 1, language: "typescript", scanned: true, loc: 10, symbols, imports, roles, importedBy: [] });
    const files: RepoFile[] = [
      mk("app/page.tsx", ["frontend", "page"], [{ source: "react", external: true, line: 1 }], [{ name: "Page", kind: "component", line: 1, exported: true }]),
      mk("app/api/chat/route.ts", ["backend", "api-route"], [{ source: "@/lib/ai", resolved: "lib/ai.ts", external: false, line: 2 }, { source: "@/lib/db", resolved: "lib/db.ts", external: false, line: 3 }]),
      mk("app/api/webhooks/stripe/route.ts", ["backend", "api-route", "webhook"], [{ source: "stripe", external: true, line: 1 }]),
      mk("lib/ai.ts", ["backend", "ai"], [{ source: "@anthropic-ai/sdk", external: true, line: 1 }], [{ name: "generate", kind: "function", line: 3, exported: true }]),
      mk("lib/db.ts", ["backend", "model"], [{ source: "@prisma/client", external: true, line: 1 }]),
      mk("vercel.json", ["infra", "config"]),
    ];
    const routes = [
      { id: "r1", method: "POST", path: "/api/chat", file: "app/api/chat/route.ts", line: 1, framework: "nextjs-app-route", kind: "http" as const, evidence: { kind: "verified" as const } },
      { id: "r2", method: "POST", path: "/api/webhooks/stripe", file: "app/api/webhooks/stripe/route.ts", line: 1, framework: "nextjs-app-route", kind: "webhook" as const, evidence: { kind: "verified" as const } },
      { id: "r3", method: "PAGE", path: "/", file: "app/page.tsx", line: 1, framework: "nextjs-app", kind: "page" as const, evidence: { kind: "verified" as const } },
    ];
    const integrations = [
      { id: "nextjs", name: "Next.js", category: "frontend-framework" as const, evidence: [], dependencies: ["next"], files: [], envVars: [] },
      { id: "anthropic", name: "Anthropic Claude API", category: "ai" as const, evidence: [], dependencies: ["@anthropic-ai/sdk"], files: ["lib/ai.ts"], envVars: ["ANTHROPIC_API_KEY"] },
      { id: "prisma", name: "Prisma", category: "orm" as const, evidence: [], dependencies: ["@prisma/client"], files: ["lib/db.ts"], envVars: ["DATABASE_URL"] },
      { id: "stripe", name: "Stripe", category: "payments" as const, evidence: [], dependencies: ["stripe"], files: ["app/api/webhooks/stripe/route.ts"], envVars: [] },
    ];
    const g = buildGraph({
      files,
      routes,
      integrations,
      envVars: [{ name: "ANTHROPIC_API_KEY", category: "secret", usages: [{ file: "lib/ai.ts", line: 2 }], declaredIn: [] }],
      infra: [{ kind: "vercel", file: "vercel.json", summary: "Vercel deployment", details: {} }],
      schema: [{ name: "User", file: "lib/db.ts", line: 5, kind: "prisma", fields: ["id"] }],
      jobs: [],
      httpCalls: [{ file: "app/page.tsx", path: "/api/chat", line: 9, method: "POST" }],
      enqueueSites: new Map(),
    });
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["client", "frontend", "api:chat", "api:webhooks", "ai-layer", "ai:anthropic", "data:prisma", "ext:stripe", "infra"]));
    expect(g.fileNode.get("lib/ai.ts")).toBe("ai-layer");
    expect(g.fileNode.get("app/api/chat/route.ts")).toBe("api:chat");
    const find = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to);
    expect(find("frontend", "api:chat")).toMatchObject({ kind: "http", evidence: { kind: "verified", file: "app/page.tsx", line: 9 } });
    expect(find("api:chat", "ai-layer")).toMatchObject({ kind: "imports", evidence: { kind: "verified" } });
    expect(find("ai-layer", "ai:anthropic")).toMatchObject({ kind: "calls", evidence: { kind: "verified", file: "lib/ai.ts", line: 1 } });
    expect(find("api:webhooks", "ext:stripe")?.evidence.kind).toBe("verified");
    expect(find("ext:stripe", "api:webhooks")?.evidence.kind).toBe("heuristic");
    expect(find("client", "frontend")?.evidence.kind).toBe("heuristic");
    expect(find("infra", "frontend")?.kind).toBe("deploys");
    expect(g.nodes.find((n) => n.id === "ai-layer")?.envVars).toContain("ANTHROPIC_API_KEY");
    expect(g.nodes.find((n) => n.id === "data:prisma")?.summary).toMatch(/1 model/);
  });
});
