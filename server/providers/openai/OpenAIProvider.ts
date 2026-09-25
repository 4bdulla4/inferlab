import OpenAI from "openai";
import type {
  PreparedRequestSummary,
  ProviderCapabilities,
  ProviderDescriptor,
  TokenAlternatives,
  UsageInfo,
} from "@shared/llm";
import { exactTokenization } from "../../lib/tokenizer";
import {
  ProviderNotConfiguredError,
  now,
  type LLMProvider,
  type ProviderRunContext,
} from "../types";

const DEFAULT_SYSTEM =
  "You are a helpful assistant. Answer clearly and concisely for a general audience.";

const TOP_LOGPROBS = 5;

type Effort = "none" | "low" | "medium" | "high";

interface OpenAIModelProfile {
  /** Model refuses reasoning.effort = "none" (GPT-6 Astra and the o-series). */
  reasoningOnly: boolean;
  /** Model exposes a reasoning-effort control at all. */
  reasoning: boolean;
}

/**
 * Capability profile from the model id. Per OpenAI's docs, temperature, top_p and
 * top_logprobs are only accepted when reasoning effort is "none", and some models
 * (GPT-6 Astra, the o-series) reject "none" entirely, so they can never return logprobs.
 */
export function openAIModelProfile(model: string): OpenAIModelProfile {
  const m = model.toLowerCase();
  const reasoningOnly = /^o[1-9]/.test(m) || m.startsWith("gpt-6-astra") || m.startsWith("gpt-6a");
  const reasoning = reasoningOnly || /^(gpt-5|gpt-6|o[1-9])/.test(m);
  return { reasoningOnly, reasoning };
}

/** Effort actually sent, given what the model allows. */
export function resolveEffort(model: string, requested: Effort | undefined): Effort {
  const profile = openAIModelProfile(model);
  const effort = requested ?? "none";
  if (effort === "none" && profile.reasoningOnly) return "medium";
  return effort;
}

