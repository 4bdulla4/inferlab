import type { Request } from "express";

/**
 * Session keys travel from the browser tab to this backend as request headers.
 * They are used for that request only: never persisted, never logged, never
 * echoed back. Values that do not look like credentials are ignored.
 */
export interface SessionKeys {
  anthropic?: string;
  openai?: string;
  github?: string;
  anthropicWorkspace?: string;
  google?: string;
}

const HEADERS: Record<keyof SessionKeys, string> = {
  anthropic: "x-anthropic-api-key",
  openai: "x-openai-api-key",
  github: "x-github-token",
  anthropicWorkspace: "x-anthropic-workspace-id",
  google: "x-google-api-key",
};

export function readSessionKeys(req: Request): SessionKeys {
  const out: SessionKeys = {};
  for (const [name, header] of Object.entries(HEADERS) as [keyof SessionKeys, string][]) {
    const raw = req.get(header);
    const value = name === "anthropicWorkspace" ? sanitizeWorkspaceId(raw) : sanitizeKey(raw);
    if (value) out[name] = value;
  }
  return out;
}

export function sanitizeWorkspaceId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  return /^[\w-]{6,128}$/.test(v) ? v : undefined;
}

export function sanitizeKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (v.length < 16 || v.length > 512) return undefined;
  if (/\s/.test(v)) return undefined;
  return v;
}
