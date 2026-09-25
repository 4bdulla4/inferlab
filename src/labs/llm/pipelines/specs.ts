import type { DataSource, ProviderId } from "@shared/llm";
import { LLM_STAGES, type LLMStageId, type StageDefinition } from "../stages";
import { buildLayout, type BuiltLayout } from "./layout";

export interface PipelineDifference {
  topic: string;
  claude: string;
  openai: string;
  gemini: string;
  /** Stage the row is about, so the comparison can link into the diagram. */
  stage?: LLMStageId;
}

export interface PipelineSpec {
  provider: ProviderId;
  name: string;
  vendor: string;
  /** The HTTP surface this pipeline models. */
  api: string;
  summary: string;
  /** Execution / keyboard order. */
  order: LLMStageId[];
  layout: BuiltLayout;
  /** Stage definitions with provider-specific wording applied. */
  stages: Partial<Record<LLMStageId, StageDefinition>>;
  /** Connections that form the autoregressive cycle, for ambient particles. */
  cycle: string[];
  notes: string[];
}

type Override = Partial<Omit<StageDefinition, "id">>;

function withOverrides(ids: LLMStageId[], overrides: Partial<Record<LLMStageId, Override>>): Partial<Record<LLMStageId, StageDefinition>> {
  const out: Partial<Record<LLMStageId, StageDefinition>> = {};
  for (const id of ids) out[id] = { ...LLM_STAGES[id], ...(overrides[id] ?? {}) };
  return out;
}

/** Claude: Messages API — private tokenizer, exact pre-flight counting, summarized thinking, no logprobs. */
function claudeSpec(): PipelineSpec {
  const band1: LLMStageId[] = ["input", "request", "tokenization", "tokenIds", "tokenCount", "embeddings", "positional"];
  const band2: LLMStageId[] = ["logits", "probabilities", "tokenSelection"];
  const band3: LLMStageId[] = ["nextToken", "loop", "detokenization", "response"];
  const inner: LLMStageId[] = ["attention", "mlp", "thinking"];
  const order = [...band1, "transformer" as LLMStageId, ...inner, ...band2, ...band3];
  return {
    provider: "claude",
    name: "Claude",
    vendor: "Anthropic",
    api: "POST /v1/messages",
    summary:
      "Anthropic's Messages API. The system prompt is a separate top-level field, the response is an array of content blocks, and an exact input token count is available before the request runs. Claude never returns probabilities for candidate tokens.",
    order,
    layout: buildLayout(
      [
        { ids: band1, y: 36, dir: "ltr" },
        { ids: band2, y: 244, dir: "rtl", edge: 724, maxWidth: 688 },
        { ids: band3, y: 428, dir: "ltr", maxWidth: 820 },
      ],
      inner,
    ),
    stages: withOverrides([...band1, "transformer", ...inner, ...band2, ...band3], {
      request: {
        caption: "system · messages · max_tokens",
        advanced:
          "The backend builds a Messages API request: model, max_tokens (required), a top-level system prompt, the messages array, thinking configuration and output_config.effort. Current Claude models reject temperature, so it is omitted.",
      },
      tokenization: {
        defaultSource: "simulation",
        caption: "Text → tokens (approximate)",
        sourceNote:
          "Claude's tokenizer is not published, so token boundaries and ids shown here come from an open BPE and are labelled simulation. The exact token count is fetched separately from the API.",
      },
      tokenIds: { defaultSource: "simulation", caption: "Approximate ids" },
      probabilities: {
        defaultSource: "simulation",
        caption: "Never exposed by the API",
        sourceNote:
          "The Anthropic API returns no logprobs at any setting, so this distribution is always an educational simulation. The selected token is still the real streamed output.",
      },
      logits: { defaultSource: "simulation", caption: "Scores (not exposed)" },
      detokenization: { caption: "Content blocks → text", advanced: "The response is an array of content blocks (text, thinking, tool_use). The visualizer joins the streamed text blocks; detokenization itself happens provider-side." },
      response: { caption: "stop_reason · usage" },
    }),
    cycle: ["transformer-logits", "logits-probabilities", "probabilities-tokenSelection", "tokenSelection-nextToken", "nextToken-loop", "loop-transformer", "attention-mlp", "mlp-thinking"],
    notes: [
      "max_tokens is required; the system prompt is not a message.",
      "thinking: { type: \"adaptive\" } lets the model decide how long to reason; display: \"summarized\" streams a readable summary.",
      "Prompt caching is explicit: you place cache_control breakpoints and read cache_creation_input_tokens / cache_read_input_tokens.",
      "stop_reason can be refusal, which has no equivalent in the OpenAI shape.",
    ],
  };
}

