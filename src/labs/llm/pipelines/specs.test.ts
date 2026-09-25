import { describe, expect, it } from "vitest";
import { CLAUDE_SPEC, OPENAI_SPEC, PIPELINE_DIFFERENCES, getPipelineSpec } from "./specs";
import { LLM_STAGES } from "../stages";

describe("provider pipeline specs", () => {
  it("models the providers as genuinely different pipelines", () => {
    const claude = new Set(CLAUDE_SPEC.order);
    const openai = new Set(OPENAI_SPEC.order);
    // Claude can count tokens up front and can stream summarized thinking.
    expect(claude.has("tokenCount")).toBe(true);
    expect(claude.has("thinking")).toBe(true);
    expect(openai.has("tokenCount")).toBe(false);
    expect(openai.has("thinking")).toBe(false);
    // OpenAI reports hidden reasoning tokens instead.
    expect(openai.has("reasoning")).toBe(true);
    expect(claude.has("reasoning")).toBe(false);
    expect(CLAUDE_SPEC.api).toBe("POST /v1/messages");
    expect(OPENAI_SPEC.api).toBe("POST /v1/responses");
  });

  it("marks probabilities live only for OpenAI and tokenization exact only for OpenAI", () => {
    expect(CLAUDE_SPEC.stages.probabilities!.defaultSource).toBe("simulation");
    expect(OPENAI_SPEC.stages.probabilities!.defaultSource).toBe("live");
    expect(CLAUDE_SPEC.stages.tokenization!.defaultSource).toBe("simulation");
    expect(OPENAI_SPEC.stages.tokenization!.defaultSource).toBe("live");
  });

  it("lays every stage out inside the canvas without overlapping boxes", () => {
    for (const spec of [CLAUDE_SPEC, OPENAI_SPEC]) {
      const { nodes, width, height } = spec.layout;
      expect(nodes.length).toBe(spec.order.length);
      for (const n of nodes) {
        expect(n.x, `${spec.provider}/${n.id} x`).toBeGreaterThanOrEqual(0);
        expect(n.y, `${spec.provider}/${n.id} y`).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w, `${spec.provider}/${n.id} right`).toBeLessThanOrEqual(width);
        expect(n.y + n.h, `${spec.provider}/${n.id} bottom`).toBeLessThanOrEqual(height);
      }
      // Sibling boxes in the same band must not overlap.
      const bands = new Map<number, typeof nodes>();
      for (const n of nodes.filter((x) => x.variant === "default")) {
        const list = bands.get(n.y) ?? [];
        list.push(n);
        bands.set(n.y, list);
      }
      for (const list of bands.values()) {
        const sorted = [...list].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(sorted[i]!.x + sorted[i]!.w, `${spec.provider} band ${sorted[i]!.id}`).toBeLessThanOrEqual(sorted[i + 1]!.x + 0.001);
        }
      }
    }
  });

  it("connects every stage into the graph", () => {
    for (const spec of [CLAUDE_SPEC, OPENAI_SPEC]) {
      const touched = new Set(spec.layout.connections.flatMap((c) => [c.from, c.to]));
      for (const id of spec.order) expect(touched.has(id), `${spec.provider}/${id} is connected`).toBe(true);
      for (const c of spec.layout.connections) expect(c.points.length).toBeGreaterThanOrEqual(2);
      for (const id of spec.cycle) expect(spec.layout.connections.some((c) => c.id === id), `${spec.provider} cycle ${id}`).toBe(true);
    }
  });

  it("falls back to the Claude shape for providers without a spec", () => {
    expect(getPipelineSpec("mock").provider).toBe("claude");
    expect(getPipelineSpec(undefined).provider).toBe("claude");
    expect(getPipelineSpec("openai").provider).toBe("openai");
  });

  it("documents each difference against a real stage", () => {
    expect(PIPELINE_DIFFERENCES.length).toBeGreaterThanOrEqual(12);
    for (const d of PIPELINE_DIFFERENCES) {
      expect(d.claude.length).toBeGreaterThan(10);
      expect(d.openai.length).toBeGreaterThan(10);
      if (d.stage) expect(LLM_STAGES[d.stage]).toBeDefined();
    }
  });
});
