import OpenAI from "openai";
import type { ToolCallRequest } from "@shared/agent";
import { openAIModelProfile, resolveEffort } from "../../providers/openai/OpenAIProvider";
import type { AgentMessage, AgentModel, ModelTurn, ModelTurnRequest } from "../types";

/** OpenAI through the Responses API with function tools. */
export class OpenAIAgentModel implements AgentModel {
  readonly id = "openai" as const;
  readonly vendor = "OpenAI";
  readonly mock = false;
  private readonly client: OpenAI;

  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    const profile = openAIModelProfile(this.model);
    const effort = resolveEffort(this.model, "low");
    const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: this.model,
      instructions: req.system,
      input: toOpenAIInput(req.messages),
      max_output_tokens: req.maxOutputTokens,
      store: false,
      stream: false,
      reasoning: profile.reasoning ? { effort } : undefined,
    };
    if (req.tools.length > 0) {
      params.tools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown>, strict: false }));
      params.tool_choice = req.forceText ? "none" : "auto";
      params.parallel_tool_calls = req.parallelToolCalls;
    }
    if (effort === "none") params.temperature = req.temperature;

    const sentAt = Date.now();
    const res = await this.client.responses.create(params, { signal: req.signal });
    const finishedAt = Date.now();
    let text = "";
    const toolCalls: ToolCallRequest[] = [];
    for (const item of res.output) {
      if (item.type === "message") {
        for (const part of item.content) if (part.type === "output_text") text += part.text;
      } else if (item.type === "function_call") {
        toolCalls.push({ id: item.call_id, name: item.name, args: parseArgs(item.arguments) });
      }
    }
    if (text) req.onTextDelta?.(text);
    return {
      text,
      toolCalls,
      usage: res.usage
        ? {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
            totalTokens: res.usage.total_tokens,
            reasoningTokens: res.usage.output_tokens_details?.reasoning_tokens ?? null,
            cacheReadTokens: res.usage.input_tokens_details?.cached_tokens ?? null,
          }
        : null,
      latencyMs: finishedAt - sentAt,
      ttfbMs: null,
      stopReason: toolCalls.length ? "tool_calls" : (res.status ?? "completed"),
      model: res.model ?? this.model,
      source: "live",
    };
  }
}

function toOpenAIInput(messages: AgentMessage[]): OpenAI.Responses.ResponseInputItem[] {
  const out: OpenAI.Responses.ResponseInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.content.trim()) out.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls) out.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) });
    } else {
      for (const r of m.results) out.push({ type: "function_call_output", call_id: r.callId, output: r.content || "(empty result)" });
    }
  }
  return out;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
