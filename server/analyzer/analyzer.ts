import type { AnalyzeEvent, Language, RepoAnalysis, RepoFile, RepoStats } from "@shared/repo";
import type { AiAnalyzer } from "./ai";
import { detectEnvVars } from "./detectors/env";
import { detectHttpCalls, detectRoutes, resetRouteIds } from "./detectors/routes";
import { detectImports, buildResolveContext } from "./detectors/imports";
import { detectInfra } from "./detectors/infra";
import { detectIntegrations, BACKEND_FRAMEWORK_IDS, FRONTEND_FRAMEWORK_IDS } from "./detectors/integrations";
import { detectEnqueueSites, detectJobs } from "./detectors/jobs";
import { parseManifests } from "./detectors/manifests";
import { assignRoles, buildRoleContext } from "./detectors/roles";
import { detectSchema } from "./detectors/schema";
import { detectSymbols } from "./detectors/symbols";
import { GitHubClient, parseGitHubUrl } from "./github";
import { buildGraph, type HttpCallSite } from "./graph";
import { isCodeLanguage, languageFor } from "./language";
import { LIMITS, selectFiles } from "./select";

export interface AnalyzeDeps {
  github: GitHubClient;
  ai: AiAnalyzer;
  emit: (event: AnalyzeEvent) => void;
  signal: AbortSignal;
  skipAi?: boolean;
}

