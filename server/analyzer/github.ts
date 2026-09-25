import type { RepoMeta, RepoRef } from "@shared/repo";

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
  sha: string;
}

export class GitHubError extends Error {
  constructor(message: string, public readonly status: number, public readonly hint?: string) {
    super(message);
    this.name = "GitHubError";
  }
}

export const TOKEN_HINT = "To analyze a private repository, add a GitHub token that has access to it in Settings → API keys (or GITHUB_TOKEN on the server). A fine-grained token with read-only Contents permission is enough.";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * Accepts https://github.com/owner/repo[.git][/tree/<ref>[/path]] or "owner/repo".
 * Rejects anything that is not a github.com repository.
 */
export function parseGitHubUrl(input: string): RepoRef {
  const trimmed = input.trim();
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (shorthand) {
    const [, owner, repo] = shorthand;
    return { owner: owner!, repo: repo!.replace(/\.git$/, ""), ref: "", url: `https://github.com/${owner}/${repo}` };
  }
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new GitHubError("That does not look like a GitHub repository URL.", 400);
  }
  if (!GITHUB_HOSTS.has(url.hostname)) throw new GitHubError("Only public github.com repositories are supported.", 400);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new GitHubError("URL must include an owner and a repository name.", 400);
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  let ref = "";
  if (parts[2] === "tree" || parts[2] === "blob" || parts[2] === "commit" || parts[2] === "commits") {
    ref = parts.slice(3).join("/") || parts[3] || "";
    // /tree/branch/sub/dir → keep only the branch portion when it contains no slashes
    if (parts[2] !== "commit" && ref.includes("/")) ref = parts[3] ?? "";
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new GitHubError("Invalid owner or repository name.", 400);
  return { owner, repo, ref, url: `https://github.com/${owner}/${repo}` };
}

interface GitHubRepoResponse {
  full_name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { spdx_id?: string; name?: string } | null;
  homepage: string | null;
  topics?: string[];
  html_url: string;
  pushed_at: string | null;
  private: boolean;
  size: number;
}

/**
 * Thin GitHub REST client. Two API calls per analysis (repo + tree); file
 * bodies are fetched from raw.githubusercontent.com, which is not subject to
 * the core API quota.
 */
