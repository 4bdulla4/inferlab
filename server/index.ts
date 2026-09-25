import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type ServerConfig } from "./lib/config";
import { HistoryStore } from "./lib/history";
import { ProviderRegistry } from "./providers/registry";
import { createLLMRouter } from "./routes/llm";
import { createRepoRouter } from "./routes/repo";
import { createHistoryRouter } from "./routes/history";
import { createRagRouter } from "./routes/rag";
import { createAgentRouter } from "./routes/agent";
import { createMLRouter } from "./routes/ml";
import { KnowledgeBaseStore } from "./rag/KnowledgeBase";
import { createSettingsRouter } from "./routes/settings";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(here, "..", ".env");

// `.env` wins over variables already present in the shell so a stale exported key cannot shadow the one you configure here.
dotenv.config({ path: ENV_PATH, override: true, quiet: true });

// One store: the agent lab's retrieval tool reads the knowledge bases the RAG lab builds.
const knowledgeBases = new KnowledgeBaseStore();
const history = new HistoryStore(path.resolve(here, "..", ".data", "history.json"));
let config: ServerConfig = loadConfig();
let registry = new ProviderRegistry(config);

function summary(): string {
  return registry
    .describeAll()
    .map((p) => `${p.name} (${p.model}) ${p.configured ? "configured" : "NOT configured"}`)
    .join(" · ");
}

/** Re-read `.env` and rebuild providers when the file changes, so pasting a key needs no restart. */
function reloadEnv(): void {
  dotenv.config({ path: ENV_PATH, override: true, quiet: true });
  config = loadConfig();
  registry = new ProviderRegistry(config);
  console.log(`[api] .env reloaded — ${summary()}`);
}
fs.watchFile(ENV_PATH, { interval: 1000, persistent: false }, (curr, prev) => {
  if (curr.mtimeMs !== prev.mtimeMs) reloadEnv();
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    providers: registry.describeAll().map((p) => ({ id: p.id, model: p.model, configured: p.configured })),
  });
});

app.use("/api/llm", createLLMRouter(() => registry, history));
app.use("/api/repo", createRepoRouter(() => config, history));
app.use("/api/history", createHistoryRouter(history));
app.use("/api/rag", createRagRouter({ getConfig: () => config, getRegistry: () => registry, history, store: knowledgeBases }));
app.use("/api/agent", createAgentRouter({ getConfig: () => config, getRegistry: () => registry, knowledgeBases, history }));
app.use("/api/ml", createMLRouter({ history }));
app.use("/api/settings", createSettingsRouter({ envPath: ENV_PATH, reload: reloadEnv, getRegistry: () => registry }));

if (config.isProduction) {
  const dist = path.resolve(here, "..", "dist");
  app.use(express.static(dist));
  app.get("*path", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} — ${summary()}`);
});
