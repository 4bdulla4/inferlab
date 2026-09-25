import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import type {
  PreparedRequestSummary,
  ProviderCapabilities,
  ProviderDescriptor,
  TokenAlternatives,
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

const TOP_LOGPROBS = 5;

/** Maps the lab's shared effort control onto Gemini's thinking levels. */
export function thinkingLevelFor(effort: string | undefined): "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | null {
  switch (effort) {
    case "none":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
    default:
      return null;
  }
}

export interface GeminiProviderOptions {
  apiKey: string | undefined;
  model: string;
}

/**
 * Google Gemini via the generateContent streaming API. Gemini is the only
 * provider here that offers all three at once: an exact pre-flight token count,
 * visible thought summaries, and real per-token log probabilities.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini" as const;
  private readonly client: GoogleGenAI | null;

  constructor(private readonly options: GeminiProviderOptions) {
    this.client = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  describe(): ProviderDescriptor {
    const capabilities: ProviderCapabilities = {
      streaming: true,
      temperature: true,
      logprobs: true,
      effort: true,
      exactTokenizer: false,
      inputTokenCount: "live",
      reasoning: true,
    };
    return {
      id: "gemini",
      name: "Gemini",
      vendor: "Google",
      model: this.options.model,
      configured: this.client !== null,
      capabilities,
      tokenizerNote:
        "Gemini's tokenizer is not published, so token boundaries here are approximated with an open BPE. The exact input token count comes from the countTokens endpoint.",
    };
  }

  async run(ctx: ProviderRunContext): Promise<void> {
    const client = ctx.apiKeyOverride ? new GoogleGenAI({ apiKey: ctx.apiKeyOverride }) : this.client;
    if (!client) throw new ProviderNotConfiguredError("gemini", "GEMINI_API_KEY");
    const { message, settings, emit, signal } = ctx;
    const model = this.options.model;
    const system = settings.systemPrompt.trim() || DEFAULT_SYSTEM;
    const thinkingLevel = thinkingLevelFor(settings.effort);
    const notes: string[] = [];

    const config: GenerateContentConfig = {
      systemInstruction: system,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      responseLogprobs: true,
      logprobs: TOP_LOGPROBS,
    };
    notes.push(`Requesting top-${TOP_LOGPROBS} log probabilities, so the probability stage shows real model output.`);
    if (thinkingLevel) {
      config.thinkingConfig = { includeThoughts: true, thinkingLevel: thinkingLevel as never };
      notes.push(`Thinking level ${thinkingLevel}; thought summaries stream back and thought tokens are reported separately.`);
    }

    const summary: PreparedRequestSummary = {
      provider: "gemini",
      vendor: "Google",
      model,
      system,
      messages: [{ role: "user", content: message }],
      settings: {
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens,
        streaming: settings.streaming,
        effort: settings.effort,
        logprobs: true,
      },
      notes,
    };
    emit({ type: "request_prepared", at: now(), request: summary });

    emit({ type: "tokenization", at: now(), result: approximateTokenization(message, "Gemini") });

    // Gemini exposes an exact pre-flight count, like Anthropic does.
    try {
      const counted = await client.models.countTokens({ model, contents: message });
      if (typeof counted.totalTokens === "number") {
        emit({
          type: "input_token_count",
          at: now(),
          count: counted.totalTokens,
          source: "live",
          note: "Counted by Gemini's countTokens endpoint for this exact input, before the model runs.",
        });
      }
    } catch (err) {
      if (signal.aborted) throw err;
      emit({ type: "notice", at: now(), level: "warn", message: `Token counting skipped (${describeApiError(err, "Gemini")}). The final usage report will still be live.` });
    }

    const sentAt = now();
    emit({ type: "request_sent", at: sentAt });

    const stream = await client.models.generateContentStream({ model, contents: message, config });

    let started = false;
    let firstTokenAt: number | null = null;
    let index = 0;
    let text = "";
    let usage: UsageInfo | undefined;
    let finishReason = "stop";

    for await (const chunk of stream as AsyncGenerator<GenerateContentResponse>) {
      if (signal.aborted) break;
      const at = now();
      if (!started) {
        started = true;
        firstTokenAt = at;
        emit({ type: "response_started", at, ttfbMs: at - sentAt, model, responseId: chunk.responseId ?? null });
      }

      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = String(candidate.finishReason).toLowerCase();

      // Thought summaries arrive as parts flagged with `thought`.
      for (const part of candidate?.content?.parts ?? []) {
        if (part.thought && part.text) emit({ type: "reasoning_delta", at, text: part.text });
      }

      const visible = (candidate?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
      if (visible) {
        const chosen = candidate?.logprobsResult?.chosenCandidates ?? [];
        const tops = candidate?.logprobsResult?.topCandidates ?? [];
        const joined = chosen.map((c) => c.token ?? "").join("");
        if (chosen.length > 0 && joined === visible) {
          chosen.forEach((c, i) => {
            const token = c.token ?? "";
            text += token;
            const alternatives: TokenAlternatives = {
              token,
              logprob: c.logProbability ?? 0,
              top: (tops[i]?.candidates ?? []).flatMap((t) =>
                t.token !== undefined && t.logProbability !== undefined ? [{ token: t.token, logprob: t.logProbability }] : [],
              ),
            };
            emit({ type: "text_delta", at, text: token, granularity: "token", index: index++, alternatives });
          });
        } else {
          text += visible;
          emit({ type: "text_delta", at, text: visible, granularity: "chunk", index: index++ });
        }
      }

      const m = chunk.usageMetadata;
      if (m) {
        usage = {
          inputTokens: m.promptTokenCount ?? null,
          outputTokens: m.candidatesTokenCount ?? null,
          totalTokens: m.totalTokenCount ?? null,
          reasoningTokens: m.thoughtsTokenCount ?? null,
          cacheReadTokens: m.cachedContentTokenCount ?? null,
        };
      }
    }

    const finishedAt = now();
    if (!started) emit({ type: "response_started", at: finishedAt, ttfbMs: finishedAt - sentAt, model, responseId: null });
    if (usage) emit({ type: "usage", at: finishedAt, usage });
    emit({
      type: "completed",
      at: finishedAt,
      finishReason,
      latencyMs: finishedAt - sentAt,
      ttfbMs: firstTokenAt ? firstTokenAt - sentAt : null,
      generationMs: firstTokenAt ? finishedAt - firstTokenAt : 0,
      text,
      model,
    });
  }
}