/** OpenAI: Responses API — published tokenizer, hidden reasoning tokens, real logprobs when reasoning is off. */
function openaiSpec(): PipelineSpec {
  const band1: LLMStageId[] = ["input", "request", "tokenization", "tokenIds", "embeddings", "positional"];
  const band2: LLMStageId[] = ["logits", "probabilities", "tokenSelection"];
  const band3: LLMStageId[] = ["nextToken", "loop", "detokenization", "response"];
  const inner: LLMStageId[] = ["attention", "mlp", "reasoning"];
  const order = [...band1, "transformer" as LLMStageId, ...inner, ...band2, ...band3];
  return {
    provider: "openai",
    name: "OpenAI",
    vendor: "OpenAI",
    api: "POST /v1/responses",
    summary:
      "OpenAI's Responses API. Input and instructions are separate, the result is an array of output items (reasoning items plus a message), and reasoning tokens are billed and counted but never shown. With reasoning effort set to none the model returns real log probabilities per token.",
    order,
    layout: buildLayout(
      [
        { ids: band1, y: 36, dir: "ltr" },
        { ids: band2, y: 244, dir: "rtl", edge: 724, maxWidth: 688 },
        { ids: band3, y: 428, dir: "ltr", maxWidth: 820 },
      ],
      inner,
    ),
    stages: withOverrides([...band1, "transformer", ...inner, ...band2, ...band3], {
      request: {
        caption: "input · instructions · reasoning.effort",
        advanced:
          "The backend builds a Responses API request: model, input, instructions, max_output_tokens, and reasoning.effort. When effort is none the request may also carry temperature and top_logprobs; at any higher effort the API rejects those parameters.",
      },
      tokenization: {
        defaultSource: "live",
        caption: "Text → tokens (exact)",
        sourceNote:
          "OpenAI publishes its BPE encodings, so these tokens and ids are exactly what the model receives. Only the chat-format overhead is excluded from the local count.",
      },
      tokenIds: { defaultSource: "live", caption: "Exact vocabulary ids" },
      probabilities: {
        // The lab defaults to reasoning effort "none", where OpenAI does return logprobs.
        // The badge on a finished run always reflects what that run actually received.
        defaultSource: "live",
        caption: "Real logprobs when effort = none",
        sourceNote:
          "Live when the request asked for log probabilities: the API returns the chosen token and up to 20 alternatives with their log probabilities. With reasoning effort above none, logprobs are rejected and this stage falls back to simulation.",
      },
      logits: { defaultSource: "live", caption: "Top-k scores per position" },
      detokenization: {
        caption: "Output items → text",
        advanced: "The response is an array of output items: reasoning items (hidden content, optionally summarized) followed by a message item whose output_text carries the answer.",
      },
      response: { caption: "status · usage · reasoning tokens" },
    }),
    cycle: ["transformer-logits", "logits-probabilities", "probabilities-tokenSelection", "tokenSelection-nextToken", "nextToken-loop", "loop-transformer", "attention-mlp", "mlp-reasoning"],
    notes: [
      "max_output_tokens on the Responses API; max_completion_tokens on Chat Completions.",
      "reasoning.effort accepts none, minimal, low, medium, high, xhigh and max, and the level is model-dependent.",
      "Reasoning tokens are billed as output tokens and reported in usage.output_tokens_details.reasoning_tokens.",
      "Prompt caching is automatic for long prefixes and reported as input_tokens_details.cached_tokens.",
    ],
  };
}

