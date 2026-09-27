import { describe, expect, it } from "vitest";
import type { AgentEvent, EvidenceCitation } from "@shared/agent";
import type { RepoAnalysis } from "@shared/repo";
import type { AiAnalyzer } from "../ai";
import { analyzeRepository } from "../analyzer";
import type { GitHubClient, TreeEntry } from "../github";
import { checkEvidence, extractCitations } from "./evidence";
import { investigateRepository, OfflineInvestigatorModel, RepoWorkspace } from "./index";
import { buildInvestigatorTools, compileSearch } from "./tools";
import type { ToolContext } from "../../agent/types";

// A fake key assembled at runtime so no credential-shaped literal sits in the source.
const FAKE_KEY = ["sk", "ant", "x".repeat(24)].join("-");

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", dependencies: { express: "^4.19.0", "jsonwebtoken": "^9.0.0" } }),
  "src/server.ts": [
    'import express from "express";',
    'import { login } from "./auth/login";',
    "const app = express();",
    'app.post("/api/login", login);',
    "app.listen(3000);",
  ].join("\n"),
  "src/auth/login.ts": [
    'import { createSession } from "./session";',
    "export async function login(req, res) {",
    "  const user = await findUser(req.body.email);",
    "  if (!user) return res.status(401).end();",
    "  const token = createSession(user.id);",
    "  res.json({ token });",
    "}",
  ].join("\n"),
  "src/auth/session.ts": [
    'import jwt from "jsonwebtoken";',
    `const signingKey = "${FAKE_KEY}";`,
    "export function createSession(userId) {",
    "  return jwt.sign({ sub: userId }, process.env.JWT_SECRET);",
    "}",
  ].join("\n"),
  ".env": "JWT_SECRET=supersecretvalue123\nDATABASE_URL=postgres://u:p@db/shop\n",
  "docs/notes/deep/unscanned.md": "# notes\nsession tokens are signed with JWT\n",
};

function fakeGithub(files: Record<string, string>): GitHubClient & { fetched: string[] } {
  const fetched: string[] = [];
  const entries: TreeEntry[] = Object.entries(files).map(([path, text]) => ({ path, type: "blob", size: text.length, sha: path }));
  return {
    fetched,
    async getRepo() {
      return { fullName: "acme/shop", description: null, defaultBranch: "main", sha: "main", stars: 0, forks: 0, primaryLanguage: "TypeScript", license: null, homepage: null, topics: [], htmlUrl: "https://github.com/acme/shop", pushedAt: null, isPrivate: false, requestedRef: "main" };
    },
    async getTree() {
      return { sha: "abcdef1234567890", entries, truncated: false };
    },
    async getRawFile(_ref: unknown, _sha: string, path: string) {
      fetched.push(path);
      return files[path] ?? null;
    },
  } as unknown as GitHubClient & { fetched: string[] };
}

const noAi = { status: () => ({ available: false, note: "off" }) } as unknown as AiAnalyzer;

async function scan(files = FILES): Promise<{ analysis: RepoAnalysis; contents: Map<string, string> }> {
  let contents = new Map<string, string>();
  const analysis = await analyzeRepository("acme/shop", {
    github: fakeGithub(files),
    ai: noAi,
    emit: () => {},
    signal: new AbortController().signal,
    onContents: (_id, c) => (contents = c),
  });
  return { analysis, contents };
}

const ctx = { signal: new AbortController().signal } as ToolContext;

