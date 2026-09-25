import type {
  GenerationSettings,
  ProviderDescriptor,
  ProviderId,
  ServerEvent,
} from "@shared/llm";

export interface ProviderRunContext {
  message: string;
  settings: GenerationSettings;
  /** Push a LIVE event to the client. */
  emit: (event: ServerEvent) => void;
  /** Aborted when the client disconnects or presses STOP. */
  signal: AbortSignal;
  /** API key supplied by the browser for this request only (session key). Never logged or stored. */
  apiKeyOverride?: string;
  /** Anthropic workspace id supplied for this request (organization-level keys). */
  workspaceIdOverride?: string;
}

/**
 * Provider adapter contract. Adapters translate a chat request into the
 * provider's API and emit a normalized stream of observable events.
 * They must never emit values the provider did not actually return.
 */
export interface LLMProvider {
  readonly id: ProviderId;
  describe(): ProviderDescriptor;
  run(ctx: ProviderRunContext): Promise<void>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(public readonly providerId: ProviderId, envVar: string) {
    super(`Provider "${providerId}" is not configured. Set ${envVar} on the server.`);
    this.name = "ProviderNotConfiguredError";
  }
}

export function now(): number {
  return Date.now();
}
