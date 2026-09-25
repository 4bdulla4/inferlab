import { describe, expect, it } from "vitest";
import type { ToolCallRequest } from "../../shared/agent";
import { analyzeDescription, editDistance, refineWithModel, stem, wordMatches } from "./blueprint";
import { describeTools } from "./tools";
import type { AgentModel, ModelTurn, ModelTurnRequest } from "./types";

const ids = (d: string) => analyzeDescription(d).tools.map((t) => t.id);

describe("word matching", () => {
  it("tolerates typos and word endings", () => {
    expect(wordMatches("serach", "search")).toBe(true);
    expect(wordMatches("calcualte", "calculate")).toBe(true);
    expect(wordMatches("searching", "search")).toBe(true);
    expect(wordMatches("remembers", "remember")).toBe(true);
    expect(wordMatches("databse", "database")).toBe(true);
    expect(editDistance("teh", "the")).toBe(1);
    expect(stem("running")).toBe("run");
    expect(stem("searches")).toBe("search");
  });
  it("does not match short unrelated words loosely", () => {
    expect(wordMatches("cat", "car")).toBe(false);
    expect(wordMatches("time", "tame")).toBe(false);
    expect(wordMatches("fine", "file")).toBe(false);
  });
});

describe("rule analyzer: everyday descriptions", () => {
  it("research with a date sum", () => {
    const b = analyzeDescription("find out when the eiffel tower was built and how many years ago that was");
    expect(b.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["web_search", "calculator"]));
    expect(b.tools.find((t) => t.id === "web_search")!.evidence).toEqual(expect.arrayContaining(["find out"]));
    expect(b.needsKnowledgeBase).toBe(false);
  });

  it("one misspelled but specific word is enough", () => {
    expect(ids("serach the web for the tallest building and calcualte how old it is")).toEqual(expect.arrayContaining(["web_search", "calculator"]));
  });

  it("messy spelling still lands on the right tools", () => {
    const b = analyzeDescription("i want an agnet that serach the web for laptop prices, calcualte the avarage and save a repot to a file");
    expect(b.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["web_search", "calculator", "file_ops"]));
  });

  it("sending things needs approval and is named as a gap when it is email", () => {
    const b = analyzeDescription("Check today's date and send me an email with a summary.");
    expect(ids("Check today's date and send me an email with a summary.")).toEqual(expect.arrayContaining(["external_service", "clock"]));
    expect(b.approvalRequired).toContain("external_service");
    expect(b.gaps.map((g) => g.capability)).toContain("Sending real email");
  });

  it("documents of the person's own mean retrieval", () => {
    const b = analyzeDescription("answer questions from my documents in the knowledge base and remember the key points for next time", { knowledgeBaseAvailable: false });
    expect(b.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["rag_retrieve", "memory"]));
    expect(b.needsKnowledgeBase).toBe(true);
    expect(b.warnings.join(" ")).toMatch(/Add them in the RAG lab/);
    expect(b.systemPrompt).toMatch(/knowledge base/);
  });

  it("code and data descriptions pick code_exec and database", () => {
    expect(ids("write a javascript program that sorts a list of numbers and run it")).toContain("code_exec");
    expect(ids("which product category made the most revenue in the orders database")).toContain("database");
  });

  it("everyday 'check' does not mean asking the person", () => {
    expect(ids("check today's date and check the weather in Lahore")).not.toContain("ask_human");
    expect(ids("check with me before you send anything")).toContain("ask_human");
  });

  it("asking the person becomes ask_human", () => {
    const b = analyzeDescription("ask me which city I am in, then tell me the weather there");
    expect(b.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["ask_human", "http_api"]));
    expect(b.warnings.join(" ")).toMatch(/open-meteo/);
  });

  it("a pasted link means reading a page", () => {
    const b = analyzeDescription("summarize https://en.wikipedia.org/wiki/Rayleigh_scattering in three sentences");
    expect(b.tools.map((t) => t.id)).toContain("web_fetch");
    expect(b.constraints).toContain("Answer in three sentences.");
  });

  it("flaky services wire up retries and a fallback", () => {
    const b = analyzeDescription("call the status service, which is unreliable; if it keeps failing use a fallback");
    expect(b.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["unreliable_service", "external_service"]));
    expect(b.fallbacks).toEqual({ unreliable_service: "external_service" });
    expect(b.retry.maxAttempts).toBe(3);
  });

  it("detects parallel work and sets a sensible iteration cap", () => {
    const many = analyzeDescription("look up the population of Tokyo, Delhi and Cairo and rank them");
    expect(many.parallelToolCalls).toBe(true);
    const single = analyzeDescription("what is the capital of Peru");
    expect(single.parallelToolCalls).toBe(false);
    expect(single.maxIterations).toBeGreaterThanOrEqual(3);
    expect(many.maxIterations).toBeLessThanOrEqual(12);
  });

  it("turns constraints into instructions and keeps them in the person's words", () => {
    const b = analyzeDescription("Research solar panels and answer in Urdu, briefly, citing sources. Do not use the database.");
    expect(b.constraints).toEqual(expect.arrayContaining(["Write the final answer in Urdu.", "Keep the answer short.", "Name the sources or tools behind each fact.", "Do not use the database."]));
    expect(b.systemPrompt).toMatch(/Urdu/);
  });

  it("names gaps honestly instead of pretending", () => {
    const b = analyzeDescription("every morning log into my bank, pay the electricity bill and message me on whatsapp");
    const caps = b.gaps.map((g) => g.capability);
    expect(caps).toEqual(expect.arrayContaining(["Running on a schedule", "Driving a website like a person (logins, forms, clicks, purchases)", "Moving money", "Posting to a chat or messaging app"]));
  });

  it("writes the goal as an instruction", () => {
    expect(analyzeDescription("I want an agent that finds cheap flights to Dubai").goal).toBe("Find cheap flights to Dubai.");
    expect(analyzeDescription("an assistant which searches wikipedia for volcanoes").goal).toBe("Search wikipedia for volcanoes.");
    expect(analyzeDescription("tell me a joke").goal).toBe("Tell me a joke.");
  });

  it("is deterministic and says when nothing matched", () => {
    const a = analyzeDescription("tell me a joke");
    const b = analyzeDescription("tell me a joke");
    expect(a).toEqual(b);
    expect(a.tools).toEqual([]);
    expect(a.warnings.join(" ")).toMatch(/No tool matched/);
    expect(a.summary).toMatch(/no tools/);
  });

  it("recognises Urdu script and asks for the same language back", () => {
    const b = analyzeDescription("آج کا موسم بتاؤ اور مجھے پیغام بھیجو weather");
    expect(b.constraints.join(" ")).toMatch(/Urdu or Arabic script/);
  });
});

