import { FunctionCallingConfigMode, GoogleGenAI, Type, type Content, type FunctionDeclaration, type Schema } from "@google/genai";
import type { ToolCallRequest, ToolInputSchema } from "@shared/agent";
import type { AgentMessage, AgentModel, ModelTurn, ModelTurnRequest } from "../types";

/** Gemini through generateContent with function declarations. Gemini issues no call ids, so the lab synthesizes them. */
export class GeminiAgentModel implements AgentModel {
  readonly id = "gemini" as const;
  readonly vendor = "Google";
  readonly mock = false;
  private readonly client: GoogleGenAI;
  private counter = 0;

  constructor(apiKey: string, readonly model: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    const declarations: FunctionDeclaration[] = req.tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.inputSchema) }));
    const sentAt = Date.now();
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: toGeminiContents(req.messages),
      config: {
        systemInstruction: req.system,
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        abortSignal: req.signal,
        tools: declarations.length ? [{ functionDeclarations: declarations }] : undefined,
        toolConfig: declarations.length ? { functionCallingConfig: { mode: req.forceText ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } } : undefined,
      },
    });
    const finishedAt = Date.now();
    const candidate = res.candidates?.[0];
    let text = "";
    const toolCalls: ToolCallRequest[] = [];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought) continue;
      if (part.text) text += part.text;
      if (part.functionCall?.name) toolCalls.push({ id: `gem_${++this.counter}_${part.functionCall.name}`, name: part.functionCall.name, args: (part.functionCall.args ?? {}) as Record<string, unknown> });
    }
    if (text) req.onTextDelta?.(text);
    const m = res.usageMetadata;
    return {
      text,
      toolCalls,
      usage: m
        ? {
            inputTokens: m.promptTokenCount ?? null,
            outputTokens: m.candidatesTokenCount ?? null,
            totalTokens: m.totalTokenCount ?? null,
            reasoningTokens: m.thoughtsTokenCount ?? null,
            cacheReadTokens: m.cachedContentTokenCount ?? null,
          }
        : null,
      latencyMs: finishedAt - sentAt,
      ttfbMs: null,
      stopReason: toolCalls.length ? "tool_calls" : String(candidate?.finishReason ?? "stop").toLowerCase(),
      model: this.model,
      source: "live",
    };
  }
}

function toGeminiSchema(schema: ToolInputSchema): Schema {
  const properties: Record<string, Schema> = {};
  for (const [k, p] of Object.entries(schema.properties)) {
    properties[k] = { type: p.type === "integer" ? Type.INTEGER : p.type === "number" ? Type.NUMBER : p.type === "boolean" ? Type.BOOLEAN : Type.STRING, description: p.description, ...(p.enum ? { enum: p.enum } : {}) };
  }
  return { type: Type.OBJECT, properties, required: schema.required.length ? schema.required : undefined };
}

function toGeminiContents(messages: AgentMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", parts: [{ text: m.content }] });
    else if (m.role === "assistant") {
      const parts: Content["parts"] = [];
      if (m.content.trim()) parts.push({ text: m.content });
      for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.args } });
      if (parts.length === 0) parts.push({ text: "(no content)" });
      out.push({ role: "model", parts });
    } else {
      out.push({ role: "user", parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.content } : { result: r.content } } })) });
    }
  }
  return out;
}