/** Gemini: the one provider with a pre-flight count, thought summaries and real logprobs together. */
function geminiSpec(): PipelineSpec {
  const band1: LLMStageId[] = ["input", "request", "tokenization", "tokenIds", "tokenCount", "embeddings", "positional"];
  const band2: LLMStageId[] = ["logits", "probabilities", "tokenSelection"];
  const band3: LLMStageId[] = ["nextToken", "loop", "detokenization", "response"];
  const inner: LLMStageId[] = ["attention", "mlp", "thinking"];
  const order = [...band1, "transformer" as LLMStageId, ...inner, ...band2, ...band3];
  return {
    provider: "gemini",
    name: "Gemini",
    vendor: "Google",
    api: "POST :generateContent",
    summary:
      "Google's generateContent API. The system instruction sits in the config, the response is a list of candidate parts where thinking is flagged rather than hidden, and the same request can return both an exact pre-flight token count and real per-token probabilities.",
    order,
    layout: buildLayout(
      [
        { ids: band1, y: 36, dir: "ltr" },
        { ids: band2, y: 244, dir: "rtl", edge: 724, maxWidth: 688 },
        { ids: band3, y: 428, dir: "ltr", maxWidth: 820 },
      ],
      inner,
    ),
    stages: withOverrides([...band1, "transformer", ...inner, ...band2, ...band3], {
      request: {
        caption: "contents · config · thinkingConfig",
        advanced:
          "The backend builds a generateContent request: model, contents, and a config carrying systemInstruction, temperature, maxOutputTokens, responseLogprobs and thinkingConfig. Unlike the other two providers, sampling and probabilities are available at every thinking level.",
      },
      tokenization: {
        defaultSource: "simulation",
        caption: "Text → tokens (approximate)",
        sourceNote: "Gemini's tokenizer is not published, so boundaries shown here are approximated. The exact count comes from the countTokens endpoint.",
      },
      tokenIds: { defaultSource: "simulation", caption: "Approximate ids" },
      tokenCount: {
        caption: "countTokens endpoint",
        advanced: "Gemini exposes models.countTokens, which returns the exact token count for the input before the model runs and without billing output.",
      },
      thinking: {
        caption: "Thought summaries · counted",
        advanced:
          "thinkingConfig sets the level and can include thoughts. Summary parts arrive flagged with `thought` in the same stream as the answer, and thought tokens are reported as thoughtsTokenCount.",
        sourceNote: "Live: thought summaries stream as flagged parts, and the thought token count comes from the usage report.",
      },
      probabilities: {
        defaultSource: "live",
        caption: "Real logprobs at any level",
        sourceNote: "Live: responseLogprobs returns the chosen token and its top alternatives for each position, regardless of thinking level.",
      },
      logits: { defaultSource: "live", caption: "Top-k scores per position" },
      detokenization: { caption: "Parts → text", advanced: "Candidates carry parts; thought parts are flagged and the rest concatenate into the answer." },
      response: { caption: "finishReason · usageMetadata" },
    }),
    cycle: ["transformer-logits", "logits-probabilities", "probabilities-tokenSelection", "tokenSelection-nextToken", "nextToken-loop", "loop-transformer", "attention-mlp", "mlp-thinking"],
    notes: [
      "systemInstruction lives in config, not in the contents array.",
      "thinkingConfig.includeThoughts streams thought summaries inline, flagged with `thought`.",
      "responseLogprobs works alongside thinking, which neither Claude nor OpenAI allow.",
      "usageMetadata reports promptTokenCount, candidatesTokenCount, thoughtsTokenCount and cachedContentTokenCount.",
    ],
  };
}

const SPECS: Record<string, PipelineSpec> = {
  claude: claudeSpec(),
  openai: openaiSpec(),
  gemini: geminiSpec(),
};

/** Providers without a dedicated spec (the offline demo) visualize the Claude shape. */
export function getPipelineSpec(provider: ProviderId | undefined): PipelineSpec {
  return SPECS[provider ?? "claude"] ?? SPECS.claude!;
}

export const CLAUDE_SPEC = SPECS.claude!;
export const OPENAI_SPEC = SPECS.openai!;
export const GEMINI_SPEC = SPECS.gemini!;

