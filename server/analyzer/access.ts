import { createHash } from "node:crypto";
import type { RepoAnalysis } from "@shared/repo";
import type { GitHubClient } from "./github";

const TTL_MS = 10 * 60 * 1000;

/**
 * Cached analyses of private repositories hold file contents read with
 * somebody's GitHub token. Before any request reads them, that request's own
 * token must still be able to see the repository; a public analysis needs no
 * check. Answers are cached briefly per token (by hash, never the token itself).
 */
export class PrivateRepoAccess {
  private readonly checked = new Map<string, { ok: boolean; at: number }>();

  async canRead(analysis: RepoAnalysis, github: Pick<GitHubClient, "getRepo">, token: string | undefined): Promise<boolean> {
    if (!analysis.meta.isPrivate) return true;
    if (!token) return false;
    const key = `${analysis.id}:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
    const hit = this.checked.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
    let ok = false;
    try {
      const meta = await github.getRepo(analysis.ref);
      ok = meta.fullName.toLowerCase() === analysis.meta.fullName.toLowerCase();
    } catch {
      ok = false;
    }
    this.checked.set(key, { ok, at: Date.now() });
    if (this.checked.size > 500) this.checked.delete(this.checked.keys().next().value!);
    return ok;
  }
}

export const PRIVATE_DENIED = "This analysis is of a private repository, and the GitHub token on this request cannot read it.";
