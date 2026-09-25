import { Router, type Request, type Response } from "express";
import type { ChatRequestBody, GenerationSettings, ProviderId, ServerEvent, UsageInfo } from "@shared/llm";
import type { HistoryStore } from "../lib/history";
import { friendlyApiError } from "../lib/apiErrors";
import { readSessionKeys } from "../lib/sessionKeys";
import { SSEWriter } from "../lib/sse";
import type { ProviderRegistry } from "../providers/registry";
import { ProviderNotConfiguredError } from "../providers/types";

const MAX_MESSAGE_CHARS = 8000;

export function validateChatBody(body: unknown): { ok: true; value: ChatRequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Request body must be a JSON object." };
  const b = body as Record<string, unknown>;
  const providers: ProviderId[] = ["claude", "openai", "gemini", "mock"];
  if (typeof b.provider !== "string" || !providers.includes(b.provider as ProviderId)) return { ok: false, error: "Unknown provider." };
  const provider = b.provider as ProviderId;
  if (typeof b.message !== "string" || b.message.trim().length === 0) return { ok: false, error: "Message is required." };
  if (b.message.length > MAX_MESSAGE_CHARS) return { ok: false, error: `Message exceeds ${MAX_MESSAGE_CHARS} characters.` };
  const s = (b.settings ?? {}) as Record<string, unknown>;
  const temperature = clamp(numberOr(s.temperature, 0.7), 0, 2);
  const maxOutputTokens = Math.round(clamp(numberOr(s.maxOutputTokens, 500), 16, 4096));
  const streaming = s.streaming === undefined ? true : Boolean(s.streaming);
  const systemPrompt = typeof s.systemPrompt === "string" ? s.systemPrompt.slice(0, 4000) : "";
  const effort = s.effort === "none" || s.effort === "low" || s.effort === "medium" || s.effort === "high" ? s.effort : "none";
  const settings: GenerationSettings = { temperature, maxOutputTokens, streaming, systemPrompt, effort };
  return { ok: true, value: { provider, message: b.message, settings } };
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function createLLMRouter(getRegistry: () => ProviderRegistry, history?: HistoryStore): Router {
  const router = Router();

  router.get("/providers", (_req: Request, res: Response) => {
    res.json({ providers: getRegistry().describeAll() });
  });

  router.post("/chat", async (req: Request, res: Response) => {
    const parsed = validateChatBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { provider: providerId, message, settings } = parsed.value;
    const provider = getRegistry().get(providerId);
    if (!provider) {
      res.status(400).json({ error: "Unknown provider." });
      return;
    }

    const keys = readSessionKeys(req);
    const apiKeyOverride = providerId === "claude" ? keys.anthropic : providerId === "openai" ? keys.openai : providerId === "gemini" ? keys.google : undefined;
    const sse = new SSEWriter(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const startedAt = Date.now();
    let outcome = "completed";
    const descriptor = provider.describe();
    let usage: UsageInfo | undefined;
    let completed: { finishReason: string; latencyMs: number; ttfbMs: number | null; outputChars: number } | undefined;
    let pieces = 0;
    let failure: string | undefined;
    const emit = (event: ServerEvent) => {
      if (event.type === "error") {
        outcome = `error${event.status ? ` ${event.status}` : ""}`;
        failure = event.message.split("\n")[0]!.slice(0, 200);
      } else if (event.type === "usage") usage = event.usage;
      else if (event.type === "text_delta") pieces += 1;
      else if (event.type === "completed") completed = { finishReason: event.finishReason, latencyMs: event.latencyMs, ttfbMs: event.ttfbMs, outputChars: event.text.length };
      sse.send(event);
    };

    // Access log: provider + outcome only. Never message content or credentials.
    console.log(`[api] chat ${providerId} start (${message.length} chars, stream=${settings.streaming}${apiKeyOverride ? ", session key" : ""})`);
    try {
      await provider.run({ message, settings, emit, signal: abort.signal, apiKeyOverride, workspaceIdOverride: providerId === "claude" ? keys.anthropicWorkspace : undefined });
    } catch (err) {
      if (!abort.signal.aborted) emit(toErrorEvent(err, providerId));
      else outcome = "aborted";
    } finally {
      sse.end();
      console.log(`[api] chat ${providerId} ${outcome} in ${Date.now() - startedAt} ms`);
      history?.record({
        kind: "llm_run",
        at: startedAt,
        ok: outcome === "completed",
        error: failure,
        durationMs: Date.now() - startedAt,
        provider: providerId,
        vendor: descriptor.vendor,
        model: descriptor.model,
        inputChars: message.length,
        outputChars: completed?.outputChars,
        streaming: settings.streaming,
        sessionKey: Boolean(apiKeyOverride),
        latencyMs: completed?.latencyMs,
        ttfbMs: completed?.ttfbMs ?? undefined,
        finishReason: completed?.finishReason,
        inputTokens: usage?.inputTokens ?? undefined,
        outputTokens: usage?.outputTokens ?? undefined,
        totalTokens: usage?.totalTokens ?? undefined,
        streamedPieces: pieces,
      });
    }
  });

  return router;
}

function toErrorEvent(err: unknown, providerId: string): ServerEvent {
  const at = Date.now();
  if (err instanceof ProviderNotConfiguredError) {
    return { type: "error", at, message: err.message, code: "not_configured", retryable: false };
  }
  const f = friendlyApiError(err, providerId === "claude" ? "Anthropic" : providerId === "openai" ? "OpenAI" : providerId);
  const e = err as { code?: string; name?: string };
  const message = sanitize(f.hint ? `${f.message}\n\n${f.hint}` : f.message);
  return { type: "error", at, message, status: f.status, code: e?.code ?? e?.name, retryable: f.retryable };
}

/**
 * Never echo anything that looks like a credential back to the client — not even
 * the masked fragments providers put in their own error messages.
 */
export function sanitize(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_*.-]{6,}/g, "<REDACTED>")
    .replace(/\b(Bearer|x-api-key[:=]?)\s+[A-Za-z0-9._*-]{8,}/gi, "$1 <REDACTED>")
    .replace(/\b(?:key|token)[^\s]*:\s*[A-Za-z0-9*]{4,}\*{4,}[A-Za-z0-9*]*/gi, "<REDACTED>")
    .slice(0, 600);
}
