import { describe, expect, it } from "vitest";
import { LLMEventSequencer, DETAILED_STEPS, PACE } from "./sequencer";
import { claudeDescriptor, openaiDescriptor, sampleServerEvents } from "@/test/fixtures";
import type { AnyLLMEvent } from "./events";

function runAll(descriptor = claudeDescriptor, logprobs = false): AnyLLMEvent[] {
  const seq = new LLMEventSequencer("run-1", "Why is the sky blue?", descriptor);
  const out = [...seq.begin()];
  for (const ev of sampleServerEvents({ logprobs })) out.push(...seq.fromServer(ev));
  return out;
}

describe("LLMEventSequencer", () => {
  it("produces a monotonically increasing seq with unique ids", () => {
    const events = runAll();
    events.forEach((e, i) => expect(e.seq).toBe(i));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("orders the pipeline stages in execution order", () => {
    const types: string[] = runAll().map((e) => e.type);
    const order = ["INPUT_RECEIVED", "REQUEST_PREPARED", "TOKENIZATION_COMPLETED", "TOKEN_IDS_COMPLETED", "EMBEDDING_COMPLETED", "POSITIONAL_INFO_COMPLETED", "REQUEST_SENT", "ATTENTION_COMPLETED", "MLP_COMPLETED", "RESPONSE_STARTED", "GENERATION_STARTED", "LOGITS_COMPLETED", "TOKEN_SELECTED", "TOKEN_GENERATED", "GENERATION_COMPLETED", "DETOKENIZATION_COMPLETED", "OUTPUT_COMPLETED"];
    let last = -1;
    for (const t of order) {
      const idx = types.indexOf(t);
      expect(idx, t).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("labels simulated stages as simulation and API facts as live", () => {
    const events = runAll();
    const bySrc = (type: string) => events.find((e) => e.type === type)?.source;
    expect(bySrc("REQUEST_PREPARED")).toBe("live");
    expect(bySrc("EMBEDDING_COMPLETED")).toBe("simulation");
    expect(bySrc("ATTENTION_COMPLETED")).toBe("simulation");
    expect(bySrc("TOKEN_GENERATED")).toBe("live");
    expect(bySrc("USAGE_REPORTED")).toBe("live");
    expect(bySrc("OUTPUT_COMPLETED")).toBe("live");
    // Claude's tokenization is approximate → simulation
    expect(bySrc("TOKENIZATION_COMPLETED")).toBe("simulation");
  });

  it("marks candidates live only when the provider returned logprobs", () => {
    const claude = runAll(claudeDescriptor, false).filter((e) => e.type === "LOGITS_COMPLETED");
    const openai = runAll(openaiDescriptor, true).filter((e) => e.type === "LOGITS_COMPLETED");
    expect(claude.every((e) => e.source === "simulation")).toBe(true);
    expect(openai.every((e) => e.source === "live")).toBe(true);
    expect(openai.length).toBe(DETAILED_STEPS);
  });

  it("uses the full cycle for the first steps and compact events afterwards", () => {
    const events = runAll();
    const generated = events.filter((e) => e.type === "TOKEN_GENERATED");
    expect(generated).toHaveLength(8);
    expect(generated.slice(0, DETAILED_STEPS).every((e) => e.status === "completed")).toBe(true);
    expect(generated.slice(DETAILED_STEPS).every((e) => e.status === "progress")).toBe(true);
    expect(events.filter((e) => e.type === "LOGITS_STARTED")).toHaveLength(DETAILED_STEPS);
  });

  it("never fabricates a selected token: every generated token equals the streamed text", () => {
    const streamed = sampleServerEvents().filter((e) => e.type === "text_delta").map((e) => (e.type === "text_delta" ? e.text : ""));
    const generated = runAll().filter((e) => e.type === "TOKEN_GENERATED").map((e) => (e.data as { token: string }).token);
    expect(generated).toEqual(streamed);
  });

  it("attributes errors to the last LIVE stage, not a simulation stage", () => {
    const seq = new LLMEventSequencer("r", "hi", openaiDescriptor);
    seq.begin();
    const events = sampleServerEvents({ logprobs: true });
    seq.fromServer(events[0]!); // request_prepared (live)
    seq.fromServer(events[1]!); // tokenization (live for OpenAI) + simulated embeddings/positional
    const [err] = seq.fromServer({ type: "error", at: 1, message: "boom", status: 429, retryable: true });
    expect(err!.type).toBe("EXECUTION_ERROR");
    expect(err!.stage).toBe("tokenIds");

    const seq2 = new LLMEventSequencer("r2", "hi", claudeDescriptor);
    seq2.begin();
    for (const ev of sampleServerEvents().slice(0, 4)) seq2.fromServer(ev); // through request_sent (+ simulated attention/mlp)
    const [err2] = seq2.fromServer({ type: "error", at: 1, message: "401", status: 401, retryable: false });
    expect(err2!.stage).toBe("transformer");
  });

  it("holds each stage that draws something long enough to read it at 1x", () => {
    // The stages a person actually studies, as opposed to bookkeeping markers.
    const withVisuals = [
      "TOKENIZATION_COMPLETED", "TOKEN_IDS_COMPLETED", "EMBEDDING_COMPLETED",
      "POSITIONAL_INFO_COMPLETED", "ATTENTION_COMPLETED", "MLP_COMPLETED",
      "LOGITS_COMPLETED", "DETOKENIZATION_COMPLETED",
    ];
    const events = runAll();
    for (const type of withVisuals) {
      const event = events.find((e) => e.type === type);
      expect(event, type).toBeDefined();
      expect(event!.duration, type).toBeGreaterThanOrEqual(1200);
      expect(event!.compressible, type).toBe(false);
    }
  });

  it("marks only the repeated per-token events as safe to fast-forward", () => {
    const events = runAll();
    const compressible = events.filter((e) => e.compressible);
    for (const e of compressible) expect(["TOKEN_GENERATED", "REASONING_DELTA"]).toContain(e.type);
    // The detailed opening steps stay at full speed so the loop can be followed.
    const detailed = events.filter((e) => e.type === "TOKEN_GENERATED" && e.status === "completed");
    expect(detailed.length).toBe(DETAILED_STEPS);
    for (const e of detailed) expect(e.compressible).toBe(false);
  });

  it("scales every dwell by one pace multiplier", () => {
    expect(PACE).toBeGreaterThan(1);
    const first = runAll()[0]!;
    expect(first.duration).toBe(Math.round(500 * PACE));
  });
});