import type { ProviderDescriptor, ServerEvent } from "@shared/llm";

export const claudeDescriptor: ProviderDescriptor = {
  id: "claude",
  name: "Claude",
  vendor: "Anthropic",
  model: "claude-opus-5",
  configured: true,
  capabilities: { streaming: true, temperature: false, logprobs: false, effort: true, exactTokenizer: false, inputTokenCount: "live", reasoning: true },
  tokenizerNote: "",
};

export const openaiDescriptor: ProviderDescriptor = {
  ...claudeDescriptor,
  id: "openai",
  name: "OpenAI",
  vendor: "OpenAI",
  model: "gpt-4.1-mini",
  capabilities: { streaming: true, temperature: true, logprobs: true, effort: true, exactTokenizer: true, inputTokenCount: "estimate", reasoning: false },
};

/** A realistic live event sequence for "Why is the sky blue?" */
export function sampleServerEvents(opts: { logprobs?: boolean } = {}): ServerEvent[] {
  const t0 = 1_700_000_000_000;
  const alt = (token: string) =>
    opts.logprobs
      ? { token, logprob: -0.2, top: [{ token, logprob: -0.2 }, { token: " the", logprob: -1.9 }, { token: " a", logprob: -2.5 }] }
      : undefined;
  const deltas = ["The", " sky", " is", " blue", " because", " of", " scattering", "."];
  return [
    {
      type: "request_prepared",
      at: t0,
      request: {
        provider: opts.logprobs ? "openai" : "claude",
        vendor: opts.logprobs ? "OpenAI" : "Anthropic",
        model: opts.logprobs ? "gpt-4.1-mini" : "claude-opus-5",
        system: "You are helpful.",
        messages: [{ role: "user", content: "Why is the sky blue?" }],
        settings: { temperature: null, maxOutputTokens: 500, streaming: true },
        notes: [],
      },
    },
    {
      type: "tokenization",
      at: t0 + 5,
      result: { tokens: ["Why", " is", " the", " sky", " blue", "?"], ids: [13903, 382, 290, 17307, 9861, 30], encoding: "o200k_base", exact: Boolean(opts.logprobs), source: opts.logprobs ? "live" : "simulation", note: "" },
    },
    { type: "input_token_count", at: t0 + 40, count: 21, source: "live", note: "" },
    { type: "request_sent", at: t0 + 41 },
    { type: "response_started", at: t0 + 600, ttfbMs: 559, model: "model-x", responseId: "msg_1" },
    ...deltas.map((text, i): ServerEvent => ({ type: "text_delta", at: t0 + 620 + i * 30, text, granularity: opts.logprobs ? "token" : "chunk", index: i, alternatives: alt(text) })),
    { type: "usage", at: t0 + 900, usage: { inputTokens: 21, outputTokens: 8, totalTokens: 29 } },
    { type: "completed", at: t0 + 901, finishReason: "end_turn", latencyMs: 860, ttfbMs: 559, generationMs: 301, text: deltas.join(""), model: "model-x" },
  ];
}
