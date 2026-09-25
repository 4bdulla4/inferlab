import { describe, expect, it } from "vitest";
import { createSSEParser } from "./llmClient";

describe("createSSEParser", () => {
  it("parses events split across arbitrary chunk boundaries", () => {
    const got: [string, string][] = [];
    const parse = createSSEParser((name, data) => got.push([name, data]));
    const frames = 'event: text_delta\ndata: {"a":1}\n\n: ping\n\nevent: end\ndata: {}\n\n';
    for (let i = 0; i < frames.length; i += 7) parse(frames.slice(i, i + 7));
    expect(got).toEqual([
      ["text_delta", '{"a":1}'],
      ["end", "{}"],
    ]);
  });

  it("handles CRLF and multi-line data", () => {
    const got: [string, string][] = [];
    const parse = createSSEParser((name, data) => got.push([name, data]));
    parse("data: line1\r\ndata: line2\r\n\r\n");
    expect(got).toEqual([["message", "line1\nline2"]]);
  });
});
