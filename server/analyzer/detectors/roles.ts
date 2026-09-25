import type { ApiRoute, FileRole, Integration, Language, RepoFile, SchemaModel, ScheduledJob } from "@shared/repo";
import { isCodeLanguage } from "../language";

const TEST_RE = /(^|\/)(__tests__|tests?|spec|e2e|cypress|__mocks__|fixtures)\/|\.(test|spec|stories)\.[jt]sx?$|_test\.go$|(^|\/)test_[^/]+\.py$|_spec\.rb$|Test\.java$/;
const INFRA_RE = /(^|\/)(Dockerfile(\..*)?|docker-compose[^/]*\.ya?ml|compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|serverless\.ya?ml|railway\.(json|toml)|app\.yaml|wrangler\.toml|firebase\.json|skaffold\.yaml|nixpacks\.toml)$|(^|\/)\.github\/workflows\/|(^|\/)(k8s|kubernetes|helm|terraform|infra|deploy|\.circleci)\/|\.tf$/i;
const CONFIG_RE = /(^|\/)(\.env(\..*)?|tsconfig[^/]*\.json|[\w.-]*\.config\.(js|cjs|mjs|ts)|\.babelrc|\.eslintrc[^/]*|\.prettierrc[^/]*|angular\.json|settings\.py|config\.py|config\.ts|config\.js|constants?\.(ts|js|py)|alembic\.ini|knexfile\.[jt]s|drizzle\.config\.ts|schema\.prisma|components\.json|postcss\.config\.[jt]s|jest\.config\.[jt]s|vitest\.config\.[jt]s|Makefile|turbo\.json)$/i;
const FRONTEND_DIR_RE = /(^|\/)(components?|pages|app|views|layouts?|hooks|store|stores|context|contexts|ui|features|screens|widgets|client|frontend|web|public|styles|assets|composables|src\/routes)\//i;
const BACKEND_DIR_RE = /(^|\/)(server|backend|api|routes?|routers?|controllers?|handlers?|endpoints?|services?|middlewares?|resolvers?|graphql|trpc|core|domain|usecases?|repositories|repos|daos?|internal|cmd|pkg|lib\/server|src\/server|app\/api|functions|lambda|workers?|jobs?|queues?|tasks?|cron|schedulers?)\//i;
const AUTH_RE = /(^|\/)(auth|authn|authz|login|logout|signin|signup|sign-in|sign-up|register|session|sessions|oauth|sso|passport|jwt|clerk|permissions?|guards?|rbac|middleware\/auth)/i;
const AI_RE = /(^|\/)(ai|llm|llms|agents?|prompts?|embeddings?|rag|chat|completion|openai|anthropic|claude|gpt|gemini|langchain|inference|models?\/(llm|ai))/i;
const WORKER_RE = /(^|\/)(workers?|jobs?|queues?|cron|crons|schedulers?|tasks?|background|consumers?|processors?)\//i;
const MODEL_RE = /(^|\/)(models?|schemas?|entities|prisma|drizzle|db|database|migrations?|seeds?)\//i;
const DOCS_RE = /(^|\/)(docs?|documentation)\/|\.mdx?$/i;
const SCRIPT_RE = /(^|\/)(scripts?|bin|tools)\//i;
const SHARED_RE = /(^|\/)(shared|common|utils?|helpers?|lib|libs|types|packages\/(shared|common|types|utils))\//i;
const ENTRY_RE = /^(src\/)?(main|index|server|app|cli)\.(ts|tsx|js|jsx|mjs|py|go|rs)$|^(manage\.py|main\.go|cmd\/[^/]+\/main\.go|app\.py|wsgi\.py|asgi\.py|application\.py|server\.py|Program\.cs|Main\.java)$/;

export interface RoleContext {
  routes: ApiRoute[];
  schema: SchemaModel[];
  jobs: ScheduledJob[];
  integrations: Integration[];
  frontendDeps: Set<string>;
  backendDeps: Set<string>;
  authDeps: Set<string>;
  aiDeps: Set<string>;
}

