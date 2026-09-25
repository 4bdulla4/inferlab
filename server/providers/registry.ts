import type { ProviderDescriptor, ProviderId } from "@shared/llm";
import type { ServerConfig } from "../lib/config";
import { ClaudeProvider } from "./claude/ClaudeProvider";
import { GeminiProvider } from "./gemini/GeminiProvider";
import { MockProvider } from "./mock/MockProvider";
import { OpenAIProvider } from "./openai/OpenAIProvider";
import type { LLMProvider } from "./types";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, LLMProvider>();

  constructor(config: ServerConfig) {
    this.register(new ClaudeProvider(config.anthropic));
    this.register(new OpenAIProvider(config.openai));
    this.register(new GeminiProvider(config.google));
    if (config.mockProvider) this.register(new MockProvider());
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id as ProviderId);
  }

  describeAll(): ProviderDescriptor[] {
    return [...this.providers.values()].map((p) => p.describe());
  }
}
