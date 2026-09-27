import { Router, type Request, type Response } from "express";
import type { AgentEvent } from "@shared/agent";
import type { ProviderId } from "@shared/llm";
import type { AnalyzeEvent, AnalyzeRequestBody, AskRequestBody, InvestigateRequestBody, RepoAnalysis, RepoServiceStatus, SummarizeRequestBody, SummarizeResult, TraceResult } from "@shared/repo";
import { createAgentModel } from "../agent/models";
import type { RunOutcome } from "../agent/AgentRunner";
import type { AgentModel } from "../agent/types";
import { PRIVATE_DENIED, PrivateRepoAccess } from "../analyzer/access";
import { AiAnalyzer } from "../analyzer/ai";
import { analyzeRepository, applySummary } from "../analyzer/analyzer";
import { AnalysisCache, ContentCache } from "../analyzer/cache";
import { investigateRepository, OfflineInvestigatorModel, RepoWorkspace } from "../analyzer/investigator";
import { GitHubClient, GitHubError } from "../analyzer/github";
import { LIMITS } from "../analyzer/select";
import { heuristicTrace } from "../analyzer/tracer";
import type { ServerConfig } from "../lib/config";
import { friendlyApiError } from "../lib/apiErrors";
import type { HistoryStore } from "../lib/history";
import { readSessionKeys } from "../lib/sessionKeys";
import { SSEWriter } from "../lib/sse";
import { ProviderNotConfiguredError } from "../providers/types";
import { sanitize } from "./llm";

const INVESTIGATOR_PROVIDERS: ProviderId[] = ["claude", "openai", "gemini", "mock"];
/** Each investigation spends a model key for minutes; these cap how many run at once. */
const MAX_INVESTIGATIONS_PER_CLIENT = 2;
const MAX_INVESTIGATIONS = 4;

