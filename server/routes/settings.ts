import { Router, type Request, type Response } from "express";
import type { SaveKeysRequestBody, SaveKeysResult } from "@shared/llm";
import { updateEnvFile } from "../lib/envFile";
import { sanitizeKey, sanitizeWorkspaceId } from "../lib/sessionKeys";
import type { ProviderRegistry } from "../providers/registry";

const ENV_NAMES: Record<keyof SaveKeysRequestBody, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  github: "GITHUB_TOKEN",
  anthropicWorkspace: "ANTHROPIC_WORKSPACE_ID",
};

function isLoopback(req: Request): boolean {
  const ip = req.socket.remoteAddress ?? "";
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

/**
 * Persists keys into the server's `.env` file (gitignored). Only requests from
 * this machine are accepted; values are never logged or echoed back.
 */
export function createSettingsRouter(opts: { envPath: string; reload: () => void; getRegistry: () => ProviderRegistry }): Router {
  const router = Router();
  router.post("/keys", (req: Request, res: Response) => {
    if (!isLoopback(req)) {
      res.status(403).json({ error: "Saving keys is only allowed from the machine running the server." });
      return;
    }
    const body = (req.body ?? {}) as Partial<Record<keyof SaveKeysRequestBody, string>>;
    const updates: Record<string, string> = {};
    const saved: string[] = [];
    const cleared: string[] = [];
    for (const [field, envName] of Object.entries(ENV_NAMES) as [keyof SaveKeysRequestBody, string][]) {
      if (!(field in body)) continue;
      const raw = body[field];
      if (typeof raw !== "string") continue;
      if (raw.trim() === "") {
        updates[envName] = "";
        cleared.push(envName);
        continue;
      }
      const value = field === "anthropicWorkspace" ? sanitizeWorkspaceId(raw) : sanitizeKey(raw);
      if (!value) {
        res.status(400).json({ error: `The value for ${envName} does not look like a valid key.` });
        return;
      }
      updates[envName] = value;
      saved.push(envName);
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to save." });
      return;
    }
    try {
      updateEnvFile(opts.envPath, updates);
      opts.reload();
    } catch (err) {
      res.status(500).json({ error: `Could not write .env: ${err instanceof Error ? err.message : "unknown error"}` });
      return;
    }
    console.log(`[api] settings saved to .env: ${[...saved, ...cleared.map((c) => `${c} (cleared)`)].join(", ")}`);
    const result: SaveKeysResult = { saved, cleared, providers: opts.getRegistry().describeAll() };
    res.json(result);
  });
  return router;
}
