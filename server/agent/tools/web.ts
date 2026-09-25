import { extractFromUrl, isPrivateHost } from "../../rag/extract";
import { ToolExecutionError } from "../types";

const SEARCH_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 10_000;
const MAX_API_BYTES = 512 * 1024;

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
  wordCount: number;
}

/**
 * Searches Wikipedia through its public search API. It is a real search over a
 * real corpus, chosen because it needs no key and returns structured JSON; the
 * result note says so, so nobody mistakes it for a general web engine.
 */
export async function searchWikipedia(query: string, limit: number, signal: AbortSignal): Promise<{ hits: SearchHit[]; totalHits: number; ms: number }> {
  const q = query.trim();
  if (!q) throw new ToolExecutionError("A search query is required.", "live", false);
  const params = new URLSearchParams({ action: "query", list: "search", srsearch: q.slice(0, 300), format: "json", srlimit: String(Math.min(8, Math.max(1, limit))), utf8: "1", srprop: "snippet|wordcount" });
  const url = `https://en.wikipedia.org/w/api.php?${params}`;
  const started = Date.now();
  const res = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS, signal, { accept: "application/json" });
  if (!res.ok) throw new ToolExecutionError(`The search API responded with HTTP ${res.status}.`);
  const body = (await res.json()) as { query?: { searchinfo?: { totalhits?: number }; search?: { title: string; snippet: string; wordcount?: number }[] } };
  const hits = (body.query?.search ?? []).map((h) => ({
    title: h.title,
    snippet: stripTags(h.snippet),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    wordCount: h.wordcount ?? 0,
  }));
  return { hits, totalHits: body.query?.searchinfo?.totalhits ?? hits.length, ms: Date.now() - started };
}

/** Fetches a public page and returns its readable text, capped. Reuses the RAG lab's extractor and its SSRF guard. */
export async function fetchPageText(url: string, maxChars: number): Promise<{ text: string; finalUrl: string; bytes: number; chars: number; extraction: string; truncated: boolean }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ToolExecutionError(`"${url}" is not a valid URL.`, "live", false);
  }
  try {
    const out = await extractFromUrl(parsed.toString());
    const cap = Math.min(20_000, Math.max(200, maxChars));
    return { text: out.text.slice(0, cap), finalUrl: out.finalUrl, bytes: out.bytes, chars: out.text.length, extraction: out.extraction, truncated: out.text.length > cap };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolExecutionError(message, "live", !/local network|Only http/.test(message));
  }
}

/** GET a public JSON API and return the parsed body, capped. */
export async function fetchJsonApi(url: string, signal: AbortSignal): Promise<{ status: number; contentType: string; body: unknown; bytes: number; ms: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ToolExecutionError(`"${url}" is not a valid URL.`, "live", false);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ToolExecutionError("Only http and https URLs can be called.", "live", false);
  if (isPrivateHost(parsed.hostname)) throw new ToolExecutionError("Addresses on the local network cannot be called.", "live", false);
  const started = Date.now();
  const res = await fetchWithTimeout(parsed.toString(), API_TIMEOUT_MS, signal, { accept: "application/json, text/plain;q=0.8, */*;q=0.5" });
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length > MAX_API_BYTES) throw new ToolExecutionError("The response is larger than 512 KB.", "live", false);
  const contentType = res.headers.get("content-type") ?? "";
  const text = raw.toString("utf8");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON; keep the text */
  }
  if (!res.ok) throw new ToolExecutionError(`The API responded with HTTP ${res.status}${typeof body === "string" ? `: ${body.slice(0, 200)}` : ""}.`, "live", res.status >= 500 || res.status === 429);
  return { status: res.status, contentType, body, bytes: raw.length, ms: Date.now() - started };
}

async function fetchWithTimeout(url: string, timeoutMs: number, signal: AbortSignal, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "inferLab/1.0 (+Agents lab)", ...headers } });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ToolExecutionError(ctrl.signal.aborted ? `No response within ${timeoutMs / 1000} s.` : `Network error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
