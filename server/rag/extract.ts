import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { DocumentKind } from "@shared/rag";
import type { PageSpan } from "./chunker";

export interface Extracted {
  text: string;
  kind: DocumentKind;
  pages?: number;
  pageSpans?: PageSpan[];
  /** Plain statement of how the text was obtained. */
  extraction: string;
  warnings: string[];
}

const MAX_TEXT_CHARS = 1_500_000;

/** Guesses the document kind from a MIME type and file name. */
export function detectKind(mime: string | undefined, name: string): DocumentKind {
  const m = (mime ?? "").toLowerCase();
  const n = name.toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (m.includes("html") || n.endsWith(".html") || n.endsWith(".htm")) return "html";
  if (m.includes("markdown") || n.endsWith(".md") || n.endsWith(".markdown")) return "markdown";
  return "text";
}

/** Pulls plain text out of uploaded bytes. Real extraction; the note says which library did it. */
export async function extractFromBytes(bytes: Buffer, kind: DocumentKind, name: string): Promise<Extracted> {
  switch (kind) {
    case "pdf":
      return extractPdf(bytes);
    case "docx":
      return extractDocx(bytes);
    case "html":
      return { ...extractHtml(bytes.toString("utf8")), kind: "html" };
    case "markdown":
      return finish(bytes.toString("utf8"), "markdown", `Read ${name} as UTF-8 Markdown; formatting kept as-is.`);
    default:
      return finish(bytes.toString("utf8"), "text", `Read ${name} as UTF-8 plain text.`);
  }
}

async function extractPdf(bytes: Buffer): Promise<Extracted> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    const warnings: string[] = [];
    const spans: PageSpan[] = [];
    let text = "";
    let empty = 0;
    for (const page of result.pages) {
      spans.push({ page: page.num, start: text.length });
      const body = page.text.replace(/[ \t]+\n/g, "\n").trim();
      if (!body) empty += 1;
      text += body + "\n\n";
    }
    if (empty > 0) warnings.push(`${empty} of ${result.total} pages had no text layer (likely scanned images). Their content is not searchable.`);
    return {
      ...finish(text, "pdf", `Text layer read with pdf-parse (pdf.js), ${result.total} page${result.total === 1 ? "" : "s"}.`),
      pages: result.total,
      pageSpans: spans,
      warnings,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(bytes: Buffer): Promise<Extracted> {
  const result = await mammoth.extractRawText({ buffer: bytes });
  const warnings = result.messages.filter((m) => m.type === "warning").map((m) => m.message).slice(0, 5);
  return { ...finish(result.value, "docx", "Paragraph text read with mammoth; images, headers and footers are not included."), warnings };
}

/** Strips markup down to readable text. Scripts, styles and navigation are dropped. */
export function extractHtml(html: string): Extracted {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  body = decodeEntities(body).replace(/[ \t ]+/g, " ").replace(/\n[ \t]*\n[\s\n]*/g, "\n\n").trim();
  const text = title ? `${title}\n\n${body}` : body;
  return finish(text, "html", "Markup stripped to readable text; scripts, styles and navigation removed.");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

const URL_TIMEOUT_MS = 15_000;
const MAX_URL_BYTES = 8 * 1024 * 1024;

/** Fetches a public page and extracts its text. Only http(s) to public hosts is allowed. */
export async function extractFromUrl(url: string): Promise<Extracted & { finalUrl: string; bytes: number }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http and https URLs can be added.");
  if (isPrivateHost(parsed.hostname)) throw new Error("Addresses on the local network cannot be fetched.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), URL_TIMEOUT_MS);
  try {
    const res = await fetch(parsed, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "inferLab/1.0 (+RAG lab)", accept: "text/html,application/pdf,text/plain,*/*" },
    });
    if (!res.ok) throw new Error(`The page responded with HTTP ${res.status}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_URL_BYTES) throw new Error("The page is larger than 8 MB.");
    const type = res.headers.get("content-type") ?? "";
    const kind = detectKind(type, parsed.pathname);
    const extracted =
      kind === "pdf"
        ? await extractPdf(buf)
        : kind === "html" || type.includes("html")
          ? extractHtml(buf.toString("utf8"))
          : finish(buf.toString("utf8"), "text", `Fetched as ${type || "unknown type"} and read as text.`);
    return {
      ...extracted,
      kind: kind === "pdf" ? "pdf" : "url",
      finalUrl: res.url || url,
      bytes: buf.length,
      extraction: `Fetched ${res.url || url} (${type || "unknown type"}). ${extracted.extraction}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function finish(text: string, kind: DocumentKind, extraction: string): Extracted {
  // Strip NUL bytes and normalize line endings before anything downstream sees the text.
  const cleaned = text.replace(/\r\n?/g, "\n").replace(new RegExp(String.fromCharCode(0), "g"), "").trim();
  const warnings: string[] = [];
  if (cleaned.length > MAX_TEXT_CHARS) warnings.push(`Text was cut at ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
  return { text: cleaned.slice(0, MAX_TEXT_CHARS), kind, extraction, warnings };
}
