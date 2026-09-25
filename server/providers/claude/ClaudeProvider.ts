import Anthropic from "@anthropic-ai/sdk";
import type {
  PreparedRequestSummary,
  ProviderCapabilities,
  ProviderDescriptor,
  UsageInfo,
} from "@shared/llm";
import { describeApiError } from "../../lib/apiErrors";
import { approximateTokenization } from "../../lib/tokenizer";
import {
  ProviderNotConfiguredError,
  now,
  type LLMProvider,
  type ProviderRunContext,
} from "../types";

const DEFAULT_SYSTEM =
  "You are a helpful assistant. Answer clearly and concisely for a general audience.";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

interface ClaudeModelProfile {
  /** Model accepts temperature / top_p / top_k. Removed on Opus 4.7+, Sonnet 5, Fable. */
  temperature: boolean;
  /** Model supports `thinking: { type: "adaptive" }`. */
  adaptiveThinking: boolean;
  /** Model supports `output_config.effort`. */
  effort: boolean;
}

/**
 * Conservative capability profile derived from the model id. New model ids
 * default to the current-generation surface (no sampling params, adaptive
 * thinking, effort control).
 */
export function claudeModelProfile(model: string): ClaudeModelProfile {
  const m = model.toLowerCase();
  const isHaiku = m.includes("haiku");
  const legacySampling = /(haiku|opus-4-6|sonnet-4-6|opus-4-5|sonnet-4-5|-3-)/.test(m);
  return {
    temperature: legacySampling,
    adaptiveThinking: !isHaiku && !/(-3-|4-5)/.test(m),
    effort: !isHaiku && !/(-3-|sonnet-4-5)/.test(m),
  };
}

export interface ClaudeProviderOptions {
  apiKey: string | undefined;
  model: string;
  fallbacks: boolean;
  workspaceId?: string;
}

export function createAnthropicClient(apiKey: string, workspaceId?: string): Anthropic {
  return new Anthropic({ apiKey, defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined, maxRetries: 1 });
}

export class ClaudeProvider implements LLMProvider {
  readonly id = "claude" as const;
  private readonly client: Anthropic | null;

  constructor(private readonly options: ClaudeProviderOptions) {
    this.client = options.apiKey ? createAnthropicClient(options.apiKey, options.workspaceId) : null;
  }

  describe(): ProviderDescriptor {
    const profile = claudeModelProfile(this.options.model);
    const capabilities: ProviderCapabilities = {
      streaming: true,
      temperature: profile.temperature,
      logprobs: false,
      effort: profile.effort,
      exactTokenizer: false,
      inputTokenCount: "live",
      reasoning: profile.adaptiveThinking,
    };
    return {
      id: "claude",
      name: "Claude",
      vendor: "Anthropic",
      model: this.options.model,
      configured: this.client !== null,
      capabilities,
      tokenizerNote:
        "Claude's tokenizer is not public. Token boundaries are approximated with the open o200k_base BPE; the real input token count comes from the Anthropic token-counting endpoint.",
    };
  }

  async run(ctx: ProviderRunContext): Promise<void> {
    const workspaceId = ctx.workspaceIdOverride ?? this.options.workspaceId;
    const client = ctx.apiKeyOverride ? createAnthropicClient(ctx.apiKeyOverride, workspaceId) : ctx.workspaceIdOverride && this.options.apiKey ? createAnthropicClient(this.options.apiKey, workspaceId) : this.client;
    if (!client) throw new ProviderNotConfiguredError("claude", "ANTHROPIC_API_KEY");
    const { message, settings, emit, signal } = ctx;
    const model = this.options.model;
    const profile = claudeModelProfile(model);
    const system = settings.systemPrompt.trim() || DEFAULT_SYSTEM;
    const notes: string[] = [];

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

    const base: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: settings.maxOutputTokens,
      system,
      messages,
    };
    if (profile.temperature) {
      base.temperature = settings.temperature;
    } else {
      notes.push(`${model} does not accept a temperature parameter; it was omitted from the request.`);
    }
    if (profile.adaptiveThinking) {
      base.thinking = { type: "adaptive", display: "summarized" };
      notes.push("Adaptive thinking is enabled; a summarized reasoning phase may stream before the visible answer.");
    }
    if (profile.effort) {
      base.output_config = { effort: "low" };
      notes.push("Effort set to low to keep the demo responsive.");
    }
    let useFallbacks = this.options.fallbacks;
    if (useFallbacks) {
      notes.push("Server-side refusal fallbacks (beta) are enabled: a safety decline is re-run on a fallback model inside the same call.");
    }

    const summary: PreparedRequestSummary = {
      provider: "claude",
      vendor: "Anthropic",
      model,
      system,
      messages: [{ role: "user", content: message }],
      settings: {
        temperature: profile.temperature ? settings.temperature : null,
        maxOutputTokens: settings.maxOutputTokens,
        streaming: settings.streaming,
        thinking: profile.adaptiveThinking ? "adaptive (summarized)" : "off",
        effort: profile.effort ? "low" : undefined,
        logprobs: false,
      },
      notes,
    };
    emit({ type: "request_prepared", at: now(), request: summary });

