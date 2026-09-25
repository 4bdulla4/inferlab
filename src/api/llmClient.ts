import type { ChatRequestBody, ProviderDescriptor, SaveKeysRequestBody, SaveKeysResult, ServerEvent } from "@shared/llm";
import { sessionHeaders } from "@/store/uiStore";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchProviders(): Promise<ProviderDescriptor[]> {
  const res = await fetch("/api/llm/providers");
  if (!res.ok) throw new ApiError(`Failed to load providers (${res.status})`, res.status);
  const json = (await res.json()) as { providers: ProviderDescriptor[] };
  return json.providers;
}

/**
 * Parses a Server-Sent Events byte stream into JSON payloads.
 * Exported for tests.
 */
export function createSSEParser(onEvent: (name: string, data: string) => void): (chunk: string, flush?: boolean) => void {
  let buffer = "";
  return (chunk: string, flush = false) => {
    // Normalize CRLF so frame boundaries are always "\n\n".
    buffer = (buffer + chunk).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      dispatch(block);
    }
    if (flush && buffer.trim()) {
      dispatch(buffer);
      buffer = "";
    }
  };

  function dispatch(block: string) {
    let name = "message";
    const dataLines: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) onEvent(name, dataLines.join("\n"));
  }
}

/**
 * Opens the streaming chat endpoint and invokes `onEvent` for every live
 * provider event. Resolves when the server signals `end`.
 */
export async function streamChat(
  body: ChatRequestBody,
  onEvent: (event: ServerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...sessionHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  if (!res.body) throw new ApiError("Streaming is not supported by this browser.", 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let ended = false;
  const parse = createSSEParser((name, data) => {
    if (name === "end") {
      ended = true;
      return;
    }
    try {
      onEvent(JSON.parse(data) as ServerEvent);
    } catch {
      /* ignore malformed frame */
    }
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parse(decoder.decode(value, { stream: true }));
    if (ended) break;
  }
  parse(decoder.decode(), true);
}

/** Saves keys into the server's .env file. The server only accepts this from the local machine. */
export async function saveKeysToServer(body: SaveKeysRequestBody): Promise<SaveKeysResult> {
  const res = await fetch("/api/settings/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `Save failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as SaveKeysResult;
}
