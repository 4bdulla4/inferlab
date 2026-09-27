import Anthropic from "@anthropic-ai/sdk";
import type { ToolCallRequest } from "@shared/agent";
import { claudeModelProfile, createAnthropicClient } from "../../providers/claude/ClaudeProvider";
import type { AgentMessage, AgentModel, ModelTurn, ModelTurnRequest } from "../types";

/** Claude through the Messages API with tools. Text streams; tool calls arrive with the final message. */
export class ClaudeAgentModel implements AgentModel {
  readonly id = "claude" as const;
  readonly vendor = "Anthropic";
  readonly mock = false;
  private readonly client: Anthropic;

  constructor(apiKey: string, readonly model: string, workspaceId?: string) {
    this.client = createAnthropicClient(apiKey, workspaceId);
  }

  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    const profile = claudeModelProfile(this.model);
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: withCacheBreakpoint(toClaudeMessages(req.messages)),
    };
    if (req.tools.length > 0 && !req.forceText) {
      params.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
      params.tool_choice = { type: "auto", disable_parallel_tool_use: !req.parallelToolCalls };
    } else if (req.tools.length > 0) {
      params.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
      params.tool_choice = { type: "none" };
    }
    if (profile.temperature) params.temperature = req.temperature;
    if (profile.effort) params.output_config = { effort: "low" };

    const sentAt = Date.now();
    let firstAt: number | null = null;
    let text = "";
    const stream = this.client.messages.stream(params, { signal: req.signal });
    for await (const event of stream) {
      if (firstAt === null && event.type === "message_start") firstAt = Date.now();
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        text += event.delta.text;
        req.onTextDelta?.(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    const finishedAt = Date.now();
    const toolCalls: ToolCallRequest[] = final.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }));
    const finalText = text || final.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    // Anthropic's input_tokens excludes the cached part of the prompt. The lab's
    // input count means the whole prompt, as OpenAI reports it, so token budgets
    // and totals mean the same thing whichever provider ran; the cache split is kept.
    const cacheRead = final.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = final.usage.cache_creation_input_tokens ?? 0;
    const promptTokens = final.usage.input_tokens + cacheRead + cacheWrite;
    return {
      text: finalText,
      toolCalls,
      usage: {
        inputTokens: promptTokens,
        outputTokens: final.usage.output_tokens,
        totalTokens: promptTokens + final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? null,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? null,
      },
      latencyMs: finishedAt - sentAt,
      ttfbMs: firstAt ? firstAt - sentAt : null,
      stopReason: final.stop_reason ?? "unknown",
      model: final.model,
      source: "live",
    };
  }
}

function toClaudeMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content.trim()) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      if (blocks.length === 0) blocks.push({ type: "text", text: "(no content)" });
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.callId, content: r.content || "(empty result)", is_error: r.isError })),
      });
    }
  }
  return out;
}

/**
 * Marks the end of the conversation as a cache breakpoint. Each agent round
 * resends everything before it, so the next round reads that prefix (tools,
 * instructions and earlier turns) from the cache instead of paying for it again.
 * Prefixes shorter than the model's minimum are simply not cached.
 */
export function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const tail = blocks[blocks.length - 1];
  if (!tail || tail.type === "thinking" || tail.type === "redacted_thinking") return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}
