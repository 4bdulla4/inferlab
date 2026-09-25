/**
 * Server configuration. Reads environment variables only.
 * Values are never sent to the browser except the non-secret model ids.
 */
export interface ServerConfig {
  port: number;
  anthropic: {
    apiKey: string | undefined;
    model: string;
    fallbacks: boolean;
    /** Required by organization-level keys that are not scoped to a workspace. */
    workspaceId: string | undefined;
  };
  openai: {
    apiKey: string | undefined;
    model: string;
  };
  google: {
    apiKey: string | undefined;
    model: string;
  };
  github: {
    /** Optional personal access token to raise GitHub API rate limits (public repos only). */
    token: string | undefined;
  };
  /** Registers the offline demo provider. Never enable in a customer-facing deployment. */
  mockProvider: boolean;
  isProduction: boolean;
}

function flag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return !["0", "off", "false", "no"].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.API_PORT ?? 8790),
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
      model: env.ANTHROPIC_MODEL?.trim() || "claude-opus-5",
      fallbacks: flag(env.ANTHROPIC_FALLBACKS, true),
      workspaceId: env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY?.trim() || undefined,
      model: env.OPENAI_MODEL?.trim() || "gpt-5.6",
    },
    google: {
      apiKey: env.GOOGLE_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || undefined,
      model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
    },
    github: { token: env.GITHUB_TOKEN?.trim() || undefined },
    mockProvider: flag(env.LLM_MOCK_PROVIDER, false),
    isProduction: env.NODE_ENV === "production",
  };
}
