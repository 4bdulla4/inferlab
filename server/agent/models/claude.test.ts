import { describe, expect, it } from "vitest";
import { withCacheBreakpoint } from "./claude";

describe("withCacheBreakpoint", () => {
  it("marks only the last block of the last message, converting string content", () => {
    const out = withCacheBreakpoint([
      { role: "user", content: "goal" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a" }, { type: "tool_result", tool_use_id: "t2", content: "b" }] },
    ]);
    expect(out[0]).toEqual({ role: "user", content: "goal" });
    const last = out[2]!.content as { cache_control?: unknown }[];
    expect(last[0]!.cache_control).toBeUndefined();
    expect(last[1]!.cache_control).toEqual({ type: "ephemeral" });
    const single = withCacheBreakpoint([{ role: "user", content: "hello" }]);
    expect(single[0]!.content).toEqual([{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }]);
    expect(withCacheBreakpoint([])).toEqual([]);
  });
});