/* ────────────────────────────── refinement ─────────────────────────── */

class Proposer implements AgentModel {
  readonly id = "mock" as const;
  readonly model = "proposer";
  readonly vendor = "test";
  readonly mock = true;
  constructor(private readonly args: Record<string, unknown> | null) {}
  async complete(req: ModelTurnRequest): Promise<ModelTurn> {
    void req;
    const toolCalls: ToolCallRequest[] = this.args ? [{ id: "p1", name: "propose_agent", args: this.args }] : [];
    return { text: this.args ? "" : "Here is my plan in prose.", toolCalls, usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 }, latencyMs: 5, ttfbMs: null, stopReason: "end_turn", model: "proposer", source: "simulation" };
  }
}

const catalogue = describeTools({ ragKbId: null, customTools: [] }, null).map((t) => ({ id: t.id, description: t.description, source: t.source }));

describe("model refinement is validated by code", () => {
  it("merges the proposal, drops unknown tools and keeps the rule floor", async () => {
    const rules = analyzeDescription("find the population of Lahore and save it to a file");
    const model = new Proposer({ goal: "Find Lahore's population and save it to lahore.txt.", summary: "Looks it up and saves it.", tools: "web_search, file_ops, send_email, clock", approvalRequired: "file_ops", parallelToolCalls: false, maxIterations: 99, systemPrompt: "Use metric units.", gaps: "sending email" });
    const b = await refineWithModel("find the population of Lahore and save it to a file", rules, model, catalogue, new AbortController().signal);
    expect(b.source).toBe("ai+rules");
    expect(b.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["web_search", "file_ops", "clock"]));
    expect(b.tools.map((t) => t.id)).not.toContain("send_email");
    expect(b.tools.find((t) => t.id === "web_search")!.from).toBe("both");
    expect(b.tools.find((t) => t.id === "clock")!.from).toBe("ai");
    expect(b.maxIterations).toBe(12);
    expect(b.approvalRequired).toContain("file_ops");
    expect(b.systemPrompt).toMatch(/metric units/);
    // The model's "sending email" duplicates the rule gap about email, so it is folded in rather than repeated.
    expect(b.gaps.filter((g) => /email/i.test(`${g.capability} ${g.suggestion}`)).length).toBeLessThanOrEqual(1);
    expect(b.warnings.join(" ")).toMatch(/send_email.*dropped/);
    expect(b.goal).toBe("Find Lahore's population and save it to lahore.txt.");
  });

  it("falls back to the rules when the model answers in prose", async () => {
    const rules = analyzeDescription("calculate 12% of 480");
    const b = await refineWithModel("calculate 12% of 480", rules, new Proposer(null), catalogue, new AbortController().signal);
    expect(b.source).toBe("rules");
    expect(b.tools.map((t) => t.id)).toEqual(["calculator"]);
    expect(b.warnings.join(" ")).toMatch(/prose/);
  });
});