export function stageSource(spec: PipelineSpec, id: LLMStageId): DataSource {
  return spec.stages[id]?.defaultSource ?? LLM_STAGES[id].defaultSource;
}

/** Researched, provider-by-provider differences shown on the comparison page. */
export const PIPELINE_DIFFERENCES: PipelineDifference[] = [
  { topic: "API surface", claude: "POST /v1/messages. System prompt is a top-level field, not a message.", openai: "POST /v1/responses. Separate input and instructions; Chat Completions remains for simpler cases.", gemini: "POST /v1beta/models/{model}:streamGenerateContent. System prompt lives in config.systemInstruction; turns go in contents[] with roles user and model.", stage: "request" },
  { topic: "Output shape", claude: "content[] blocks: text, thinking, tool_use.", openai: "output[] items: reasoning items then a message item with output_text.", gemini: "candidates[0].content.parts[]: text parts, with thought summaries flagged part.thought === true.", stage: "detokenization" },
  { topic: "Output limit", claude: "max_tokens, and it is required.", openai: "max_output_tokens (Responses) or max_completion_tokens (Chat Completions).", gemini: "maxOutputTokens, and it is optional.", stage: "request" },
  { topic: "Tokenizer", claude: "Not published. Token boundaries here are approximated and labelled simulation.", openai: "Published BPE (o200k_base), so tokens and ids are exact.", gemini: "Not published. Boundaries here are approximated, but the count beside them comes from the API.", stage: "tokenization" },
  { topic: "Pre-flight token count", claude: "Dedicated endpoint returns the exact input count before running the model.", openai: "No equivalent endpoint; counted locally from the published encoding.", gemini: "models.countTokens is a real API call that returns totalTokens before generating.", stage: "tokenCount" },
  { topic: "Reasoning", claude: "thinking: { type: \"adaptive\" }; summarized thinking text can stream back.", openai: "reasoning.effort from none to max; tokens are hidden and billed as output, with optional summaries.", gemini: "thinkingConfig.thinkingLevel from minimal to high; includeThoughts streams thought summaries back.", stage: "thinking" },
  { topic: "Reasoning accounting", claude: "Thinking is billed in output tokens; no separate field.", openai: "usage.output_tokens_details.reasoning_tokens reports them separately.", gemini: "usageMetadata.thoughtsTokenCount reports thinking tokens on their own.", stage: "reasoning" },
  { topic: "Token probabilities", claude: "Never returned, at any setting. The probability stage is always simulated.", openai: "Real log probabilities with up to 20 alternatives, but only when reasoning effort is none.", gemini: "Real log probabilities via responseLogprobs, returned alongside normal sampling settings.", stage: "probabilities" },
  { topic: "Sampling controls", claude: "Current models reject temperature, top_p and top_k.", openai: "temperature and top_p are accepted only when reasoning effort is none.", gemini: "temperature, topP and topK are all accepted.", stage: "request" },
  { topic: "Prompt caching", claude: "Explicit cache_control breakpoints; cache creation and read tokens reported separately.", openai: "Automatic for long prefixes; reported as input_tokens_details.cached_tokens.", gemini: "Implicit caching on long prefixes, plus explicit cached content; reported as usageMetadata.cachedContentTokenCount.", stage: "request" },
  { topic: "Streaming events", claude: "message_start, content_block_delta (text_delta / thinking_delta), message_delta, message_stop.", openai: "response.created, response.output_text.delta (carrying logprobs), response.reasoning_summary_text.delta, response.completed.", gemini: "Untyped chunks of GenerateContentResponse; each carries the new parts and, at the end, usageMetadata.", stage: "nextToken" },
  { topic: "Stopping", claude: "stop_reason: end_turn, max_tokens, tool_use, refusal, pause_turn.", openai: "status: completed or incomplete, with incomplete_details giving the reason.", gemini: "candidates[0].finishReason: STOP, MAX_TOKENS, SAFETY, RECITATION.", stage: "response" },
  { topic: "Conversation state", claude: "Stateless: the full history is resent on every request.", openai: "Optional server-side state via store and previous_response_id, which can carry reasoning across turns.", gemini: "Stateless: contents[] is resent every turn. The Chats helper keeps that history client-side.", stage: "loop" },
];
