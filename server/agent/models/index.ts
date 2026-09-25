import type { ProviderId } from "@shared/llm";
import type { ServerConfig } from "../../lib/config";
import { ProviderNotConfiguredError } from "../../providers/types";
import type { AgentModel } from "../types";
import { ClaudeAgentModel } from "./claude";
import { GeminiAgentModel } from "./gemini";
import { MockAgentModel } from "./mock";
import { OpenAIAgentModel } from "./openai";

export interface ModelKeys {
  anthropic?: string;
  anthropicWorkspace?: string;
  openai?: string;
  google?: string;
}

/** Builds the tool-calling client for a provider from the server config plus this request's session keys. */
export function createAgentModel(provider: ProviderId, config: ServerConfig, keys: ModelKeys): AgentModel {
  switch (provider) {
    case "claude": {
      const key = keys.anthropic ?? config.anthropic.apiKey;
      if (!key) throw new ProviderNotConfiguredError("claude", "ANTHROPIC_API_KEY");
      return new ClaudeAgentModel(key, config.anthropic.model, keys.anthropicWorkspace ?? config.anthropic.workspaceId);
    }
    case "openai": {
      const key = keys.openai ?? config.openai.apiKey;
      if (!key) throw new ProviderNotConfiguredError("openai", "OPENAI_API_KEY");
      return new OpenAIAgentModel(key, config.openai.model);
    }
    case "gemini": {
      const key = keys.google ?? config.google.apiKey;
      if (!key) throw new ProviderNotConfiguredError("gemini", "GEMINI_API_KEY");
      return new GeminiAgentModel(key, config.google.model);
    }
    case "mock":
      if (!config.mockProvider) throw new ProviderNotConfiguredError("mock", "LLM_MOCK_PROVIDER");
      return new MockAgentModel();
  }
}

export { MockAgentModel };