export interface OpenAIProviderOptions {
  apiKey: string | undefined;
  model: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai" as const;
  private readonly client: OpenAI | null;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.client = options.apiKey ? new OpenAI({ apiKey: options.apiKey }) : null;
  }

  describe(): ProviderDescriptor {
    const profile = openAIModelProfile(this.options.model);
    const capabilities: ProviderCapabilities = {
      streaming: true,
      // Sampling and logprobs are available whenever the model can run at effort "none".
      temperature: !profile.reasoningOnly,
      logprobs: !profile.reasoningOnly,
      effort: profile.reasoning,
      exactTokenizer: true,
      inputTokenCount: "estimate",
      reasoning: profile.reasoning,
    };
    return {
      id: "openai",
      name: "OpenAI",
      vendor: "OpenAI",
      model: this.options.model,
      configured: this.client !== null,
      capabilities,
      tokenizerNote:
        "OpenAI publishes its BPE encodings. Tokens and ids shown are produced by the same encoding the model uses; the message-format overhead is not included in the local count.",
    };
  }

  async run(ctx: ProviderRunContext): Promise<void> {
    const client = ctx.apiKeyOverride ? new OpenAI({ apiKey: ctx.apiKeyOverride }) : this.client;
    if (!client) throw new ProviderNotConfiguredError("openai", "OPENAI_API_KEY");
    const { message, settings, emit } = ctx;
    const model = this.options.model;
    const instructions = settings.systemPrompt.trim() || DEFAULT_SYSTEM;
    const effort = resolveEffort(model, settings.effort);
    const profile = openAIModelProfile(model);
    const notes: string[] = [];

    // Per OpenAI: temperature / top_p / top_logprobs are rejected unless effort is "none".
    const samplingAllowed = effort === "none";
    if (samplingAllowed) {
      notes.push(`Reasoning effort is "none", so this request can carry temperature and ask for top-${TOP_LOGPROBS} log probabilities. The probability stage will show real model output.`);
    } else {
      notes.push(`Reasoning effort is "${effort}", so the API rejects temperature and log probabilities. Reasoning tokens are billed as output and reported separately; the probability stage falls back to simulation.`);
      if (profile.reasoningOnly && settings.effort === "none") notes.push(`${model} does not accept effort "none", so it was raised to "${effort}".`);
    }

    const summary: PreparedRequestSummary = {
      provider: "openai",
      vendor: "OpenAI",
      model,
      system: instructions,
      messages: [{ role: "user", content: message }],
      settings: {
        temperature: samplingAllowed ? settings.temperature : null,
        maxOutputTokens: settings.maxOutputTokens,
        streaming: settings.streaming,
        effort,
        logprobs: samplingAllowed,
      },
      notes,
    };
    emit({ type: "request_prepared", at: now(), request: summary });

    const tokenization = exactTokenization(message, model);
    emit({ type: "tokenization", at: now(), result: tokenization });
    emit({
      type: "input_token_count",
      at: now(),
      count: tokenization.ids.length,
      source: "live",
      note: "Exact token count of the user message under the model's published encoding. OpenAI has no pre-flight counting endpoint, so instructions and format overhead are not included here; the final usage report is authoritative.",
    });

    const sentAt = now();
    emit({ type: "request_sent", at: sentAt });

    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model,
      input: message,
      instructions,
      max_output_tokens: settings.maxOutputTokens,
      stream: true,
      store: false,
      reasoning: profile.reasoning ? { effort, ...(effort === "none" ? {} : { summary: "auto" as const }) } : undefined,
    };
    if (samplingAllowed) {
      params.temperature = settings.temperature;
      params.top_logprobs = TOP_LOGPROBS;
      params.include = ["message.output_text.logprobs"];
    }

    await this.streamResponses(client, params, sentAt, ctx);
  }

  private async streamResponses(
    client: OpenAI,
    params: OpenAI.Responses.ResponseCreateParamsStreaming,
    sentAt: number,
    ctx: ProviderRunContext,
  ): Promise<void> {
    const { emit, signal } = ctx;
    const stream = await client.responses.create(params, { signal });

    let started = false;
    let firstTokenAt: number | null = null;
    let index = 0;
    let text = "";
    let responseModel = String(params.model);
    let usage: UsageInfo | undefined;
    let status = "completed";

    for await (const event of stream) {
      const at = now();
      if (!started && (event.type === "response.created" || event.type === "response.output_text.delta")) {
        started = true;
        firstTokenAt = at;
        const created = event.type === "response.created" ? event.response : undefined;
        responseModel = created?.model ?? responseModel;
        emit({ type: "response_started", at, ttfbMs: at - sentAt, model: created?.model ?? null, responseId: created?.id ?? null });
      }

      if (event.type === "response.reasoning_summary_text.delta" && event.delta) {
        emit({ type: "reasoning_delta", at, text: event.delta });
      } else if (event.type === "response.output_text.delta") {
        const logprobs = event.logprobs ?? [];
        if (logprobs.length > 0 && logprobs.map((l) => l.token).join("") === event.delta) {
          // The API returned per-token probabilities: stream them as exact tokens.
          for (const lp of logprobs) {
            text += lp.token;
            const alternatives: TokenAlternatives = {
              token: lp.token,
              logprob: lp.logprob,
              top: (lp.top_logprobs ?? []).flatMap((t) => (t.token !== undefined && t.logprob !== undefined ? [{ token: t.token, logprob: t.logprob }] : [])),
            };
            emit({ type: "text_delta", at, text: lp.token, granularity: "token", index: index++, alternatives });
          }
        } else if (event.delta) {
          text += event.delta;
          emit({ type: "text_delta", at, text: event.delta, granularity: "chunk", index: index++ });
        }
      } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
        const r = event.response;
        responseModel = r.model ?? responseModel;
        status = r.status ?? status;
        if (r.usage) {
          usage = {
            inputTokens: r.usage.input_tokens,
            outputTokens: r.usage.output_tokens,
            totalTokens: r.usage.total_tokens,
            reasoningTokens: r.usage.output_tokens_details?.reasoning_tokens ?? null,
            cacheReadTokens: r.usage.input_tokens_details?.cached_tokens ?? null,
          };
        }
        if (r.status === "incomplete" && r.incomplete_details?.reason) {
          emit({ type: "notice", at, level: "warn", message: `The response stopped early: ${r.incomplete_details.reason}.` });
        }
      }
    }

    const finishedAt = now();
    if (!started) emit({ type: "response_started", at: finishedAt, ttfbMs: finishedAt - sentAt, model: responseModel, responseId: null });
    if (usage) emit({ type: "usage", at: finishedAt, usage });
    emit({
      type: "completed",
      at: finishedAt,
      finishReason: status,
      latencyMs: finishedAt - sentAt,
      ttfbMs: firstTokenAt ? firstTokenAt - sentAt : null,
      generationMs: firstTokenAt ? finishedAt - firstTokenAt : 0,
      text,
      model: responseModel,
    });
  }
}