export function createRepoRouter(getConfig: () => ServerConfig, history?: HistoryStore): Router {
  const router = Router();
  const cache = new AnalysisCache();
  const contents = new ContentCache();
  const investigations = new Map<string, AbortController>();
  const runningByClient = new Map<string, number>();
  let traceCounter = 0;
  let investigationCounter = 0;
  const access = new PrivateRepoAccess();
  /** Answers 403 and returns false when this request's token cannot read a private analysis. */
  const mayRead = async (req: Request, res: Response, analysis: RepoAnalysis): Promise<boolean> => {
    const { github, githubToken } = clientsFor(req);
    if (await access.canRead(analysis, github, githubToken)) return true;
    res.status(403).json({ error: PRIVATE_DENIED });
    return false;
  };
  /** Per-request clients: current server config (re-read when .env changes) plus any session keys from the browser. */
  const clientsFor = (req: Request) => {
    const config = getConfig();
    const keys = readSessionKeys(req);
    return {
      github: new GitHubClient(keys.github ?? config.github.token),
      ai: new AiAnalyzer({ apiKey: keys.anthropic ?? config.anthropic.apiKey, model: config.anthropic.model, workspaceId: keys.anthropicWorkspace ?? config.anthropic.workspaceId }),
      githubToken: keys.github ?? config.github.token,
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
      const analysis = await analyzeRepository(body.url, { github, ai, emit, signal: abort.signal, skipAi: body.withAi !== true, onContents: (id, texts) => contents.set(id, texts) });
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
    if (!(await mayRead(req, res, analysis))) return;
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

  router.get("/analysis/:id", async (req: Request, res: Response) => {
    const analysis = cache.get(String(req.params.id));
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found or expired. Analyze the repository again." });
      return;
    }
    if (!(await mayRead(req, res, analysis))) return;
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
    if (!(await mayRead(req, res, analysis))) return;
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

  /**
   * Starts the investigator agent on an analysis and streams its run as agent
   * events. The scan's facts and file texts are its starting point; the agent
   * reads further through tools that redact secrets, and code checks every
   * citation in its answer before the run completes.
   */
  router.post("/investigate", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<InvestigateRequestBody>;
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (typeof body.analysisId !== "string" || !question) {
      res.status(400).json({ error: "analysisId and question are required." });
      return;
    }
    if (question.length > 600) {
      res.status(400).json({ error: "Question is too long (max 600 characters)." });
      return;
    }
    const analysis = cache.get(body.analysisId);
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found or expired. Analyze the repository again." });
      return;
    }
    if (!(await mayRead(req, res, analysis))) return;
    const provider: ProviderId = INVESTIGATOR_PROVIDERS.includes(body.llmProvider as ProviderId) ? (body.llmProvider as ProviderId) : "mock";
    const keys = readSessionKeys(req);
    let model: AgentModel;
    try {
      // The offline planner needs no key and is always offered: it is how the loop is seen without one.
      model = provider === "mock" ? new OfflineInvestigatorModel(analysis, question) : createAgentModel(provider, getConfig(), { anthropic: keys.anthropic, anthropicWorkspace: keys.anthropicWorkspace, openai: keys.openai, google: keys.google });
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        res.status(400).json({ error: `${err.message} Add a key in Settings, or use the offline planner.` });
        return;
      }
      throw err;
    }

    const client = req.socket.remoteAddress ?? "unknown";
    if ((runningByClient.get(client) ?? 0) >= MAX_INVESTIGATIONS_PER_CLIENT || investigations.size >= MAX_INVESTIGATIONS) {
      res.status(429).json({ error: `Too many investigations are running (at most ${MAX_INVESTIGATIONS_PER_CLIENT} at a time from one browser). Wait for one to finish or stop it.` });
      return;
    }
    runningByClient.set(client, (runningByClient.get(client) ?? 0) + 1);

    const runId = `investigate-${++investigationCounter}-${Date.now().toString(36)}`;
    const { github } = clientsFor(req);
    const scanned = contents.get(analysis.id);
    const workspace = new RepoWorkspace(analysis, scanned ?? null, github);
    const sse = new SSEWriter<AgentEvent>(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    investigations.set(runId, abort);
    const startedAt = Date.now();
    let evidence: { verified: number; total: number } | null = null;
    const emit = (e: AgentEvent) => {
      if (e.type === "evidence_checked") evidence = { verified: e.verified, total: e.total };
      sse.send(e);
      if (e.type === "run_started" && !scanned) sse.send({ type: "notice", at: Date.now(), level: "warn", message: "The scan's file texts have left server memory, so search_code starts empty and covers only the files the agent opens." });
    };
    console.log(`[repo] investigate ${runId} start ${analysis.id} (${model.id}${model.mock ? ", offline" : ""}, ${workspace.loadedPaths().length} files loaded)`);
    let outcome: RunOutcome | undefined;
    try {
      const run = await investigateRepository({ runId, question, workspace, model, emit, signal: abort.signal });
      outcome = await run.done;
    } catch (err) {
      if (!abort.signal.aborted) sse.send({ type: "error", at: Date.now(), message: sanitize(err instanceof Error ? err.message : String(err)), retryable: false });
    } finally {
      investigations.delete(runId);
      const left = (runningByClient.get(client) ?? 1) - 1;
      if (left > 0) runningByClient.set(client, left);
      else runningByClient.delete(client);
      sse.end();
      const checked = evidence as { verified: number; total: number } | null;
      console.log(`[repo] investigate ${runId} ${outcome?.reason ?? "error"} in ${Date.now() - startedAt} ms · ${outcome?.toolCalls ?? 0} tool calls · citations ${checked ? `${checked.verified}/${checked.total} verified` : "none"}`);
      history?.record({
        kind: "repo_ask", at: startedAt, ok: outcome?.reason === "completed" || outcome?.reason === "max_iterations" || outcome?.reason === "token_budget",
        durationMs: Date.now() - startedAt, analysisId: analysis.id, repo: analysis.meta.fullName, model: model.model,
        question: question.slice(0, 300), source: model.mock ? "heuristic" : "ai", steps: outcome?.toolCalls ?? 0,
      });
    }
  });

  router.post("/investigate/:id/stop", (req: Request, res: Response) => {
    const abort = investigations.get(String(req.params.id));
    if (!abort) {
      res.status(404).json({ error: "That investigation has finished or does not exist." });
      return;
    }
    abort.abort();
    res.json({ ok: true });
  });

  return router;
}