export class GitHubClient {
  constructor(private readonly token?: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "inferlab-analyzer",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async api<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(`https://api.github.com${path}`, { headers: this.headers(), signal });
    if (!res.ok) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (res.status === 403 && remaining === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
        const mins = reset ? Math.max(1, Math.round((reset - Date.now()) / 60000)) : null;
        throw new GitHubError(`GitHub API rate limit exceeded${mins ? ` (resets in ~${mins} min)` : ""}.`, 429, "Add a GitHub token in Settings → API keys (or GITHUB_TOKEN on the server) to raise the limit from 60 to 5,000 requests per hour.");
      }
      if (res.status === 404) {
        if (!this.token) throw new GitHubError("Repository not found or private.", 404, TOKEN_HINT);
        throw new GitHubError("Repository not found, or the provided GitHub token cannot access it.", 404, await this.describeTokenAccess(signal));
      }
      if (res.status === 401) throw new GitHubError("GitHub rejected the token.", 401, "The GitHub token is invalid or expired. Replace it in Settings → API keys.");
      if (res.status === 403) {
        const body = await res.text().catch(() => "");
        const sso = /SAML|SSO|single sign-on/i.test(body);
        throw new GitHubError(sso ? "This organization requires SSO authorization for the token." : "GitHub refused access (403).", 403, sso ? "Authorize the token for the organization in GitHub → Settings → Developer settings → Personal access tokens → Configure SSO." : "The token may lack the Contents permission for this repository.");
      }
      throw new GitHubError(`GitHub API error (${res.status}).`, res.status);
    }
    return (await res.json()) as T;
  }

  async getRepo(ref: RepoRef, signal?: AbortSignal): Promise<RepoMeta & { requestedRef: string }> {
    const r = await this.api<GitHubRepoResponse>(`/repos/${ref.owner}/${ref.repo}`, signal);
    // A private repository is readable exactly when the caller's token can see it, which is
    // the case if the API returned it at all. Without a token GitHub answers 404, handled above.
    const branch = ref.ref || r.default_branch;
    return {
      fullName: r.full_name,
      description: r.description,
      defaultBranch: r.default_branch,
      sha: branch, // replaced with the resolved commit sha by getTree()
      stars: r.stargazers_count,
      forks: r.forks_count,
      primaryLanguage: r.language,
      license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : (r.license?.name ?? null),
      homepage: r.homepage,
      topics: r.topics ?? [],
      htmlUrl: r.html_url,
      pushedAt: r.pushed_at,
      isPrivate: r.private,
      requestedRef: branch,
    };
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  /**
   * When a token gets 404, find out why with two cheap calls: who the token
   * belongs to and whether it can see any private repository at all. A
   * fine-grained token created for "public repositories only" is the usual cause.
   */
  private async describeTokenAccess(signal?: AbortSignal): Promise<string> {
    try {
      const [userRes, privRes] = await Promise.all([
        this.fetchImpl("https://api.github.com/user", { headers: this.headers(), signal }),
        this.fetchImpl("https://api.github.com/user/repos?visibility=private&per_page=1", { headers: this.headers(), signal }),
      ]);
      const login = userRes.ok ? ((await userRes.json()) as { login?: string }).login : undefined;
      const privateVisible = privRes.ok ? ((await privRes.json()) as unknown[]).length : -1;
      const who = login ? `The token belongs to ${login}.` : "The token could not be identified.";
      if (privateVisible === 0) {
        return `${who} It cannot see any private repository, so it was created for public repositories only. Edit the token on GitHub (Settings → Developer settings → Fine-grained tokens): set Repository access to "Only select repositories", add this repository, and grant Contents: Read-only. Then paste the token again.`;
      }
      if (privateVisible > 0) {
        return `${who} It can see private repositories, but not this one. Add this repository to the token's Repository access on GitHub, check the owner/name (an organization repository needs the token to include that organization), or use a token from an account that has access.`;
      }
      return `${who} Check the owner/name, and make sure the token was created by an account with access to this repository (fine-grained tokens must explicitly include it).`;
    } catch {
      return "Check the owner/name, and make sure the token was created by an account with access to this repository (fine-grained tokens must explicitly include it).";
    }
  }

  async getTree(ref: RepoRef, treeRef: string, signal?: AbortSignal): Promise<{ sha: string; entries: TreeEntry[]; truncated: boolean }> {
    const r = await this.api<{ sha: string; truncated: boolean; tree: TreeEntry[] }>(
      `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
      signal,
    );
    return { sha: r.sha, entries: r.tree, truncated: r.truncated };
  }

  /**
   * Fetches one file body. Public repos read from raw.githubusercontent.com anonymously;
   * private repos send the token there too, and fall back to the REST contents endpoint
   * (raw media type) if the CDN refuses, so private code is read with the same token.
   */
  async getRawFile(ref: RepoRef, sha: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<string | null> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const rawHeaders: Record<string, string> = { "User-Agent": "inferlab-analyzer" };
    if (this.token) rawHeaders.Authorization = `token ${this.token}`;
    let res = await this.fetchImpl(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${encodedPath}`, { headers: rawHeaders, signal });
    if (!res.ok && this.token && (res.status === 404 || res.status === 401 || res.status === 403)) {
      res = await this.fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`, {
        headers: { ...this.headers(), Accept: "application/vnd.github.raw+json" },
        signal,
      });
    }
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    // Binary sniff: NUL bytes in the first KB.
    for (let i = 0; i < Math.min(1024, buf.length); i++) if (buf[i] === 0) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}
