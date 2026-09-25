import { describe, expect, it } from "vitest";
import { sanitizeKey } from "./sessionKeys";

describe("sanitizeKey", () => {
  it("accepts plausible keys and rejects junk", () => {
    expect(sanitizeKey("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe("sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
    expect(sanitizeKey("  ghp_abcdefghijklmnopqrstuvwxyz  ")).toBe("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(sanitizeKey("short")).toBeUndefined();
    expect(sanitizeKey("has whitespace inside the key value")).toBeUndefined();
    expect(sanitizeKey(undefined)).toBeUndefined();
    expect(sanitizeKey("x".repeat(600))).toBeUndefined();
  });
});
