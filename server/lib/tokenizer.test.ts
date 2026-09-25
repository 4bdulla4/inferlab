import { describe, expect, it } from "vitest";
import { approximateTokenization, encodingForOpenAIModel, exactTokenization, tokenize } from "./tokenizer";

describe("tokenizer", () => {
  it("round-trips text through o200k_base", () => {
    const { tokens, ids } = tokenize("Why is the sky blue?", "o200k_base");
    expect(ids).toEqual([13903, 382, 290, 17307, 9861, 30]);
    expect(tokens.join("")).toBe("Why is the sky blue?");
  });

  it("labels exact vs approximate tokenization honestly", () => {
    expect(exactTokenization("hi", "gpt-4.1-mini")).toMatchObject({ exact: true, source: "live", encoding: "o200k_base" });
    expect(approximateTokenization("hi", "Claude")).toMatchObject({ exact: false, source: "simulation" });
    expect(approximateTokenization("hi", "Claude").note).toMatch(/not public/i);
  });

  it("maps model families to encodings", () => {
    expect(encodingForOpenAIModel("gpt-4o-mini")).toBe("o200k_base");
    expect(encodingForOpenAIModel("gpt-5")).toBe("o200k_base");
    expect(encodingForOpenAIModel("o3-mini")).toBe("o200k_base");
    expect(encodingForOpenAIModel("gpt-4-turbo")).toBe("cl100k_base");
    expect(encodingForOpenAIModel("gpt-3.5-turbo")).toBe("cl100k_base");
  });
});