function tool(ws: RepoWorkspace, name: string) {
  const t = buildInvestigatorTools(ws).find((x) => x.descriptor.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

describe("RepoWorkspace", () => {
  it("redacts credential literals and strips .env values before any tool returns them", async () => {
    const { analysis, contents } = await scan();
    const ws = new RepoWorkspace(analysis, contents, fakeGithub(FILES));
    const session = await tool(ws, "read_file").execute({ path: "src/auth/session.ts" }, ctx);
    expect(session.content).not.toContain(FAKE_KEY);
    expect(session.content).toContain("<REDACTED>");
    const env = await tool(ws, "read_file").execute({ path: ".env" }, ctx);
    expect(env.content).toContain("JWT_SECRET=<REDACTED>");
    expect(env.content).not.toContain("supersecretvalue123");
    expect(env.content).not.toContain("postgres://");
    const search = await tool(ws, "search_code").execute({ pattern: "supersecret" }, ctx);
    expect(search.content).toMatch(/^0 matching lines/);
  });

  it("downloads a file the scan skipped, once, within the budget", async () => {
    const { analysis, contents } = await scan();
    contents.delete("docs/notes/deep/unscanned.md");
    const gh = fakeGithub(FILES);
    const ws = new RepoWorkspace(analysis, contents, gh, 1);
    const r = await tool(ws, "read_file").execute({ path: "docs/notes/deep/unscanned.md" }, ctx);
    expect(r.content).toContain("downloaded now");
    await tool(ws, "read_file").execute({ path: "docs/notes/deep/unscanned.md" }, ctx);
    expect(gh.fetched.filter((p) => p === "docs/notes/deep/unscanned.md")).toHaveLength(1);
    contents.delete("src/server.ts");
    const ws2 = new RepoWorkspace(analysis, contents, gh, 0);
    await expect(tool(ws2, "read_file").execute({ path: "src/server.ts" }, ctx)).rejects.toThrow(/budget/);
  });
});

describe("investigator tools", () => {
  it("search_code returns path:line hits and refuses catastrophic patterns", async () => {
    const { analysis, contents } = await scan();
    const ws = new RepoWorkspace(analysis, contents, null);
    const r = await tool(ws, "search_code").execute({ pattern: "createSession" }, ctx);
    expect(r.content).toContain("src/auth/login.ts:1:");
    expect(r.content).toContain("src/auth/session.ts:3:");
    expect(() => compileSearch("(a+)+$", true)).toThrow(/Nested quantifiers/);
    expect(() => compileSearch("", false)).toThrow();
    expect(compileSearch("a.b(", false).test("a.b(")).toBe(true);
  });

  it("find_symbol reports the definition, its references and who imports it", async () => {
    const { analysis, contents } = await scan();
    const ws = new RepoWorkspace(analysis, contents, null);
    const r = await tool(ws, "find_symbol").execute({ name: "createSession" }, ctx);
    expect(r.content).toMatch(/src\/auth\/session\.ts:3 {2}function/);
    expect(r.content).toContain("imported by src/auth/login.ts");
    expect(r.content).toContain("src/auth/login.ts:5:");
  });

  it("get_facts lists the scanned routes with their file and line", async () => {
    const { analysis, contents } = await scan();
    const ws = new RepoWorkspace(analysis, contents, null);
    const r = await tool(ws, "get_facts").execute({ kind: "routes" }, ctx);
    expect(r.content).toContain("POST /api/login · src/server.ts:4");
    const env = await tool(ws, "get_facts").execute({ kind: "env" }, ctx);
    expect(env.content).toContain("JWT_SECRET");
    expect(env.content).not.toContain("supersecretvalue123");
  });

  it("read_file marks only the lines it returned as seen", async () => {
    const big: Record<string, string> = { ...FILES, "src/big.ts": Array.from({ length: 200 }, (_, i) => `// ${"x".repeat(150)} ${i + 1}`).join("\n") };
    const { analysis, contents } = await scan(big);
    const ws = new RepoWorkspace(analysis, contents, null);
    const r = await tool(ws, "read_file").execute({ path: "src/big.ts", start_line: 1, end_line: 200 }, ctx);
    const last = Number(/lines 1–(\d+) of 200/.exec(r.content)![1]);
    expect(last).toBeLessThan(200);
    expect(r.truncated).toBe(false);
    expect(ws.wasSeen("src/big.ts", 1, last)).toBe(true);
    expect(ws.wasSeen("src/big.ts", last + 1, last + 1)).toBe(false);
  });
});

describe("evidence check", () => {
  it("classifies citations as verified, unseen, out of range or missing", async () => {
    const { analysis, contents } = await scan();
    const ws = new RepoWorkspace(analysis, contents, null);
    await tool(ws, "read_file").execute({ path: "src/auth/login.ts", start_line: 1, end_line: 7 }, ctx);
    const answer = "Login is handled in (src/auth/login.ts:2-6). Sessions: src/auth/session.ts:3. Also src/auth/login.ts:99, `src/nope.ts:1` and server.ts:4. Not a file: api.example.com:443, 10:30.";
    const byRef = new Map<string, EvidenceCitation>(checkEvidence(answer, ws).map((c) => [c.ref, c]));
    expect(byRef.get("src/auth/login.ts:2-6")?.status).toBe("verified");
    expect(byRef.get("src/auth/session.ts:3")?.status).toBe("unseen");
    expect(byRef.get("src/auth/login.ts:99")?.status).toBe("out_of_range");
    expect(byRef.get("src/nope.ts:1")?.status).toBe("missing");
    expect(byRef.get("server.ts:4")?.file).toBe("src/server.ts");
    expect([...byRef.keys()].some((k) => k.includes("example.com") || k === "10:30")).toBe(false);
  });

  it("keeps Next.js route-group paths intact", async () => {
    const { analysis, contents } = await scan({ ...FILES, "app/(chat)/api/chat/route.ts": "export async function POST() {}\n" });
    const ws = new RepoWorkspace(analysis, contents, null);
    expect(extractCitations("See app/(chat)/api/chat/route.ts:1.", ws).map((c) => c.candidate)).toEqual(["app/(chat)/api/chat/route.ts"]);
  });
});

describe("investigateRepository", () => {
  it("runs the real agent loop with the offline planner and checks the answer's citations", async () => {
    const { analysis, contents } = await scan();
    const ws = new RepoWorkspace(analysis, contents, null);
    const events: AgentEvent[] = [];
    const question = "How does login create a session?";
    const run = await investigateRepository({ runId: "t1", question, workspace: ws, model: new OfflineInvestigatorModel(analysis, question, { paced: false }), emit: (e) => events.push(e), signal: new AbortController().signal });
    const outcome = await run.done;
    expect(outcome.reason).toBe("completed");
    const tools = events.filter((e) => e.type === "tool_selected").map((e) => (e.type === "tool_selected" ? e.call.name : ""));
    expect(tools).toEqual(expect.arrayContaining(["search_code", "read_file"]));
    const types = events.map((e) => e.type);
    expect(types.indexOf("evidence_checked")).toBeGreaterThan(types.indexOf("final_response"));
    expect(types.indexOf("evidence_checked")).toBeLessThan(types.indexOf("run_completed"));
    const evidence = events.find((e) => e.type === "evidence_checked");
    if (evidence?.type !== "evidence_checked") throw new Error("no evidence event");
    expect(evidence.total).toBeGreaterThan(0);
    // The offline planner cites only what its tools returned, so everything it cites checks out.
    expect(evidence.verified).toBe(evidence.total);
    const init = events.find((e) => e.type === "agent_initialized");
    expect(init?.type === "agent_initialized" && init.mock).toBe(true);
    const final = events.find((e) => e.type === "final_response");
    expect(final?.type === "final_response" && final.source).toBe("simulation");
    expect(JSON.stringify(events)).not.toContain(FAKE_KEY);
  });
});
