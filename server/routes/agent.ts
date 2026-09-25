import express, { Router, type Request, type Response } from "express";
import type { ProviderId } from "@shared/llm";
import type { AgentBlueprint, AgentConfig, AgentEvent, AgentRunRecord, AgentServiceStatus, DescribeAgentBody, ResolveApprovalBody, StartAgentRunBody, TerminationReason } from "@shared/agent";
import { AGENT_LIMITS, AGENT_SCENARIOS, DEFAULT_AGENT_CONFIG } from "../../shared/agent";
import { AgentRunner } from "../agent/AgentRunner";
import { analyzeDescription, refineWithModel } from "../agent/blueprint";
import { analyzeAgentCode, narrateReport } from "../agent/codeAnalyzer";
import type { AnalyzeCodeBody, AnalyzeRepoBody, CodeFile } from "@shared/agentReport";
import { CODE_ANALYSIS_LIMITS } from "../../shared/agentReport";
import { GitHubClient, GitHubError, parseGitHubUrl } from "../analyzer/github";
import { createAgentModel } from "../agent/models";
import { AgentSessionStore } from "../agent/session";
import { buildToolset, describeTools, isBuiltinToolId, sanitizeCustomTool } from "../agent/tools";
import type { ServerConfig } from "../lib/config";
import type { HistoryStore } from "../lib/history";
import { readSessionKeys } from "../lib/sessionKeys";
import { SSEWriter } from "../lib/sse";
import type { KnowledgeBaseStore } from "../rag/KnowledgeBase";
import { ProviderNotConfiguredError } from "../providers/types";
import type { ProviderRegistry } from "../providers/registry";
import { sanitize } from "./llm";

interface Deps {
  getConfig: () => ServerConfig;
  getRegistry: () => ProviderRegistry;
  knowledgeBases: KnowledgeBaseStore;
  history?: HistoryStore;
}

const PROVIDERS: ProviderId[] = ["claude", "openai", "gemini", "mock"];
const RUN_RETENTION_MS = 30 * 60 * 1000;

interface LiveRun {
  runner: AgentRunner;
  record: AgentRunRecord;
  abort: AbortController;
}

/** Clamps and fills a partial config from the browser. Unknown tool ids are dropped rather than rejected. */
export function sanitizeAgentConfig(partial: Partial<AgentConfig> | undefined, knowledgeBases: KnowledgeBaseStore | null): AgentConfig {
  const p = partial ?? {};
  const customTools = (Array.isArray(p.customTools) ? p.customTools : []).map(sanitizeCustomTool).filter((c): c is NonNullable<typeof c> => c !== null).slice(0, AGENT_LIMITS.maxCustomTools);
  const customIds = new Set(customTools.map((c) => `custom:${c.slug}`));
  const known = (id: unknown): id is string => typeof id === "string" && (isBuiltinToolId(id) || customIds.has(id));
  const ragKbId = typeof p.ragKbId === "string" && knowledgeBases?.get(p.ragKbId) ? p.ragKbId : null;
  const fallbacks: Record<string, string> = {};
  if (p.fallbacks && typeof p.fallbacks === "object") for (const [from, to] of Object.entries(p.fallbacks)) if (known(from) && known(to) && from !== to) fallbacks[from] = to;
  const retry = p.retry && typeof p.retry === "object" ? p.retry : DEFAULT_AGENT_CONFIG.retry;
  return {
    llmProvider: PROVIDERS.includes(p.llmProvider as ProviderId) ? (p.llmProvider as ProviderId) : DEFAULT_AGENT_CONFIG.llmProvider,
    tools: Array.isArray(p.tools) ? [...new Set(p.tools.filter(known))] : [...DEFAULT_AGENT_CONFIG.tools],
    customTools,
    maxIterations: clampInt(p.maxIterations, 1, AGENT_LIMITS.maxIterations, DEFAULT_AGENT_CONFIG.maxIterations),
    parallelToolCalls: p.parallelToolCalls === undefined ? DEFAULT_AGENT_CONFIG.parallelToolCalls : Boolean(p.parallelToolCalls),
    retry: { maxAttempts: clampInt(retry.maxAttempts, 1, 5, DEFAULT_AGENT_CONFIG.retry.maxAttempts), backoffMs: clampInt(retry.backoffMs, 0, 5000, DEFAULT_AGENT_CONFIG.retry.backoffMs) },
    approvalRequired: Array.isArray(p.approvalRequired) ? [...new Set(p.approvalRequired.filter(known))] : [],
    fallbacks,
    ragKbId,
    tokenBudget: p.tokenBudget === null || p.tokenBudget === undefined ? null : clampInt(p.tokenBudget, 500, 500_000, 20_000),
    timeoutMs: clampInt(p.timeoutMs, 10_000, 600_000, DEFAULT_AGENT_CONFIG.timeoutMs),
    temperature: clampNumber(p.temperature, 0, 2, DEFAULT_AGENT_CONFIG.temperature),
    maxOutputTokens: clampInt(p.maxOutputTokens, 64, 4096, DEFAULT_AGENT_CONFIG.maxOutputTokens),
    systemPrompt: typeof p.systemPrompt === "string" ? p.systemPrompt.slice(0, AGENT_LIMITS.maxSystemPromptChars) : "",
    unreliableFailures: clampInt(p.unreliableFailures, 0, 6, DEFAULT_AGENT_CONFIG.unreliableFailures),
  };
}

