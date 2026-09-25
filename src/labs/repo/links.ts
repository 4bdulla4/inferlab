import type { RepoAnalysis } from "@shared/repo";

export function githubFileUrl(analysis: RepoAnalysis, file: string, line?: number): string {
  const base = `${analysis.meta.htmlUrl}/blob/${analysis.meta.sha}/${file.split("/").map(encodeURIComponent).join("/")}`;
  return line ? `${base}#L${line}` : base;
}

export function shortPath(path: string, max = 42): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  const file = parts.pop()!;
  let prefix = parts.join("/");
  while (prefix.length + file.length + 2 > max && parts.length > 1) {
    parts.shift();
    prefix = `…/${parts.join("/")}`;
  }
  return `${prefix}/${file}`;
}