export function buildRoleContext(routes: ApiRoute[], schema: SchemaModel[], jobs: ScheduledJob[], integrations: Integration[]): RoleContext {
  const collect = (cats: string[]) => new Set(integrations.filter((i) => cats.includes(i.category)).flatMap((i) => i.dependencies.map((d) => d.toLowerCase())));
  return {
    routes,
    schema,
    jobs,
    integrations,
    frontendDeps: new Set([...collect(["frontend-framework"]), "react", "react-dom", "vue", "svelte", "@angular/core", "next/navigation", "next/link", "next/image", "react-router-dom", "@tanstack/react-query", "zustand", "redux", "@reduxjs/toolkit", "framer-motion", "motion/react"]),
    backendDeps: new Set([...collect(["backend-framework"]), "express", "fastify", "hono", "koa", "http", "node:http", "fastapi", "flask", "django", "net/http"]),
    authDeps: collect(["auth"]),
    aiDeps: collect(["ai"]),
  };
}

export function assignRoles(file: Omit<RepoFile, "roles" | "importedBy">, language: Language, ctx: RoleContext): FileRole[] {
  const roles = new Set<FileRole>();
  const p = file.path;
  const base = p.split("/").pop()!;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const importSpecs = file.imports.map((i) => i.source.toLowerCase());
  const importsAny = (set: Set<string>) => importSpecs.some((s) => set.has(s) || [...set].some((d) => d.endsWith("*") ? s.startsWith(d.slice(0, -1)) : s === d || s.startsWith(`${d}/`)));

  if (TEST_RE.test(p)) roles.add("test");
  if (INFRA_RE.test(p) || language === "dockerfile") roles.add("infra");
  if (CONFIG_RE.test(p) || language === "toml" || (language === "json" && !/package\.json$/.test(base))) roles.add("config");
  if (DOCS_RE.test(p) || language === "markdown") roles.add("docs");
  if (language === "css" || /\.(scss|sass|less)$/.test(base)) roles.add("styles");
  if (SCRIPT_RE.test(p) || language === "shell") roles.add("script");
  if (ENTRY_RE.test(p)) roles.add("entry");

  const fileRoutes = ctx.routes.filter((r) => r.file === p);
  if (fileRoutes.some((r) => r.kind !== "page")) roles.add("api-route");
  if (fileRoutes.some((r) => r.kind === "page")) roles.add("page");
  if (fileRoutes.some((r) => r.kind === "webhook")) roles.add("webhook");
  if (ctx.schema.some((s) => s.file === p)) roles.add("model");
  if (/(^|\/)migrations?\//i.test(p) || /^\d{4,}_.*\.(sql|ts|js|py)$/.test(base) || language === "sql") roles.add("migration");
  if (ctx.jobs.some((j) => j.file === p)) roles.add(ctx.jobs.some((j) => j.file === p && j.kind === "cron") ? "cron" : "worker");
  if (AUTH_RE.test(p) || importsAny(ctx.authDeps)) roles.add("auth");
  if (AI_RE.test(p) || importsAny(ctx.aiDeps)) roles.add("ai");
  if (WORKER_RE.test(p) && isCodeLanguage(language)) roles.add("worker");
  if (MODEL_RE.test(p) && isCodeLanguage(language) && !roles.has("model") && !roles.has("migration")) roles.add("model");

  const isJsx = ext === "tsx" || ext === "jsx" || ext === "vue" || ext === "svelte" || ext === "astro";
  const frontendSignal = isJsx || importsAny(ctx.frontendDeps) || /use client/.test("") || FRONTEND_DIR_RE.test(p);
  const backendSignal = importsAny(ctx.backendDeps) || BACKEND_DIR_RE.test(p) || roles.has("api-route") || language === "python" || language === "go" || language === "ruby" || language === "java" || language === "kotlin" || language === "php" || language === "rust" || language === "csharp";

  if (isCodeLanguage(language) && !roles.has("test") && !roles.has("script")) {
    if (isJsx || roles.has("page")) roles.add("frontend");
    else if (roles.has("api-route") || roles.has("model") || roles.has("worker") || roles.has("cron")) roles.add("backend");
    else if (frontendSignal && !backendSignal) roles.add("frontend");
    else if (backendSignal) roles.add("backend");
    else if (SHARED_RE.test(p)) roles.add("shared");
    else if (language === "typescript" || language === "javascript") roles.add(FRONTEND_DIR_RE.test(p) ? "frontend" : "shared");
  }
  if (roles.size === 0 && SHARED_RE.test(p)) roles.add("shared");
  return [...roles];
}
