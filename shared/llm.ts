/**
 * Shared contract between the backend (provider adapters) and the frontend
 * (execution engine + visualizer). Nothing in this file may contain secrets.
 *
 * The single most important field in this system is `DataSource`:
 *   - "live"        → a value observed from the real provider API
 *   - "simulation"  → an educational / conceptual visualization
 */

/** "mock" exists only when the server runs with LLM_MOCK_PROVIDER=1 (offline demo). */
export type ProviderId = "claude" | "openai" | "gemini" | "mock";

export type DataSource = "live" | "simulation";

export interface GenerationSettings {
  /** Sampling temperature. Ignored (and reported) when the model rejects it. */
  temperature: number;
  /** Maximum output tokens requested from the provider. */
  maxOutputTokens: number;
  /** Whether to request a streamed response. */
  streaming: boolean;
  /** Optional system prompt. */
  systemPrompt: string;
  /**
   * How much the model may reason before answering.
   * OpenAI maps this to reasoning.effort; Anthropic to output_config.effort.
   * "none" is what unlocks real log probabilities on OpenAI models.
   */
  effort?: "none" | "low" | "medium" | "high";
}

export interface ProviderCapabilities {
  /** Provider supports incremental streaming output. */
  streaming: boolean;
  /** Provider accepts a temperature parameter for the configured model. */
  temperature: boolean;
  /** Provider exposes a reasoning-effort control. */
  effort: boolean;
  /** Provider can return real per-token alternatives (top-k log probabilities). */
  logprobs: boolean;
  /** The tokenization shown is produced by the provider's own tokenizer. */
  exactTokenizer: boolean;
  /** Where the input token count comes from before the request is sent. */
  inputTokenCount: "live" | "estimate";
  /** Model may emit a reasoning / thinking phase before visible text. */
  reasoning: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  /** Product name shown in the UI, e.g. "Claude". */
  name: string;
  /** Company operating the API, e.g. "Anthropic". */
  vendor: string;
  /** Model id the backend is configured to use. */
  model: string;
  /** Whether an API key is available (on the server, or supplied for this browser session). */
  configured: boolean;
  /** Where the key comes from. "session" keys are held in the browser tab's memory only and sent per request. */
  keySource?: "server" | "session" | "none";
  capabilities: ProviderCapabilities;
  /** Human-readable note about how tokenization is derived. */
  tokenizerNote: string;
  /** True for the offline demo provider: no real API is called and nothing it reports is real telemetry. */
  mock?: boolean;
}

export interface ChatRequestBody {
  provider: ProviderId;
  message: string;
  settings: GenerationSettings;
}

export interface TokenizationResult {
  /** Decoded text pieces, one per token id. */
  tokens: string[];
  /** Numeric token ids in the named encoding. */
  ids: number[];
  /** Name of the encoding used, e.g. "o200k_base". */
  encoding: string;
  /** True when this is the provider's exact tokenizer for the configured model. */
  exact: boolean;
  source: DataSource;
  note: string;
}

export interface TokenLogprob {
  token: string;
  logprob: number;
}

/** Real alternatives for one generated token (only when the provider exposes logprobs). */
export interface TokenAlternatives {
  token: string;
  logprob: number;
  top: TokenLogprob[];
}

export interface UsageInfo {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface PreparedRequestSummary {
  provider: ProviderId;
  vendor: string;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  settings: {
    temperature: number | null;
    maxOutputTokens: number;
    streaming: boolean;
    thinking?: string;
    effort?: string;
    logprobs?: boolean;
  };
  /** Anything the user should know about how settings were adapted. */
  notes: string[];
}

/**
 * Events emitted by the backend over Server-Sent Events. These are the only
 * facts the frontend treats as LIVE. Everything else is client-side simulation.
 */
export type ServerEvent =
  | { type: "request_prepared"; at: number; request: PreparedRequestSummary }
  | { type: "tokenization"; at: number; result: TokenizationResult }
  | {
      type: "input_token_count";
      at: number;
      count: number;
      source: DataSource;
      note: string;
    }
  | { type: "request_sent"; at: number }
  | {
      type: "response_started";
      at: number;
      ttfbMs: number;
      model: string | null;
      responseId: string | null;
    }
  | { type: "reasoning_delta"; at: number; text: string }
  | {
      type: "text_delta";
      at: number;
      text: string;
      /** "token": exactly one model token. "chunk": a streamed text fragment that may span several tokens. */
      granularity: "token" | "chunk";
      index: number;
      alternatives?: TokenAlternatives;
    }
  | { type: "usage"; at: number; usage: UsageInfo }
  | {
      type: "completed";
      at: number;
      finishReason: string;
      latencyMs: number;
      ttfbMs: number | null;
      generationMs: number;
      text: string;
      model: string;
    }
  | { type: "notice"; at: number; level: "info" | "warn"; message: string }
  | {
      type: "error";
      at: number;
      message: string;
      status?: number;
      code?: string;
      retryable: boolean;
    };

export type ServerEventType = ServerEvent["type"];

/** Persist keys into the server's .env (only from the machine running the server). Empty string clears a key. */
export interface SaveKeysRequestBody {
  anthropic?: string;
  openai?: string;
  google?: string;
  github?: string;
  anthropicWorkspace?: string;
}

export interface SaveKeysResult {
  saved: string[];
  cleared: string[];
  providers: ProviderDescriptor[];
}
