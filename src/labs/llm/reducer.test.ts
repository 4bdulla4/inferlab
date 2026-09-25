import { describe, expect, it } from "vitest";
import { applyLLMEvent } from "./reducer";
import { LLMEventSequencer } from "./sequencer";
import { CLAUDE_SPEC, OPENAI_SPEC } from "./pipelines/specs";
import { createVisualState, type VisualState } from "./state";
import { claudeDescriptor, openaiDescriptor, sampleServerEvents } from "@/test/fixtures";

function play(logprobs = false): VisualState {
  const seq = new LLMEventSequencer("run-1", "Why is the sky blue?", logprobs ? openaiDescriptor : claudeDescriptor);
  let state = createVisualState(20);
  for (const e of seq.begin()) state = applyLLMEvent(state, e);
  for (const ev of sampleServerEvents({ logprobs })) for (const e of seq.fromServer(ev)) state = applyLLMEvent(state, e);
  return state;
}

describe("applyLLMEvent", () => {
  it("completes every stage of the provider's pipeline after a successful run", () => {
    const s = play();
    // Claude's pipeline; "thinking" only fires when the model actually reasons.
    const expected = CLAUDE_SPEC.order.filter((id) => id !== "thinking");
    for (const id of expected) expect(s.nodes[id], id).toBe("completed");
    expect(s.currentStage).toBe("response");
  });

  it("leaves stages that never fired idle instead of inventing state", () => {
    const s = play();
    expect(s.nodes.thinking).toBe("idle");
    // "reasoning" belongs to OpenAI's pipeline and is not part of Claude's.
    expect(CLAUDE_SPEC.order).not.toContain("reasoning");
    expect(s.nodes.reasoning).toBe("idle");
  });

  it("routes a Claude reasoning delta to the thinking stage and an OpenAI one to reasoning", () => {
    for (const [descriptor, stage, other] of [
      [claudeDescriptor, "thinking", "reasoning"],
      [openaiDescriptor, "reasoning", "thinking"],
    ] as const) {
      const seq = new LLMEventSequencer("r", "hi", descriptor);
      let state = createVisualState(2);
      for (const e of seq.begin()) state = applyLLMEvent(state, e);
      for (const e of seq.fromServer({ type: "reasoning_delta", at: 1, text: "pondering" })) state = applyLLMEvent(state, e);
      expect(state.nodes[stage], `${descriptor.id} → ${stage}`).toBe("processing");
      expect(state.nodes[other]).toBe("idle");
      expect(state.generation.reasoning).toBe("pondering");
    }
  });

  it("gives Claude a dedicated token-counting stage that OpenAI does not have", () => {
    const claude = play(false);
    expect(claude.nodes.tokenCount).toBe("completed");
    expect(claude.metrics.inputTokenCount).toBe(21);
    expect(OPENAI_SPEC.order).not.toContain("tokenCount");
    const openai = play(true);
    expect(openai.nodes.tokenCount).toBe("idle");
    expect(openai.metrics.inputTokenCount).toBe(21);
  });

  it("assembles the streamed text and metrics", () => {
    const s = play();
    expect(s.generation.text).toBe("The sky is blue because of scattering.");
    expect(s.generation.steps).toHaveLength(8);
    expect(s.metrics.outputTokens).toBe(8);
    expect(s.metrics.inputTokens).toBe(21);
    expect(s.metrics.totalTokens).toBe(29);
    expect(s.metrics.latencyMs).toBe(860);
    expect(s.metrics.finishReason).toBe("end_turn");
    expect(s.metrics.inputTokenSource).toBe("live");
  });

  it("keeps node sources honest per provider", () => {
    const claude = play(false);
    const openai = play(true);
    expect(claude.nodeSources.tokenization).toBe("simulation");
    expect(openai.nodeSources.tokenization).toBe("live");
    expect(claude.logits?.source).toBe("simulation");
    expect(openai.logits?.source).toBe("live");
    expect(claude.nodeSources.embeddings).toBe("simulation");
    expect(claude.nodeSources.response).toBe("live");
  });

  it("puts the generation cycle into processing while streaming, then completes it", () => {
    const seq = new LLMEventSequencer("r", "hi", claudeDescriptor);
    let state = createVisualState(2);
    const events = sampleServerEvents();
    for (const e of seq.begin()) state = applyLLMEvent(state, e);
    for (const ev of events.slice(0, 6)) for (const e of seq.fromServer(ev)) state = applyLLMEvent(state, e); // through first delta
    expect(state.nodes.loop).toBe("processing");
    expect(state.nodes.transformer).toBe("processing");
    expect(state.generation.started).toBe(true);
    expect(state.generation.completed).toBe(false);
  });

  it("builds one timeline entry per stage with counts for loop stages", () => {
    const s = play();
    const stages = s.timeline.map((t) => t.stage);
    expect(new Set(stages).size).toBe(stages.length);
    const next = s.timeline.find((t) => t.stage === "nextToken");
    expect(next?.count).toBe(8);
    expect(s.timeline.find((t) => t.stage === "logits")?.count).toBe(3);
    expect(s.timeline.find((t) => t.stage === "loop")?.count).toBe(1);
    expect(s.timeline.find((t) => t.stage === "transformer")?.count).toBe(1);
    expect(s.timeline.every((t) => t.status === "completed")).toBe(true);
    // detokenization precedes the final response in the timeline
    expect(stages.indexOf("detokenization")).toBeLessThan(stages.indexOf("response"));
  });

  it("marks the failing stage and active nodes as error", () => {
    const seq = new LLMEventSequencer("r", "hi", claudeDescriptor);
    let state = createVisualState(2);
    for (const e of seq.begin()) state = applyLLMEvent(state, e);
    for (const ev of sampleServerEvents().slice(0, 4)) for (const e of seq.fromServer(ev)) state = applyLLMEvent(state, e);
    for (const e of seq.fromServer({ type: "error", at: 1, message: "rate limited", status: 429, retryable: true })) state = applyLLMEvent(state, e);
    expect(state.error?.message).toBe("rate limited");
    expect(state.error?.status).toBe(429);
    expect(state.nodes[state.error!.stage]).toBe("error");
    expect(Object.values(state.nodes)).not.toContain("processing");
  });

  it("is pure: does not mutate the previous state", () => {
    const seq = new LLMEventSequencer("r", "hi", claudeDescriptor);
    const initial = createVisualState(2);
    const frozen = JSON.stringify(initial);
    applyLLMEvent(initial, seq.begin()[0]!);
    expect(JSON.stringify(initial)).toBe(frozen);
  });
});
