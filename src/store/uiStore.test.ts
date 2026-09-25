import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderDescriptor } from "@shared/llm";
import { selectProvider, selectProviders, sessionHeaders, useUIStore } from "./uiStore";

const providers: ProviderDescriptor[] = [
  { id: "claude", name: "Claude", vendor: "Anthropic", model: "claude-opus-5", configured: false, capabilities: { streaming: true, temperature: false, logprobs: false, effort: true, exactTokenizer: false, inputTokenCount: "live", reasoning: true }, tokenizerNote: "" },
  { id: "openai", name: "OpenAI", vendor: "OpenAI", model: "gpt-5.6", configured: true, capabilities: { streaming: true, temperature: true, logprobs: true, effort: true, exactTokenizer: true, inputTokenCount: "estimate", reasoning: true }, tokenizerNote: "" },
];

describe("uiStore session keys", () => {
  beforeEach(() => {
    useUIStore.getState().clearSessionKeys();
    useUIStore.getState().setProviders(providers);
  });

  it("returns stable references from selectors (no re-render loops)", () => {
    const a = selectProviders(useUIStore.getState());
    const b = selectProviders(useUIStore.getState());
    expect(a).toBe(b);
    expect(selectProvider(useUIStore.getState())).toBe(selectProvider(useUIStore.getState()));
  });

  it("marks a provider configured with a session key and reports the key source", () => {
    expect(selectProviders(useUIStore.getState()).find((p) => p.id === "claude")).toMatchObject({ configured: false, keySource: "none" });
    useUIStore.getState().setSessionKey("anthropic", "sk-ant-test-key-0123456789abcdef");
    const claude = selectProviders(useUIStore.getState()).find((p) => p.id === "claude");
    expect(claude).toMatchObject({ configured: true, keySource: "session" });
    expect(selectProviders(useUIStore.getState()).find((p) => p.id === "openai")?.keySource).toBe("server");
    useUIStore.getState().setSessionKey("anthropic", "   ");
    expect(selectProviders(useUIStore.getState()).find((p) => p.id === "claude")?.configured).toBe(false);
  });

  it("builds request headers only for keys that are set and never persists them", () => {
    expect(sessionHeaders()).toEqual({});
    useUIStore.getState().setSessionKey("openai", "sk-test-openai-0123456789abcdef");
    useUIStore.getState().setSessionKey("github", "ghp_0123456789abcdefghij");
    expect(sessionHeaders()).toEqual({ "x-openai-api-key": "sk-test-openai-0123456789abcdef", "x-github-token": "ghp_0123456789abcdefghij" });
    expect(typeof globalThis.localStorage === "undefined" || Object.keys(globalThis.localStorage).length === 0).toBe(true);
  });
});