    // Tokenization: approximate (Claude's tokenizer is private).
    const promptText = `${system}\n\n${message}`;
    void promptText;
    emit({ type: "tokenization", at: now(), result: approximateTokenization(message, "Claude") });

    // Real input token count from the API (includes the system prompt).
    try {
      const count = await client.messages.countTokens({ model, system, messages }, { signal });
      emit({
        type: "input_token_count",
        at: now(),
        count: count.input_tokens,
        source: "live",
        note: "Counted by the Anthropic token-counting endpoint for this exact request (system prompt + user message).",
      });
    } catch (err) {
      if (signal.aborted) throw err;
      emit({
        type: "notice",
        at: now(),
        level: "warn",
        message: `Token counting skipped (${describeApiError(err, "Anthropic")}). The final usage report will still be live.`,
      });
    }

    const sentAt = now();
    emit({ type: "request_sent", at: sentAt });

    const attempt = async (withFallbacks: boolean) => {
      if (settings.streaming) {
        return this.streamOnce(client, base, withFallbacks, sentAt, ctx);
      }
      return this.createOnce(client, base, withFallbacks, sentAt, ctx);
    };

    try {
      await attempt(useFallbacks);
    } catch (err) {
      if (signal.aborted) throw err;
      // Retry without the beta fallbacks parameter only when that parameter is
      // what the API objected to; any other 400 would fail again and cost a second call.
      if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(describeApiError(err, "Anthropic"))) {
        useFallbacks = false;
        emit({
          type: "notice",
          at: now(),
          level: "warn",
          message: `The refusal-fallback beta was rejected (${describeApiError(err, "Anthropic")}). Retrying once without it.`,
        });
        await attempt(false);
        return;
      }
      throw err;
    }
  }

  private async streamOnce(
    client: Anthropic,
    base: Anthropic.MessageCreateParamsNonStreaming,
    withFallbacks: boolean,
    sentAt: number,
    ctx: ProviderRunContext,
  ): Promise<void> {
    const { emit, signal } = ctx;
    const stream = withFallbacks
      ? client.beta.messages.stream(
          { ...base, betas: [FALLBACK_BETA], fallbacks: "default" },
          { signal },
        )
      : client.messages.stream(base, { signal });

    let started = false;
    let firstTokenAt: number | null = null;
    let index = 0;
    let text = "";
    let reasoningAnnounced = false;

    for await (const event of stream) {
      const at = now();
      if (event.type === "message_start") {
        started = true;
        firstTokenAt = at;
        emit({
          type: "response_started",
          at,
          ttfbMs: at - sentAt,
          model: event.message.model,
          responseId: event.message.id,
        });
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "thinking" && !reasoningAnnounced) {
          reasoningAnnounced = true;
          emit({ type: "notice", at, level: "info", message: "Model entered an extended-thinking phase (live)." });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          emit({ type: "reasoning_delta", at, text: event.delta.thinking });
        } else if (event.delta.type === "text_delta" && event.delta.text) {
          text += event.delta.text;
          emit({ type: "text_delta", at, text: event.delta.text, granularity: "chunk", index: index++ });
        }
      }
    }

    const final = await stream.finalMessage();
    const finishedAt = now();
    if (!started) {
      emit({ type: "response_started", at: finishedAt, ttfbMs: finishedAt - sentAt, model: final.model, responseId: final.id });
    }
    if (final.stop_reason === "refusal") {
      const details = (final as unknown as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details;
      emit({
        type: "notice",
        at: finishedAt,
        level: "warn",
        message: `The model declined this request (stop_reason: refusal${details?.category ? `, category: ${details.category}` : ""}).`,
      });
    }
    emit({ type: "usage", at: finishedAt, usage: toUsage(final.usage) });
    emit({
      type: "completed",
      at: finishedAt,
      finishReason: final.stop_reason ?? "unknown",
      latencyMs: finishedAt - sentAt,
      ttfbMs: firstTokenAt ? firstTokenAt - sentAt : null,
      generationMs: firstTokenAt ? finishedAt - firstTokenAt : 0,
      text: text || extractText(final.content),
      model: final.model,
    });
  }

  private async createOnce(
    client: Anthropic,
    base: Anthropic.MessageCreateParamsNonStreaming,
    withFallbacks: boolean,
    sentAt: number,
    ctx: ProviderRunContext,
  ): Promise<void> {
    const { emit, signal } = ctx;
    const final = withFallbacks
      ? await client.beta.messages.create(
          { ...base, betas: [FALLBACK_BETA], fallbacks: "default" },
          { signal },
        )
      : await client.messages.create(base, { signal });
    const at = now();
    emit({ type: "response_started", at, ttfbMs: at - sentAt, model: final.model, responseId: final.id });
    const text = extractText(final.content);
    if (text) emit({ type: "text_delta", at, text, granularity: "chunk", index: 0 });
    emit({ type: "usage", at, usage: toUsage(final.usage) });
    emit({
      type: "completed",
      at,
      finishReason: final.stop_reason ?? "unknown",
      latencyMs: at - sentAt,
      ttfbMs: at - sentAt,
      generationMs: 0,
      text,
      model: final.model,
    });
  }
}

function extractText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): UsageInfo {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
  };
}
