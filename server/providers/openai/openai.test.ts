import { describe, expect, it } from "vitest";
import { OpenAIProvider, openAIModelProfile, resolveEffort } from "./OpenAIProvider";

describe("OpenAI model profile", () => {
  it("treats o-series and GPT-6 Astra as unable to run at effort none", () => {
    expect(openAIModelProfile("o3-mini").reasoningOnly).toBe(true);
    expect(openAIModelProfile("gpt-6-astra").reasoningOnly).toBe(true);
    expect(openAIModelProfile("gpt-5.6").reasoningOnly).toBe(false);
  });

  it("raises effort for models that reject none, and otherwise honours the request", () => {
    expect(resolveEffort("gpt-5.6", "none")).toBe("none");
    expect(resolveEffort("gpt-5.6", "high")).toBe("high");
    expect(resolveEffort("o3-mini", "none")).toBe("medium");
    expect(resolveEffort("gpt-5.6", undefined)).toBe("none");
  });

  it("only advertises logprobs and temperature when the model can run at effort none", () => {
    const flexible = new OpenAIProvider({ apiKey: undefined, model: "gpt-5.6" }).describe();
    expect(flexible.capabilities).toMatchObject({ logprobs: true, temperature: true, effort: true, exactTokenizer: true });
    const reasoningOnly = new OpenAIProvider({ apiKey: undefined, model: "o3-mini" }).describe();
    expect(reasoningOnly.capabilities).toMatchObject({ logprobs: false, temperature: false, effort: true });
  });
});