/** Runs the full pipeline: fetch → scan → graph → (optional) AI summaries. */
export async function analyzeRepository(url: string, deps: AnalyzeDeps): Promise<RepoAnalysis> {
  const started = Date.now();
  const { github, emit, signal } = deps;
  const phase = (name: string, detail: string, progress: number) => emit({ type: "phase", at: Date.now(), phase: name, detail, progress });
  const warnings: string[] = [];

  const ref = parseGitHubUrl(url);
  phase("resolve", `Resolving ${ref.owner}/${ref.repo}…`, 0.02);
  const metaWithRef = await github.getRepo(ref, signal);
  const { requestedRef, ...meta } = metaWithRef;
  phase("tree", `Listing files on ${requestedRef}…`, 0.06);
  const tree = await github.getTree(ref, requestedRef, signal);
  meta.sha = tree.sha;
  if (tree.truncated) warnings.push("GitHub truncated the file listing (very large repository); analysis covers the returned subset.");

  const selection = selectFiles(tree.entries);
  phase("select", `Selected ${selection.chosen.length} of ${selection.total} files to read`, 0.1);

  // ── Fetch file contents with bounded concurrency ──
  const contents = new Map<string, string>();
  let bytes = 0;
  let done = 0;
  const queue = [...selection.chosen];
  const worker = async () => {
    while (queue.length) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const entry = queue.shift()!;
      const text = await github.getRawFile(ref, tree.sha, entry.path, LIMITS.maxFileBytes, signal).catch(() => null);
      if (text !== null) {
        contents.set(entry.path, text);
        bytes += text.length;
      }
      done++;
      if (done % 12 === 0 || done === selection.chosen.length) phase("fetch", `Read ${done}/${selection.chosen.length} files (${(bytes / 1024).toFixed(0)} KB)`, 0.1 + 0.45 * (done / selection.chosen.length));
    }
  };
  await Promise.all(Array.from({ length: LIMITS.concurrency }, worker));
  if (selection.chosen.length > 0 && contents.size === 0) {
    throw Object.assign(new Error(meta.isPrivate ? "The repository was found but none of its files could be read with this token." : "None of the repository files could be read."), { status: 403, hint: meta.isPrivate ? "Make sure the GitHub token has read access to Contents for this repository." : undefined });
  }
  if (contents.size < selection.chosen.length * 0.5) warnings.push(`Only ${contents.size} of ${selection.chosen.length} selected files could be read; results are partial.`);
  if (meta.isPrivate) warnings.push("Private repository: read with your GitHub token. Nothing is stored beyond this server's in-memory cache.");

  // ── Manifests & tsconfig aliases ──
  phase("manifests", "Parsing dependency manifests…", 0.58);
  const manifests = parseManifests(contents);
  const tsconfigs = new Map<string, string>();
  for (const [p, c] of contents) if (/(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(p) || /(^|\/)jsconfig\.json$/.test(p)) tsconfigs.set(p, c);
  const allPaths = tree.entries.filter((e) => e.type === "blob").map((e) => e.path);
  const resolveCtx = buildResolveContext(allPaths, manifests.packageDirs, manifests.goModule, tsconfigs);

  // ── Per-file scan ──
  phase("scan", "Extracting symbols, imports, routes…", 0.62);
  resetRouteIds();
  const routes = [];
  const schema = [];
  const jobs = [];
  const httpCalls: HttpCallSite[] = [];
  const enqueueSites = new Map<string, number[]>();
  const partialFiles: Omit<RepoFile, "roles" | "importedBy">[] = [];
  const languages: Partial<Record<Language, number>> = {};
  let totalLoc = 0;
  let scannedCount = 0;
  const envInputs: { path: string; content: string; language: Language }[] = [];

  for (const entry of tree.entries) {
    if (entry.type !== "blob") continue;
    const language = languageFor(entry.path);
    languages[language] = (languages[language] ?? 0) + 1;
    const content = contents.get(entry.path);
    if (content === undefined) {
      partialFiles.push({ path: entry.path, size: entry.size ?? 0, language, scanned: false, loc: 0, symbols: [], imports: [] });
      continue;
    }
    scannedCount++;
    const loc = content.split("\n").length;
    totalLoc += loc;
    envInputs.push({ path: entry.path, content, language });
    const fileRoutes = detectRoutes(entry.path, content, language);
    routes.push(...fileRoutes);
    schema.push(...detectSchema(entry.path, content, language));
    jobs.push(...detectJobs(entry.path, content, language));
    const symbols = isCodeLanguage(language) ? detectSymbols(entry.path, content, language) : [];
    const imports = detectImports(entry.path, content, language, resolveCtx);
    if (language === "typescript" || language === "javascript") {
      for (const call of detectHttpCalls(content)) httpCalls.push({ file: entry.path, ...call });
      const enq = detectEnqueueSites(content);
      if (enq.length) enqueueSites.set(entry.path, enq);
    } else if (language === "python" || language === "ruby") {
      const enq = detectEnqueueSites(content);
      if (enq.length) enqueueSites.set(entry.path, enq);
    }
    partialFiles.push({ path: entry.path, size: entry.size ?? content.length, language, scanned: true, loc, symbols, imports });
  }

  // ── Infra, env, integrations, roles ──
  phase("infra", "Reading deployment and environment configuration…", 0.74);
  const infraFacts = detectInfra(contents);
  jobs.push(...infraFacts.jobs);
  const envVars = detectEnvVars(envInputs);
  const preliminaryFiles: RepoFile[] = partialFiles.map((f) => ({ ...f, roles: [], importedBy: [] }));
  const integrations = detectIntegrations(manifests.dependencies, preliminaryFiles, envVars.map((v) => v.name));
  const roleCtx = buildRoleContext(routes, schema, jobs, integrations);
  const files: RepoFile[] = partialFiles.map((f) => ({ ...f, roles: assignRoles(f, f.language, roleCtx), importedBy: [] }));
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const f of files) for (const imp of f.imports) if (imp.resolved) byPath.get(imp.resolved)?.importedBy.push(f.path);

  // ── Graph ──
  phase("graph", "Building the architecture graph…", 0.82);
  const { fileNode, ...graph } = buildGraph({ files, routes, integrations, envVars, infra: infraFacts.configs, schema, jobs, httpCalls, enqueueSites });
  for (const f of files) {
    const nid = fileNode.get(f.path);
    if (nid) f.nodeId = nid;
  }

  const stats: RepoStats = {
    totalFiles: allPaths.length,
    scannedFiles: scannedCount,
    skippedFiles: allPaths.length - scannedCount,
    truncatedTree: tree.truncated,
    bytesRead: bytes,
    languages,
    totalLoc,
  };
  const frontend = integrations.filter((i) => FRONTEND_FRAMEWORK_IDS.has(i.id)).map((i) => i.name);
  const backend = integrations.filter((i) => BACKEND_FRAMEWORK_IDS.has(i.id)).map((i) => i.name);
  const dbs = integrations.filter((i) => ["database", "orm"].includes(i.category)).map((i) => i.name);
  const ai = integrations.filter((i) => i.category === "ai").map((i) => i.name);
  const headlineParts = [
    frontend.length ? `${frontend.slice(0, 2).join(" + ")} frontend` : null,
    backend.length ? `${backend.slice(0, 2).join(" + ")} backend` : routes.some((r) => r.kind !== "page") ? `${routes.filter((r) => r.kind !== "page").length} API routes` : null,
    dbs.length ? `${dbs.slice(0, 2).join(" / ")} data layer` : null,
    ai.length ? `${ai.slice(0, 2).join(", ")} integration` : null,
    infraFacts.configs.length ? `deployed via ${[...new Set(infraFacts.configs.map((c) => c.kind))].slice(0, 2).join(" + ")}` : null,
  ].filter(Boolean);
  const stack = [...new Set(integrations.filter((i) => ["frontend-framework", "backend-framework", "api-style", "database", "orm", "cache", "auth", "ai", "queue", "worker", "payments", "deployment"].includes(i.category)).map((i) => i.name))];

  const analysis: RepoAnalysis = {
    id: `${ref.owner}-${ref.repo}-${tree.sha.slice(0, 7)}`.toLowerCase(),
    ref,
    meta,
    scannedAt: Date.now(),
    durationMs: 0,
    stats,
    files,
    dependencies: manifests.dependencies,
    integrations,
    routes,
    envVars,
    infra: infraFacts.configs,
    schema,
    jobs,
    graph,
    overview: { headline: headlineParts.length ? `${meta.fullName}: ${headlineParts.join(", ")}.` : `${meta.fullName}: ${stats.scannedFiles} files scanned; no framework signatures recognised.`, stack },
    ai: deps.ai.status(),
    warnings,
  };

  // ── Optional AI pass ──
  if (deps.ai.status().available && !deps.skipAi) {
    phase("ai", "Asking the model to describe each module (AI-inferred)…", 0.9);
    try {
      const summary = await deps.ai.summarize(analysis, signal);
      if (summary) {
        applySummary(analysis, summary);
      } else warnings.push("The model did not return a usable summary; showing verified facts only.");
    } catch (err) {
      warnings.push(`AI summarization skipped: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}`);
    }
  }

  analysis.durationMs = Date.now() - started;
  phase("done", `Analysis complete in ${(analysis.durationMs / 1000).toFixed(1)} s`, 1);
  return analysis;
}

/** Merges a model summary into an analysis (used by the analyze pass and the on-demand summarize endpoint). */
export function applySummary(analysis: RepoAnalysis, summary: { headline: string; overview: string; nodes: Record<string, string>; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }): void {
  analysis.overview.aiOverview = summary.overview;
  if (summary.headline) analysis.overview.headline = summary.headline;
  for (const n of analysis.graph.nodes) if (summary.nodes[n.id]) n.aiSummary = summary.nodes[n.id];
  if (summary.usage) analysis.ai = { ...analysis.ai, usage: summary.usage };
}
