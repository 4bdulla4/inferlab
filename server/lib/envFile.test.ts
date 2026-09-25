import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateEnvFile } from "./envFile";

describe("updateEnvFile", () => {
  it("replaces existing keys in place, appends new ones and clears empty values", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    const file = join(dir, ".env");
    writeFileSync(file, "# comment\nANTHROPIC_API_KEY=old\nAPI_PORT=8790\n");
    updateEnvFile(file, { ANTHROPIC_API_KEY: "new-value", GITHUB_TOKEN: "tok", API_PORT: "" });
    expect(readFileSync(file, "utf8")).toBe("# comment\nANTHROPIC_API_KEY=new-value\nAPI_PORT=\nGITHUB_TOKEN=tok\n");
  });
  it("creates the file when missing", () => {
    const file = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
    updateEnvFile(file, { OPENAI_API_KEY: "x" });
    expect(readFileSync(file, "utf8")).toBe("OPENAI_API_KEY=x\n");
  });
});
