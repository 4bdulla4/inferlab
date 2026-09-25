import type { Language } from "@shared/repo";

const EXT: Record<string, Language> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", rb: "ruby", php: "php", cs: "csharp",
  swift: "swift", dart: "dart", sh: "shell", bash: "shell", zsh: "shell", sql: "sql",
  yml: "yaml", yaml: "yaml", json: "json", toml: "toml", md: "markdown", mdx: "markdown",
  html: "html", htm: "html", css: "css", scss: "css", sass: "css", less: "css",
  prisma: "prisma", graphql: "graphql", gql: "graphql",
};

export function languageFor(path: string): Language {
  const base = path.split("/").pop() ?? path;
  if (/^Dockerfile(\..*)?$/i.test(base)) return "dockerfile";
  if (base === "Procfile" || base === "Gemfile" || base === "Rakefile") return "ruby";
  if (base === "go.mod" || base === "go.sum") return "other";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return EXT[ext] ?? "other";
}

export function isCodeLanguage(lang: Language): boolean {
  return ["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "ruby", "php", "csharp", "swift", "dart"].includes(lang);
}

export function isJsLike(lang: Language): boolean {
  return lang === "typescript" || lang === "javascript";
}
