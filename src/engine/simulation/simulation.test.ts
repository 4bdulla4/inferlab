import { describe, expect, it } from "vitest";
import { candidatesFromLogprobs, simulateAttention, simulateCandidates, simulateEmbeddings } from "./index";

describe("simulation", () => {
  it("embeddings are deterministic and identical for identical tokens", () => {
    const a = simulateEmbeddings(["sky", " blue", "sky"]);
    const b = simulateEmbeddings(["sky", " blue", "sky"]);
    expect(a).toEqual(b);
    expect(a.vectors[0]!.values).toEqual(a.vectors[2]!.values);
    expect(a.vectors[0]!.values.every((v) => v >= -1 && v <= 1)).toBe(true);
  });

  it("attention is causal and rows sum to one", () => {
    const attn = simulateAttention(["Why", " is", " the", " sky", " blue", "?"]);
    attn.weights.forEach((row, i) => {
      expect(row.slice(0, i + 1).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 6);
      expect(row.slice(i + 1).every((w) => w === 0)).toBe(true);
    });
    expect(attn.note).toMatch(/simulation/i);
  });

  it("simulated candidates keep the real token selected and label themselves", () => {
    const set = simulateCandidates(3, " because", ["The", " sky", " is", " blue"]);
    const selected = set.candidates.filter((c) => c.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.token).toBe(" because");
    expect(set.source).toBe("simulation");
    expect(set.candidates.reduce((s, c) => s + c.probability, 0)).toBeLessThanOrEqual(1.0001);
    expect(simulateCandidates(3, " because", ["The", " sky", " is", " blue"])).toEqual(set);
  });

  it("converts real logprobs to probabilities and marks them live", () => {
    const set = candidatesFromLogprobs(0, { token: "The", logprob: -0.1, top: [{ token: "The", logprob: -0.1 }, { token: "A", logprob: -2.3 }] });
    expect(set.source).toBe("live");
    expect(set.candidates[0]!.token).toBe("The");
    expect(set.candidates[0]!.probability).toBeCloseTo(Math.exp(-0.1), 6);
    expect(set.candidates).toHaveLength(2);
  });
});
