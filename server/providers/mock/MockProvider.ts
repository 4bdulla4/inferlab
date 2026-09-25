import type { ProviderDescriptor } from "@shared/llm";
import { approximateTokenization, tokenize } from "../../lib/tokenizer";
import { now, type LLMProvider, type ProviderRunContext } from "../types";

const SKY_ANSWER =
  "The sky looks blue because of the way sunlight interacts with the air. Sunlight contains all colors, but when it passes through the atmosphere it bumps into tiny gas molecules. Blue light has a shorter wavelength, so it gets scattered in every direction much more than red or yellow light. That scattered blue light reaches your eyes from all parts of the sky, which is why the sky appears blue during the day. At sunset the light travels through much more air, most of the blue is scattered away before it reaches you, and the reds and oranges remain.";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

/**
 * Offline demo provider. Streams a canned answer with realistic timing so the
 * visualizer can be exercised without API keys. It performs NO network calls
 * and its descriptor is flagged `mock: true` so the UI labels it clearly.
 */
export class MockProvider implements LLMProvider {
  readonly id = "mock" as const;

  describe(): ProviderDescriptor {
    return {
      id: "mock",
      name: "Offline demo",
      vendor: "Local mock",
      model: "mock-demo-1",
      configured: true,
      mock: true,
      capabilities: { streaming: true, temperature: true, logprobs: false, effort: false, exactTokenizer: false, inputTokenCount: "estimate", reasoning: false },
      tokenizerNote: "Offline demo: tokens come from the open o200k_base BPE. No model is called.",
    };
  }

  async run({ message, settings, emit, signal }: ProviderRunContext): Promise<void> {
    const system = settings.systemPrompt.trim() || "You are a helpful assistant.";
    emit({
      type: "request_prepared",
      at: now(),
      request: {
        provider: "mock",
        vendor: "Local mock",
        model: "mock-demo-1",
        system,
        messages: [{ role: "user", content: message }],
        settings: { temperature: settings.temperature, maxOutputTokens: settings.maxOutputTokens, streaming: settings.streaming, logprobs: false },
        notes: ["OFFLINE DEMO: no provider API is called. Timings and usage below are synthetic."],
      },
    });
    const tok = approximateTokenization(message, "The offline demo");
    tok.note = "Offline demo tokenization with the open o200k_base BPE.";
    emit({ type: "tokenization", at: now(), result: tok });
    emit({ type: "input_token_count", at: now(), count: tok.ids.length + tokenize(system, "o200k_base").ids.length, source: "simulation", note: "Synthetic count (offline demo)." });
    const sentAt = now();
    emit({ type: "request_sent", at: sentAt });
    await sleep(700, signal);
    const startedAt = now();
    emit({ type: "response_started", at: startedAt, ttfbMs: startedAt - sentAt, model: "mock-demo-1", responseId: `mock_${startedAt.toString(36)}` });

    const answer = /sky/i.test(message) && /blue/i.test(message)
      ? SKY_ANSWER
      : `This is the offline demo provider, so no model was called. Your message was: "${message}". Add an API key on the server to see a real Claude or OpenAI response stream through this pipeline.`;
    const pieces = tokenize(answer, "o200k_base").tokens;
    const limit = Math.min(pieces.length, settings.maxOutputTokens);
    let text = "";
    if (settings.streaming) {
      for (let i = 0; i < limit; i++) {
        await sleep(35 + Math.random() * 45, signal);
        text += pieces[i]!;
        emit({ type: "text_delta", at: now(), text: pieces[i]!, granularity: "chunk", index: i });
      }
    } else {
      await sleep(900, signal);
      text = pieces.slice(0, limit).join("");
      emit({ type: "text_delta", at: now(), text, granularity: "chunk", index: 0 });
    }
    const finishedAt = now();
    emit({ type: "usage", at: finishedAt, usage: { inputTokens: tok.ids.length + 9, outputTokens: limit, totalTokens: tok.ids.length + 9 + limit } });
    emit({
      type: "completed",
      at: finishedAt,
      finishReason: limit < pieces.length ? "max_tokens" : "end_turn",
      latencyMs: finishedAt - sentAt,
      ttfbMs: startedAt - sentAt,
      generationMs: finishedAt - startedAt,
      text,
      model: "mock-demo-1",
    });
  }
}
