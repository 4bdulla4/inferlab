import { describe, expect, it } from "vitest";
import { GitHubClient, GitHubError, parseGitHubUrl } from "./github";

type Call = { url: string; headers: Record<string, string> };

function fakeFetch(routes: Record<string, { status: number; body?: unknown; text?: string }>, calls: Call[] = []): { fetch: typeof fetch; calls: Call[] } {
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const match = Object.entries(routes).find(([k]) => url.startsWith(k));
    const r = match?.[1] ?? { status: 404 };
    const text = r.text ?? (r.body !== undefined ? JSON.stringify(r.body) : "");
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const repoBody = (priv: boolean) => ({ full_name: "me/secret", description: null, default_branch: "main", stargazers_count: 0, forks_count: 0, language: "TypeScript", license: null, homepage: null, topics: [], html_url: "https://github.com/me/secret", pushed_at: null, private: priv, size: 1 });

describe("GitHubClient access model", () => {
  const ref = parseGitHubUrl("https://github.com/me/secret");

  it("reads a private repository when the token can see it", async () => {
    const { fetch, calls } = fakeFetch({ "https://api.github.com/repos/me/secret": { status: 200, body: repoBody(true) } });
    const client = new GitHubClient("ghp_test_token_0123456789", fetch);
    const meta = await client.getRepo(ref);
    expect(meta.isPrivate).toBe(true);
    expect(meta.fullName).toBe("me/secret");
    expect(calls[0]!.headers.Authorization).toBe("Bearer ghp_test_token_0123456789");
  });

  it("explains how to add a token when an anonymous lookup gets 404", async () => {
    const { fetch } = fakeFetch({});
    const client = new GitHubClient(undefined, fetch);
    const err = await client.getRepo(ref).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(404);
    expect((err as GitHubError).message).toMatch(/private/i);
    expect((err as GitHubError).hint).toMatch(/GitHub token/);
  });

  it("with a token that sees no private repos, a 404 explains the token was made for public repos only", async () => {
    const { fetch } = fakeFetch({
      "https://api.github.com/user/repos": { status: 200, body: [] },
      "https://api.github.com/user": { status: 200, body: { login: "me" } },
    });
    const client = new GitHubClient("ghp_test_token_0123456789", fetch);
    const err = (await client.getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.message).toMatch(/cannot access/i);
    expect(err.hint).toMatch(/belongs to me/);
    expect(err.hint).toMatch(/public repositories only/i);
    expect(err.hint).toMatch(/Only select repositories/);
  });

  it("with a token that sees other private repos, a 404 points at this repository's access list", async () => {
    const { fetch } = fakeFetch({
      "https://api.github.com/user/repos": { status: 200, body: [{ full_name: "me/other" }] },
      "https://api.github.com/user": { status: 200, body: { login: "me" } },
    });
    const client = new GitHubClient("ghp_test_token_0123456789", fetch);
    const err = (await client.getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.hint).toMatch(/but not this one/i);
  });

  it("sends the token to raw.githubusercontent.com and falls back to the contents API", async () => {
    const { fetch, calls } = fakeFetch({
      "https://raw.githubusercontent.com/me/secret/abc/src/app.ts": { status: 404 },
      "https://api.github.com/repos/me/secret/contents/src%2Fapp.ts": { status: 200, text: "export const x = 1;" },
      "https://api.github.com/repos/me/secret/contents/src/app.ts": { status: 200, text: "export const x = 1;" },
    });
    const client = new GitHubClient("ghp_test_token_0123456789", fetch);
    const text = await client.getRawFile(ref, "abc", "src/app.ts", 100_000);
    expect(text).toBe("export const x = 1;");
    expect(calls[0]!.url).toContain("raw.githubusercontent.com");
    expect(calls[0]!.headers.Authorization).toBe("token ghp_test_token_0123456789");
    expect(calls[1]!.url).toContain("/contents/");
    expect(calls[1]!.headers.Accept).toContain("raw");
  });

  it("does not fall back or send credentials when there is no token", async () => {
    const { fetch, calls } = fakeFetch({ "https://raw.githubusercontent.com/": { status: 404 } });
    const client = new GitHubClient(undefined, fetch);
    expect(await client.getRawFile(ref, "abc", "README.md", 100_000)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });
});