/** Source files first, then configs and docs, so the repo cap keeps what the analyzer needs. */
function sourceRank(path: string): number {
  if (/(^|\/)(node_modules|dist|build|vendor|\.git)\//.test(path)) return 0;
  if (/\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb|php|cs)$/i.test(path)) return 3;
  if (/(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|\.env\.example)$/.test(path)) return 2;
  if (/\.(md|ya?ml|toml|json)$/i.test(path)) return 1;
  return 0;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function createAgentRouter({ getConfig, getRegistry, knowledgeBases, history }: Deps): Router {
  const router = Router();
  const sessions = new AgentSessionStore();
  const runs = new Map<string, LiveRun>();
  let counter = 0;

  const sweep = () => {
    const cutoff = Date.now() - RUN_RETENTION_MS;
    for (const [id, r] of runs) if (r.record.finished && r.record.at < cutoff) runs.delete(id);
  };

  router.get("/status", (req, res) => {
    const keys = readSessionKeys(req);
    const descriptors = getRegistry().describeAll();
    const kbId = typeof req.query.kb === "string" ? req.query.kb : null;
    const status: AgentServiceStatus = {
      providers: descriptors.map((p) => ({
        id: p.id,
        name: p.name,
        vendor: p.vendor,
        model: p.model,
        configured: p.configured || Boolean(p.id === "claude" ? keys.anthropic : p.id === "openai" ? keys.openai : p.id === "gemini" ? keys.google : false),
        mock: Boolean(p.mock),
      })),
      tools: describeTools({ ragKbId: kbId && knowledgeBases.get(kbId) ? kbId : null, customTools: [] }, knowledgeBases),
      scenarios: AGENT_SCENARIOS,
      limits: AGENT_LIMITS,
    };
    res.json(status);
  });

  router.get("/session/:id", (req, res) => {
    const s = sessions.get(String(req.params.id));
    res.json({ memory: s.memoryEntries(), files: s.fileNames().map((n) => ({ path: n, chars: s.readFile(n)!.length })) });
  });

  router.get("/session/:id/files/:name", (req, res) => {
    const s = sessions.get(String(req.params.id));
    const text = s.readFile(String(req.params.name));
    if (text === undefined) {
      res.status(404).json({ error: "No such file." });
      return;
    }
    res.json({ path: req.params.name, text });
  });

  router.delete("/session/:id", (req, res) => {
    const s = sessions.get(String(req.params.id));
    s.memory.clear();
    for (const name of s.fileNames()) if (name !== "README.md") s.deleteFile(name);
    res.json({ ok: true });
  });

  /**
   * Turns a plain-language description into a configuration. The rule analyzer
   * always answers; a configured, non-mock provider may refine it, and code
   * validates whatever it proposes.
   */
  router.post("/blueprint", express.json({ limit: "32kb" }), async (req, res) => {
    const body = req.body as Partial<DescribeAgentBody> | undefined;
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    if (!description) {
      res.status(400).json({ error: "Describe the agent in a sentence or two first." });
      return;
    }
    if (description.length > AGENT_LIMITS.maxGoalChars) {
      res.status(400).json({ error: `Descriptions are limited to ${AGENT_LIMITS.maxGoalChars} characters.` });
      return;
    }
    const kbId = typeof req.query.kb === "string" ? req.query.kb : null;
    const kb = kbId ? knowledgeBases.get(kbId)?.snapshot() : undefined;
    const rules = analyzeDescription(description, { knowledgeBaseAvailable: Boolean(kb && kb.documents.length > 0 && kb.index && !kb.stale) });
    const providerId = PROVIDERS.includes(body?.llmProvider as ProviderId) ? (body!.llmProvider as ProviderId) : null;
    const serverConfig = getConfig();
    const keys = readSessionKeys(req);
    const { hits: _hits, ...ruleBlueprint } = rules;
    let blueprint: AgentBlueprint = { ...ruleBlueprint, source: "rules" };
    if (providerId && providerId !== "mock") {
      try {
        const model = createAgentModel(providerId, serverConfig, { anthropic: keys.anthropic, anthropicWorkspace: keys.anthropicWorkspace, openai: keys.openai, google: keys.google });
        const catalogue = describeTools({ ragKbId: kb ? kbId : null, customTools: [] }, knowledgeBases).filter((t) => t.available || t.id === "rag_retrieve").map((t) => ({ id: t.id, description: t.description, source: t.source }));
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        blueprint = await refineWithModel(description, rules, model, catalogue, abort.signal);
      } catch (err) {
        if (!(err instanceof ProviderNotConfiguredError)) blueprint = { ...blueprint, warnings: [...blueprint.warnings, `The model could not refine the plan (${sanitize(err instanceof Error ? err.message : String(err))}); the rule analyzer's plan is used.`] };
      }
    }
    console.log(`[api] agent blueprint (${description.length} chars, ${blueprint.source}, ${blueprint.tools.length} tools)`);
    res.json({ blueprint, hits: rules.hits });
  });

  /**
   * Static analysis of an uploaded agent backend. Files are read once, in
   * memory, never executed, never logged and never kept after the response.
   * A configured provider may write the narrative from the report's facts.
   */
  router.post("/code/analyze", express.json({ limit: "12mb" }), async (req, res) => {
    const body = req.body as Partial<AnalyzeCodeBody> | undefined;
    const files = Array.isArray(body?.files) ? (body!.files as CodeFile[]).filter((f) => f && typeof f.path === "string" && typeof f.content === "string") : [];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one source file." });
      return;
    }
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "upload";
    console.log(`[api] agent code analysis (${files.length} files, upload)`);
    const report = analyzeAgentCode(files, { kind: "upload", name });
    res.json({ report: await maybeNarrate(report, body?.llmProvider, req, res) });
  });

  /** The same analysis over a public GitHub repository (or a private one with the person's token). */
  router.post("/code/github", express.json({ limit: "16kb" }), async (req, res) => {
    const body = req.body as Partial<AnalyzeRepoBody> | undefined;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      res.status(400).json({ error: "A GitHub repository URL is required." });
      return;
    }
    const keys = readSessionKeys(req);
    const github = new GitHubClient(keys.github ?? getConfig().github.token);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const ref = parseGitHubUrl(url);
      const meta = await github.getRepo(ref, abort.signal);
      const tree = await github.getTree(ref, meta.requestedRef, abort.signal);
      const blobs = tree.entries.filter((e) => e.type === "blob" && (e.size ?? 0) <= CODE_ANALYSIS_LIMITS.maxFileBytes);
      // Prefer source over everything else so the cap lands on what matters.
      const ranked = blobs.sort((a, b) => sourceRank(b.path) - sourceRank(a.path)).slice(0, CODE_ANALYSIS_LIMITS.maxRepoFiles);
      const files: CodeFile[] = [];
      const queue = [...ranked];
      const worker = async () => {
        while (queue.length) {
          const entry = queue.shift()!;
          const text = await github.getRawFile(ref, tree.sha, entry.path, CODE_ANALYSIS_LIMITS.maxFileBytes, abort.signal).catch(() => null);
          if (text !== null) files.push({ path: entry.path, content: text });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      console.log(`[api] agent code analysis (${files.length} files, github ${ref.owner}/${ref.repo})`);
      const report = analyzeAgentCode(files, { kind: "github", name: meta.fullName });
      if (tree.truncated) report.warnings.unshift("GitHub truncated the file listing for this large repository; the analysis covers the returned subset.");
      res.json({ report: await maybeNarrate(report, body?.llmProvider, req, res) });
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof GitHubError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message, hint: err.hint });
        return;
      }
      res.status(500).json({ error: sanitize(err instanceof Error ? err.message : String(err)) });
    }
  });

  async function maybeNarrate(report: Awaited<ReturnType<typeof analyzeAgentCode>>, providerRaw: unknown, req: Request, res: Response) {
    const providerId = PROVIDERS.includes(providerRaw as ProviderId) ? (providerRaw as ProviderId) : null;
    if (!providerId || providerId === "mock" || report.verdict === "not-agent") return report;
    try {
      const keys = readSessionKeys(req);
      const model = createAgentModel(providerId, getConfig(), { anthropic: keys.anthropic, anthropicWorkspace: keys.anthropicWorkspace, openai: keys.openai, google: keys.google });
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      return { ...report, narrative: await narrateReport(report, model, abort.signal) };
    } catch {
      return report;
    }
  }

  /** Starts a run and streams its events. */
  router.post("/runs", express.json({ limit: "64kb" }), async (req, res) => {
    sweep();
    const body = req.body as Partial<StartAgentRunBody> | undefined;
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      res.status(400).json({ error: "A goal is required." });
      return;
    }
    if (goal.length > AGENT_LIMITS.maxGoalChars) {
      res.status(400).json({ error: `Goals are limited to ${AGENT_LIMITS.maxGoalChars} characters.` });
      return;
    }
    const sessionId = typeof body?.sessionId === "string" && /^[\w-]{4,80}$/.test(body.sessionId) ? body.sessionId : "anonymous";
    const scenarioId = typeof body?.scenarioId === "string" && AGENT_SCENARIOS.some((s) => s.id === body.scenarioId) ? body.scenarioId : null;
    const config = sanitizeAgentConfig(body?.config, knowledgeBases);
    const serverConfig = getConfig();
    const keys = readSessionKeys(req);

    let model;
    try {
      model = createAgentModel(config.llmProvider, serverConfig, { anthropic: keys.anthropic, anthropicWorkspace: keys.anthropicWorkspace, openai: keys.openai, google: keys.google });
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        res.status(400).json({ error: `${err.message} Add a key in Settings, or pick a configured provider.` });
        return;
      }
      throw err;
    }

    const runId = `agent-${++counter}-${Date.now().toString(36)}`;
    const session = sessions.get(sessionId);
    const tools = buildToolset(config, knowledgeBases);
    const sse = new SSEWriter<AgentEvent>(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const record: AgentRunRecord = { runId, sessionId, at: Date.now(), goal, config, scenarioId, events: [], finished: false, reason: null };
    const emit = (e: AgentEvent) => {
      record.events.push(e);
      if (record.events.length > 2000) record.events.splice(0, record.events.length - 2000);
      sse.send(e);
    };
    const runner = new AgentRunner({
      runId,
      goal,
      config,
      scenarioId,
      model,
      tools,
      session,
      keys: { openai: keys.openai ?? serverConfig.openai.apiKey, google: keys.google ?? serverConfig.google.apiKey, anthropic: keys.anthropic, anthropicWorkspace: keys.anthropicWorkspace },
      knowledgeBases,
      emit,
      signal: abort.signal,
    });
    runs.set(runId, { runner, record, abort });
    console.log(`[api] agent run ${runId} start (${config.llmProvider}, ${tools.length} tools, ${goal.length} chars${scenarioId ? `, scenario ${scenarioId}` : ""})`);
    const startedAt = Date.now();
    let outcome: Awaited<ReturnType<AgentRunner["run"]>> | undefined;
    let reason: TerminationReason = "error";
    try {
      outcome = await runner.run();
      reason = outcome.reason;
    } catch (err) {
      if (!abort.signal.aborted) emit({ type: "error", at: Date.now(), message: sanitize(err instanceof Error ? err.message : String(err)), retryable: false });
    } finally {
      record.finished = true;
      record.reason = reason;
      sse.end();
      console.log(`[api] agent run ${runId} ${reason} in ${Date.now() - startedAt} ms`);
      const descriptor = getRegistry().get(config.llmProvider)?.describe();
      history?.record({
        kind: "agent_run",
        at: startedAt,
        ok: reason === "completed" || reason === "max_iterations",
        error: reason === "error" ? (record.events.find((e) => e.type === "error") as { message?: string } | undefined)?.message?.slice(0, 200) : undefined,
        durationMs: Date.now() - startedAt,
        provider: config.llmProvider,
        vendor: descriptor?.vendor ?? model.vendor,
        model: model.model,
        mock: model.mock,
        goalChars: goal.length,
        scenarioId,
        tools: tools.map((t) => t.descriptor.name),
        iterations: outcome?.iterations ?? 0,
        toolCalls: outcome?.toolCalls ?? 0,
        errors: outcome?.errors ?? 0,
        retries: outcome?.retries ?? 0,
        reason,
        inputTokens: outcome?.usage.inputTokens,
        outputTokens: outcome?.usage.outputTokens,
        totalTokens: outcome?.usage.totalTokens,
      });
    }
  });

  router.get("/runs/:id", (req, res) => {
    const run = runs.get(String(req.params.id));
    if (!run) {
      res.status(404).json({ error: "That run has expired or does not exist." });
      return;
    }
    res.json({ run: run.record, pending: run.runner.pendingHuman() });
  });

  /** A human approves or rejects a gated tool call, or answers ask_human. */
  router.post("/runs/:id/approvals/:callId", express.json({ limit: "16kb" }), (req, res) => {
    const run = runs.get(String(req.params.id));
    if (!run) {
      res.status(404).json({ error: "That run has expired or does not exist." });
      return;
    }
    const body = req.body as Partial<ResolveApprovalBody> | undefined;
    const approved = Boolean(body?.approved);
    const input = typeof body?.input === "string" ? body.input.slice(0, 2000) : null;
    if (!run.runner.resolveHuman(String(req.params.callId), approved, input)) {
      res.status(409).json({ error: "Nothing is waiting for a decision on that call." });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/runs/:id/stop", (req, res) => {
    const run = runs.get(String(req.params.id));
    if (!run) {
      res.status(404).json({ error: "That run has expired or does not exist." });
      return;
    }
    run.abort.abort();
    res.json({ ok: true });
  });

  return router;
}

export type { Request, Response };
