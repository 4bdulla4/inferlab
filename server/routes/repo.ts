import { Router, type Request, type Response } from "express";
import type { AnalyzeEvent, AnalyzeRequestBody, AskRequestBody, RepoServiceStatus, SummarizeRequestBody, SummarizeResult, TraceResult } from "@shared/repo";
import { AiAnalyzer } from "../analyzer/ai";
import { analyzeRepository, applySummary } from "../analyzer/analyzer";
import { AnalysisCache } from "../analyzer/cache";
import { GitHubClient, GitHubError } from "../analyzer/github";
import { LIMITS } from "../analyzer/select";
import { heuristicTrace } from "../analyzer/tracer";
import type { ServerConfig } from "../lib/config";
import { friendlyApiError } from "../lib/apiErrors";
import type { HistoryStore } from "../lib/history";
import { readSessionKeys } from "../lib/sessionKeys";

export function createRepoRouter(getConfig: () => ServerConfig, history?: HistoryStore): Router {
  const router = Router();
  const cache = new AnalysisCache();
  let traceCounter = 0;
  /** Per-request clients: current server config (re-read when .env changes) plus any session keys from the browser. */
  const clientsFor = (req: Request) => {
    const config = getConfig();
    const keys = readSessionKeys(req);
    return {
      github: new GitHubClient(keys.github ?? config.github.token),
      ai: new AiAnalyzer({ apiKey: keys.anthropic ?? config.anthropic.apiKey, model: config.anthropic.model, workspaceId: keys.anthropicWorkspace ?? config.anthropic.workspaceId }),
      githubTokenConfigured: Boolean(config.github.token || keys.github),
      session: Boolean(keys.github || keys.anthropic),
    };
  };

  router.get("/status", (req: Request, res: Response) => {
    const { ai, githubTokenConfigured } = clientsFor(req);
    const status: RepoServiceStatus = {
      githubTokenConfigured,
      ai: ai.status(),
      limits: { maxFiles: LIMITS.maxFiles, maxFileBytes: LIMITS.maxFileBytes, maxTotalBytes: LIMITS.maxTotalBytes },
    };
    res.json(status);
  });

  router.post("/analyze", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<AnalyzeRequestBody>;
    if (typeof body.url !== "string" || body.url.trim().length === 0 || body.url.length > 500) {
      res.status(400).json({ error: "A GitHub repository URL is required." });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    const emit = (event: AnalyzeEvent) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const startedAt = Date.now();
    const { github, ai, session } = clientsFor(req);
    console.log(`[repo] analyze start ${body.url.trim()}${session ? " (session keys)" : ""}`);
    try {
      const analysis = await analyzeRepository(body.url, { github, ai, emit, signal: abort.signal, skipAi: body.withAi !== true });
      cache.set(analysis);
      emit({ type: "analysis", at: Date.now(), analysis });
      console.log(`[repo] analyze ok ${analysis.id} files=${analysis.stats.scannedFiles} nodes=${analysis.graph.nodes.length} in ${Date.now() - startedAt} ms`);
      history?.record({
        kind: "repo_analysis",
        at: startedAt,
        ok: true,
        durationMs: analysis.durationMs,
        analysisId: analysis.id,
        repo: analysis.meta.fullName,
        url: analysis.meta.htmlUrl,
        sha: analysis.meta.sha,
        isPrivate: analysis.meta.isPrivate,
        headline: analysis.overview.headline,
        stack: analysis.overview.stack,
        filesScanned: analysis.stats.scannedFiles,
        filesTotal: analysis.stats.totalFiles,
        bytesRead: analysis.stats.bytesRead,
        loc: analysis.stats.totalLoc,
        nodes: analysis.graph.nodes.length,
        edges: analysis.graph.edges.length,
        routes: analysis.routes.length,
        models: analysis.schema.length,
        envVars: analysis.envVars.length,
        deps: analysis.dependencies.length,
        jobs: analysis.jobs.length,
        infra: analysis.infra.length,
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        const status = err instanceof GitHubError ? err.status : ((err as { status?: number }).status ?? 500);
        const hint = err instanceof GitHubError ? err.hint : (err as { hint?: string }).hint;
        const base = err instanceof Error ? err.message : "Analysis failed.";
        const message = hint ? `${base}\n\n${hint}` : base;
        emit({ type: "error", at: Date.now(), message: message.slice(0, 600), status });
        console.log(`[repo] analyze error ${status}: ${message.slice(0, 120)}`);
        history?.record({
          kind: "repo_analysis", at: startedAt, ok: false, error: base.slice(0, 200), durationMs: Date.now() - startedAt,
          analysisId: "", repo: body.url!.replace(/^https?:\/\/github\.com\//, "").slice(0, 120), url: body.url!, sha: "", isPrivate: false,
          headline: "", stack: [], filesScanned: 0, filesTotal: 0, bytesRead: 0, loc: 0, nodes: 0, edges: 0, routes: 0, models: 0, envVars: 0, deps: 0, jobs: 0, infra: 0,
        });
      }
    } finally {
      clearInterval(heartbeat);
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
  });

  /** On-demand model summaries (opt-in, one call per analysis). */
  router.post("/summarize", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<SummarizeRequestBody>;
    const analysis = typeof body.analysisId === "string" ? cache.get(body.analysisId) : undefined;
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found or expired. Analyze the repository again." });
      return;
    }
    const { ai } = clientsFor(req);
    if (!ai.status().available) {
      res.status(400).json({ error: "No Anthropic key available. Add one in Settings → API keys or on the server." });
      return;
    }
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const startedAt = Date.now();
    try {
      const summary = await ai.summarize(analysis, abort.signal);
      if (!summary) {
        res.status(502).json({ error: "The model returned no usable summary." });
        return;
      }
      applySummary(analysis, summary);
      analysis.ai = { ...ai.status(), usage: summary.usage };
      const result: SummarizeResult = { overview: analysis.overview, nodes: analysis.graph.nodes.filter((n) => n.aiSummary).map((n) => ({ id: n.id, aiSummary: n.aiSummary! })), ai: analysis.ai };
      console.log(`[repo] summarize ${analysis.id} in=${summary.usage.inputTokens} cached=${summary.usage.cacheReadTokens} out=${summary.usage.outputTokens}`);
      history?.record({ kind: "repo_summarize", at: startedAt, ok: true, durationMs: Date.now() - startedAt, analysisId: analysis.id, repo: analysis.meta.fullName, model: analysis.ai.model, usage: summary.usage });
      res.json(result);
    } catch (err) {
      if (abort.signal.aborted) return;
      const f = friendlyApiError(err, "Anthropic");
      history?.record({ kind: "repo_summarize", at: startedAt, ok: false, error: f.message.slice(0, 200), durationMs: Date.now() - startedAt, analysisId: analysis.id, repo: analysis.meta.fullName });
      res.status(f.status && f.status >= 400 && f.status < 600 ? f.status : 502).json({ error: f.hint ? `${f.message} ${f.hint}` : f.message });
    }
  });

  router.get("/analysis/:id", (req: Request, res: Response) => {
    const analysis = cache.get(String(req.params.id));
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found or expired. Analyze the repository again." });
      return;
    }
    res.json(analysis);
  });

  router.post("/ask", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<AskRequestBody>;
    if (typeof body.analysisId !== "string" || typeof body.question !== "string" || body.question.trim().length === 0) {
      res.status(400).json({ error: "analysisId and question are required." });
      return;
    }
    if (body.question.length > 600) {
      res.status(400).json({ error: "Question is too long (max 600 characters)." });
      return;
    }
    const analysis = cache.get(body.analysisId);
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found or expired. Analyze the repository again." });
      return;
    }
    const id = `trace-${++traceCounter}-${Date.now().toString(36)}`;
    const askStartedAt = Date.now();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let result: TraceResult | null = null;
    const notes: string[] = [];
    const { ai } = clientsFor(req);
    if (ai.status().available) {
      try {
        result = await ai.trace(analysis, body.question, id, abort.signal);
        if (!result) notes.push("The model returned no usable trace; fell back to the heuristic tracer.");
      } catch (err) {
        if (abort.signal.aborted) return;
        const f = friendlyApiError(err, "Anthropic");
        notes.push(`AI trace failed (${f.message.slice(0, 160)}${f.hint ? ` ${f.hint}` : ""}); fell back to the heuristic tracer.`);
      }
    }
    if (!result) {
      result = heuristicTrace(analysis, body.question, id);
      result.notes.unshift(...notes);
    }
    console.log(`[repo] ask ${analysis.id} source=${result.source} steps=${result.steps.length}${result.usage ? ` in=${result.usage.inputTokens} cached=${result.usage.cacheReadTokens} out=${result.usage.outputTokens}` : ""}`);
    history?.record({
      kind: "repo_ask", at: askStartedAt, ok: true, durationMs: Date.now() - askStartedAt,
      analysisId: analysis.id, repo: analysis.meta.fullName, model: result.model,
      question: body.question!.slice(0, 300), source: result.source, steps: result.steps.length, confidence: result.confidence, usage: result.usage,
    });
    res.json(result);
  });

  return router;
}
