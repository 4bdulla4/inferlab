/**
 * CLI smoke test for the GitHub analyzer.
 *   npm run analyze -- https://github.com/owner/repo [--ai] [--json out.json] [--ask "question"]
 *   --ai runs the (paid) model summarization pass; off by default.
 * Uses GITHUB_TOKEN / ANTHROPIC_API_KEY from the environment when present.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { AiAnalyzer } from "../server/analyzer/ai";
import { analyzeRepository } from "../server/analyzer/analyzer";
import { GitHubClient } from "../server/analyzer/github";
import { heuristicTrace } from "../server/analyzer/tracer";
import { loadConfig } from "../server/lib/config";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "https://github.com/vercel/ai-chatbot";
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const questions = args.flatMap((a, i) => (a === "--ask" && args[i + 1] ? [args[i + 1]!] : []));
const config = loadConfig();
const github = new GitHubClient(config.github.token);
const ai = new AiAnalyzer({ apiKey: args.includes("--no-ai") ? undefined : config.anthropic.apiKey, model: config.anthropic.model, workspaceId: config.anthropic.workspaceId });

const t0 = Date.now();
const analysis = await analyzeRepository(url, {
  github,
  ai,
  emit: (e) => {
    if (e.type === "phase") console.log(`[${(e.progress * 100).toFixed(0).padStart(3)}%] ${e.phase}: ${e.detail}`);
  },
  signal: new AbortController().signal,
  skipAi: !args.includes("--ai"),
});

console.log(`\n== ${analysis.meta.fullName} @ ${analysis.meta.sha.slice(0, 7)} in ${Date.now() - t0} ms ==`);
console.log("headline:", analysis.overview.headline);
console.log("stats:", JSON.stringify(analysis.stats));
console.log("warnings:", analysis.warnings.join(" | ") || "none");
console.log("integrations:", analysis.integrations.map((i) => `${i.name}[${i.category}](${i.files.length}f)`).join(", "));
console.log(`routes (${analysis.routes.length}):\n  ${analysis.routes.slice(0, 30).map((r) => `${r.method} ${r.path} <${r.file}:${r.line}> ${r.handler ?? ""} [${r.kind}]`).join("\n  ")}`);
console.log(`env (${analysis.envVars.length}):`, analysis.envVars.slice(0, 24).map((v) => `${v.name}(${v.usages.length}u/${v.declaredIn.length}d)`).join(", "));
console.log(`schema (${analysis.schema.length}):`, analysis.schema.map((s) => `${s.name}[${s.kind}]`).join(", "));
console.log(`jobs (${analysis.jobs.length}):`, analysis.jobs.map((j) => `${j.kind}:${j.name}${j.schedule ? `@${j.schedule}` : ""}`).join(", "));
console.log(`infra (${analysis.infra.length}):`, analysis.infra.map((c) => `${c.kind}:${c.file}`).join(", "));
console.log(`\nNODES (${analysis.graph.nodes.length}):`);
for (const n of analysis.graph.nodes) console.log(`  [L${n.layer}] ${n.id} · ${n.label} · files=${n.files.length} routes=${n.routes.length} syms=${n.symbols.length} env=${n.envVars.length} :: ${n.summary}${n.aiSummary ? `\n        AI: ${n.aiSummary}` : ""}`);
console.log(`\nEDGES (${analysis.graph.edges.length}):`);
for (const e of analysis.graph.edges) console.log(`  ${e.from} → ${e.to} [${e.kind}] w=${e.weight} ${e.evidence.kind}${e.evidence.file ? ` ${e.evidence.file}:${e.evidence.line ?? ""}` : ""}`);
const roleCounts: Record<string, number> = {};
for (const f of analysis.files) for (const r of f.roles) roleCounts[r] = (roleCounts[r] ?? 0) + 1;
console.log("\nroles:", JSON.stringify(roleCounts));
const resolved = analysis.files.reduce((a, f) => a + f.imports.filter((i) => i.resolved).length, 0);
const internal = analysis.files.reduce((a, f) => a + f.imports.filter((i) => !i.external).length, 0);
console.log(`imports: resolved ${resolved} / internal ${internal}`);
if (analysis.overview.aiOverview) console.log("\nAI overview:", analysis.overview.aiOverview);
for (const q of questions.length ? questions : ["How does authentication work?", "How does the AI response get generated?"]) {
  const t = heuristicTrace(analysis, q, "t");
  console.log(`\nQ: ${q} → ${t.confidence}\n  ${t.answer}`);
  for (const s of t.steps) console.log(`  ${s.index}. [${s.kind}] ${s.title} — ${s.file ?? ""}${s.line ? `:${s.line}` : ""} ${s.symbol ? `(${s.symbol})` : ""} node=${s.nodeId ?? "-"}`);
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(analysis, null, 1));
  console.log(`\nwrote ${jsonOut}`);
}
console.log("\njson bytes:", JSON.stringify(analysis).length);
