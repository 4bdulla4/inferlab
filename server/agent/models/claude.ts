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
      messages: toClaudeMessages(req.messages),
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
    return {
      text: finalText,
      toolCalls,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        totalTokens: final.usage.input_tokens + final.usage.output_tokens,
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
