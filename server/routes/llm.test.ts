import { describe, expect, it } from "vitest";
import { sanitize, validateChatBody } from "./llm";

describe("validateChatBody", () => {
  it("accepts a well-formed body and clamps settings", () => {
    const r = validateChatBody({ provider: "claude", message: "hi", settings: { temperature: 9, maxOutputTokens: 99999, streaming: "yes" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.settings.temperature).toBe(2);
      expect(r.value.settings.maxOutputTokens).toBe(4096);
      expect(r.value.settings.streaming).toBe(true);
    }
  });

  it("rejects unknown providers and empty messages", () => {
    expect(validateChatBody({ provider: "llama", message: "hi" }).ok).toBe(false);
    expect(validateChatBody({ provider: 42, message: "hi" }).ok).toBe(false);
    expect(validateChatBody({ provider: "openai", message: "   " }).ok).toBe(false);
    expect(validateChatBody(null).ok).toBe(false);
  });

  it("accepts every provider the platform ships", () => {
    for (const provider of ["claude", "openai", "gemini", "mock"]) {
      const r = validateChatBody({ provider, message: "hi" });
      expect(r.ok, provider).toBe(true);
      if (r.ok) expect(r.value.provider).toBe(provider);
    }
  });

  it("applies defaults when settings are missing", () => {
    const r = validateChatBody({ provider: "openai", message: "hi" });
    expect(r.ok && r.value.settings).toEqual({ temperature: 0.7, maxOutputTokens: 500, streaming: true, systemPrompt: "", effort: "none" });
  });
});

describe("sanitize", () => {
  it("scrubs raw and provider-masked API keys from error messages", () => {
    expect(sanitize("401 Incorrect API key provided: sk-proj-**********************4Aeg. You can find")).not.toMatch(/sk-proj/);
    expect(sanitize("bad key sk-ant-api03-abcdefghijklmnop")).toBe("bad key <REDACTED>");
    expect(sanitize("Authorization: Bearer abcdefgh12345678")).toMatch(/Bearer <REDACTED>/);
    expect(sanitize("plain message")).toBe("plain message");
  });
});
