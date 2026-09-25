import type { RepoAnalysis } from "@shared/repo";

/** Small in-memory LRU with TTL. Analyses are large; keep only a handful. */
export class AnalysisCache {
  private readonly map = new Map<string, { value: RepoAnalysis; expires: number }>();

  constructor(private readonly max = 12, private readonly ttlMs = 2 * 60 * 60 * 1000) {}

  get(id: string): RepoAnalysis | undefined {
    const entry = this.map.get(id);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.map.delete(id);
      return undefined;
    }
    this.map.delete(id);
    this.map.set(id, entry);
    return entry.value;
  }

  set(value: RepoAnalysis): void {
    this.map.set(value.id, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  findByRef(owner: string, repo: string, sha: string): RepoAnalysis | undefined {
    for (const { value } of this.map.values()) if (value.ref.owner === owner && value.ref.repo === repo && value.meta.sha === sha) return this.get(value.id);
    return undefined;
  }
}
