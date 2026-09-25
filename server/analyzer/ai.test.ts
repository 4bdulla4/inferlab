import { describe, expect, it } from "vitest";
import { SUMMARY_SCHEMA, TRACE_SCHEMA } from "./ai";

/** Structured outputs accept only a subset of JSON Schema; guard the constraints we know are rejected. */
function walk(node: unknown, path: string, problems: string[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (n.type === "array") {
    if (typeof n.minItems === "number" && n.minItems > 1) problems.push(`${path}.minItems=${n.minItems}`);
    if ("maxItems" in n) problems.push(`${path}.maxItems`);
  }
  if (n.type === "object" && n.additionalProperties !== false) problems.push(`${path}.additionalProperties must be false`);
  for (const [k, v] of Object.entries(n)) if (typeof v === "object" && v) walk(v, `${path}.${k}`, problems);
}

describe("AI output schemas", () => {
  it("use only constraints the structured-outputs API supports", () => {
    for (const [name, schema] of [["SUMMARY_SCHEMA", SUMMARY_SCHEMA], ["TRACE_SCHEMA", TRACE_SCHEMA]] as const) {
      const problems: string[] = [];
      walk(schema, name, problems);
      expect(problems, name).toEqual([]);
    }
  });
});
