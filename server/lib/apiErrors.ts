/**
 * Turns SDK errors (which stringify to "400 {json…}") into a readable message,
 * a status code and, for well-known situations, a hint the user can act on.
 * Never includes credentials.
 */
export interface FriendlyError {
  status?: number;
  message: string;
  hint?: string;
  retryable: boolean;
}

export function friendlyApiError(err: unknown, provider: string): FriendlyError {
  const e = err as { status?: number; message?: string; error?: unknown; name?: string };
  const status = typeof e?.status === "number" ? e.status : undefined;
  let message = typeof e?.message === "string" ? e.message : `Unexpected error from ${provider}.`;
  const bodyMessage = extractBodyMessage(e?.error) ?? extractBodyMessage(parseJsonTail(message));
  if (bodyMessage) message = bodyMessage;
  message = message.replace(/^\d{3}\s+/, "").trim();
  let hint: string | undefined;
  if (/anthropic-workspace-id/i.test(message)) hint = "This Anthropic key is organization-level and not scoped to a workspace. Add the workspace id in Settings → API keys (or ANTHROPIC_WORKSPACE_ID on the server), or create a workspace-scoped key in the Anthropic Console.";
  else if (status === 401) hint = `The ${provider} key was rejected. Check it in Settings → API keys or in the server .env, then retry.`;
  else if (status === 429) hint = "Rate limit or quota reached. Wait a moment or check the provider's usage dashboard.";
  else if (status === 402 || /insufficient|billing|quota/i.test(message)) hint = "The provider reports a billing or quota problem for this key.";
  else if (status === 404 && /model/i.test(message)) hint = "The configured model id was not found. Change it in the server .env.";
  const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
  return { status, message: message.slice(0, 600), hint, retryable };
}

export function describeApiError(err: unknown, provider: string): string {
  const f = friendlyApiError(err, provider);
  return `${f.status ? `${f.status}: ` : ""}${f.message}`;
}

function extractBodyMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { error?: { message?: unknown } | string; message?: unknown };
  if (typeof b.error === "object" && b.error && typeof b.error.message === "string") return b.error.message;
  if (typeof b.error === "string") return b.error;
  if (typeof b.message === "string") return b.message;
  return undefined;
}

function parseJsonTail(text: string): unknown {
  const i = text.indexOf("{");
  if (i === -1) return undefined;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return undefined;
  }
}
