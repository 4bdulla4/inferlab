import type { AgentBlueprint, BlueprintGap, BlueprintTool } from "@shared/agent";
import { AGENT_LIMITS, DEFAULT_AGENT_CONFIG } from "../../shared/agent";
import { BUILTIN_TOOL_IDS } from "./tools";
import type { AgentModel } from "./types";

/**
 * Turns a description written in ordinary words into an agent configuration.
 *
 * Two layers. The rule analyzer is code: it tokenizes the text, matches each
 * token against capability vocabularies with typo tolerance, and maps the
 * capabilities it finds onto the tools this lab really has. It always runs and
 * needs no key. When a model is available it may refine the result, but only by
 * choosing from the same tool catalogue; everything it returns is validated by
 * code before it is used, and the rule result stays as the floor.
 */

/* ────────────────────────────── vocabulary ─────────────────────────── */

interface Capability {
  id: string;
  tool: string | null;
  /** Words and short phrases that mean this capability. */
  words: string[];
  /** Phrases that outrank single words. */
  phrases?: string[];
  reason: string;
  /** Strong phrases mark a side effect worth an approval gate. */
  sideEffect?: boolean;
}

const CAPABILITIES: Capability[] = [
  {
    id: "search",
    tool: "web_search",
    words: ["search", "google", "wikipedia", "research", "lookup", "find", "discover", "investigate", "information", "facts", "who", "what", "where", "when", "history", "population", "capital", "definition", "meaning", "explain", "learn", "internet", "web", "online", "news", "latest", "current", "recent", "compare", "background", "biography", "topic"],
    phrases: ["look up", "find out", "search for", "search the web", "on the internet", "look for", "what is", "who is", "tell me about", "how many", "find information"],
    reason: "The description asks for facts that have to be looked up.",
  },
  {
    id: "read",
    tool: "web_fetch",
    words: ["read", "article", "page", "website", "webpage", "site", "url", "link", "blog", "documentation", "docs", "summarize", "summarise", "summary", "extract", "scrape", "content", "pdf"],
    phrases: ["read the page", "open the link", "from this url", "from the website", "summarize the page", "read the article", "go to"],
    reason: "It needs to read a page or document in full, not just search results.",
  },
  {
    id: "api",
    tool: "http_api",
    words: ["api", "json", "endpoint", "rest", "weather", "forecast", "temperature", "exchange", "currency", "rate", "rates", "stock", "stocks", "crypto", "bitcoin", "price", "prices", "github", "repository", "repo"],
    phrases: ["call an api", "call the api", "public api", "fetch json", "exchange rate", "stock price", "weather in"],
    reason: "Live structured data of this kind comes from a public API.",
  },
  {
    id: "compute",
    tool: "calculator",
    words: ["calculate", "calculation", "compute", "math", "maths", "arithmetic", "sum", "total", "add", "subtract", "multiply", "divide", "percent", "percentage", "average", "mean", "difference", "ratio", "budget", "cost", "profit", "margin", "tax", "discount", "convert", "conversion", "age", "years", "days", "count", "number", "numbers", "formula", "estimate"],
    phrases: ["work out", "how much", "how many years", "years ago", "how old", "years old", "age of", "figure out", "add up", "per cent"],
    reason: "Numbers have to be worked out exactly rather than guessed.",
  },
  {
    id: "code",
    tool: "code_exec",
    words: ["code", "script", "javascript", "js", "program", "programming", "function", "algorithm", "fibonacci", "prime", "primes", "sort", "sorting", "parse", "regex", "simulate", "simulation", "loop", "generate", "random", "matrix", "array", "string", "compile", "execute", "debug", "test"],
    phrases: ["run code", "write code", "write a script", "run a script", "write javascript", "execute code", "run it"],
    reason: "Writing and running a program is the reliable way to do this.",
  },
  {
    id: "data",
    tool: "database",
    words: ["database", "db", "sql", "query", "table", "tables", "records", "rows", "orders", "customers", "products", "sales", "revenue", "inventory", "dataset", "analytics", "analyse", "analyze", "analysis", "aggregate", "category", "categories", "top", "ranking", "kpi", "metrics", "dashboard"],
    phrases: ["from the database", "in the database", "run a query", "sql query", "sales data", "order data", "most revenue", "best selling", "top selling"],
    reason: "The data lives in a database and needs a query.",
  },
  {
    id: "files",
    tool: "file_ops",
    words: ["file", "files", "save", "write", "report", "document", "txt", "markdown", "md", "csv", "notes", "note", "log", "export", "download", "store", "record", "draft", "output"],
    phrases: ["save to", "write to a file", "save it", "create a file", "write a report", "save the result", "keep a record", "write it down", "save as"],
    reason: "Results have to be written somewhere that outlasts the answer.",
    sideEffect: true,
  },
  {
    id: "memory",
    tool: "memory",
    words: ["remember", "memory", "memorize", "memorise", "recall", "forget", "preference", "preferences", "persist", "later", "remind", "track", "tracking", "history", "previous", "last", "earlier", "profile", "context"],
    phrases: ["keep track", "next time", "remember that", "store in memory", "for later", "keep in mind", "across runs", "between runs"],
    reason: "It must keep facts between steps or runs.",
  },
  {
    id: "knowledge",
    tool: "rag_retrieve",
    words: ["knowledge", "documents", "docs", "uploaded", "upload", "manual", "handbook", "policy", "policies", "contract", "paper", "papers", "thesis", "textbook", "notes", "wiki", "faq", "kb"],
    phrases: ["knowledge base", "my documents", "my files", "the documents", "uploaded files", "our docs", "company documents", "internal docs", "from my notes", "the pdf", "the manual"],
    reason: "The answers should come from the person's own documents.",
  },
  {
    id: "time",
    tool: "clock",
    words: ["time", "date", "today", "now", "tomorrow", "yesterday", "clock", "deadline", "schedule", "calendar", "weekday", "month", "year", "hour", "minutes", "timestamp", "morning", "evening", "tonight"],
    phrases: ["current time", "current date", "what time", "today's date", "right now", "days until", "how long until"],
    reason: "The current date or time matters to the answer.",
  },
  {
    id: "notify",
    tool: "external_service",
    words: ["send", "notify", "notification", "email", "mail", "message", "text", "sms", "whatsapp", "slack", "teams", "discord", "telegram", "alert", "alerts", "ticket", "jira", "post", "publish", "tweet", "share", "announce", "escalate", "page", "call"],
    phrases: ["send an email", "send a message", "let me know", "notify me", "post to", "create a ticket", "open a ticket", "send it to", "ping the team", "inform the team", "on call", "on-call"],
    reason: "It has to act on an outside system, not just answer.",
    sideEffect: true,
  },
  {
    id: "ask",
    tool: "ask_human",
    // "check" and "verify" are everyday verbs ("check the weather"); only the phrases below mean asking a person.
    words: ["ask", "clarify", "clarification", "permission", "approve", "approval", "consult"],
    phrases: ["ask me", "ask the user", "check with me", "confirm with me", "my permission", "before doing", "before you", "let me choose", "let me decide", "ask first", "ask before", "wait for my", "get my approval", "confirm first", "double-check with"],
    reason: "The person wants to be asked before or during the work.",
  },
  {
    id: "flaky",
    tool: "unreliable_service",
    words: ["flaky", "unreliable", "unstable", "retry", "retries", "fallback", "fallbacks", "resilient", "resilience", "failover", "timeout", "timeouts", "fails", "failing", "outage"],
    phrases: ["keeps failing", "if it fails", "try again", "fall back", "back up plan", "backup plan", "handle errors", "handle failures"],
    reason: "The description is about coping with a service that fails.",
  },
];

/** Things people ask for that no tool here does for real. Named honestly rather than faked. */
const GAPS: { id: string; words: string[]; phrases?: string[]; capability: string; suggestion: string }[] = [
  { id: "email", words: ["email", "mail", "gmail", "outlook", "inbox"], phrases: ["send an email"], capability: "Sending real email", suggestion: "The lab has no mail server. The external_service tool stands in for it and is labelled a simulation; a webhook custom tool pointed at your own mail API would make it real." },
  { id: "chat", words: ["slack", "whatsapp", "telegram", "discord", "teams", "sms"], capability: "Posting to a chat or messaging app", suggestion: "external_service simulates the send. To make it real, add a custom tool that calls your Slack, Telegram or Twilio webhook." },
  { id: "schedule", words: ["every", "daily", "weekly", "hourly", "cron", "recurring", "schedule", "scheduled", "automatically"], phrases: ["every day", "every morning", "each morning", "every week", "every hour", "on a schedule"], capability: "Running on a schedule", suggestion: "Runs start when you press RUN. Scheduling is not built in; run it by hand, or trigger the start endpoint from your own scheduler." },
  { id: "browser", words: ["login", "log", "click", "browse", "browser", "form", "checkout", "buy", "purchase", "book", "reserve", "signup", "captcha"], phrases: ["log in", "log into", "fill in", "fill out", "click on", "sign in", "add to cart", "book a"], capability: "Driving a website like a person (logins, forms, clicks, purchases)", suggestion: "The lab reads pages but does not operate them. web_fetch gets the public text; anything behind a login or a button is out of reach." },
  { id: "media", words: ["image", "images", "photo", "photos", "picture", "pictures", "video", "audio", "voice", "speech", "draw", "generate image"], capability: "Working with images, audio or video", suggestion: "All tools here are text. Describe what the image or audio should contain and the agent can plan around text only." },
  { id: "payments", words: ["pay", "payment", "invoice", "transfer", "wallet", "bank", "card"], phrases: ["send money", "make a payment"], capability: "Moving money", suggestion: "Nothing here touches payments, deliberately. The agent can compute and draft; a person completes the transaction." },
  { id: "private-data", words: ["crm", "salesforce", "hubspot", "notion", "airtable", "sheets", "spreadsheet", "excel", "drive", "dropbox"], phrases: ["google sheets", "google drive"], capability: "Reading your private business systems", suggestion: "The database tool holds a sample shop dataset only. Export your data as text into the RAG knowledge base, or add a custom tool that calls your system's API." },
];

/** Phrases that read as constraints on the answer rather than as work to do. */
const CONSTRAINT_PATTERNS: { re: RegExp; instruction: (m: RegExpMatchArray) => string }[] = [
  { re: /\bin (one|two|three|1|2|3|a few|\d+) (sentence|sentences|line|lines|paragraph|paragraphs|words|bullets|bullet points)\b/i, instruction: (m) => `Answer in ${m[1]} ${m[2]}.` },
  { re: /\b(be brief|briefly|short answer|keep it short|concise|concisely|in short)\b/i, instruction: () => "Keep the answer short." },
  { re: /\b(bullet points|as a list|as bullets|numbered list|step by step|step-by-step)\b/i, instruction: (m) => `Format the answer ${/step/i.test(m[1]) ? "step by step" : "as a list"}.` },
  { re: /\b(cite|citing|sources|references|with links|name your sources|show sources)\b/i, instruction: () => "Name the sources or tools behind each fact." },
  { re: /\bin (urdu|hindi|arabic|french|german|spanish|italian|turkish|chinese|japanese|korean|portuguese|russian|bengali|punjabi|pashto|english)\b/i, instruction: (m) => `Write the final answer in ${capitalize(m[1]!)}.` },
  { re: /\b(simple words|simple terms|for a beginner|for beginners|like i am (five|5|ten|10)|plain english|non-technical|layman)\b/i, instruction: () => "Explain in plain, non-technical language." },
  { re: /\b(detailed|in detail|thorough|thoroughly|comprehensive|deep dive)\b/i, instruction: () => "Be thorough and detailed." },
  { re: /\b(table|as a table|in a table)\b/i, instruction: () => "Present comparable figures as a table." },
  { re: /\b(double[- ]check|verify|double check|make sure|be accurate|accurately)\b/i, instruction: () => "Verify facts with a tool before stating them." },
  { re: /\bdo not (use|call|touch|change|delete|send|modify)\b[^.,;]*/i, instruction: (m) => `${capitalize(m[0])}.` },
  { re: /\b(only|never)\b[^.,;]{4,60}/i, instruction: (m) => `${capitalize(m[0].trim())}.` },
];

/** Signs that several independent lookups are wanted, which parallel calls serve well. */
const PARALLEL_SIGNS = [/\b(each|every|all of|both|several|multiple|various|list of)\b/i, /,\s*\w+(?:\s+\w+)?\s+and\s+\w+/i, /\b(compare|comparison|versus|vs\.?|rank|ranking)\b/i];

/* ─────────────────────────────── matching ──────────────────────────── */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}\s'./:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/https?:\/\/\S+/g, " url ")
    .split(/[\s,.;:!?()"']+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
}

/** Damerau–Levenshtein distance, small inputs only. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[m]![n]!;
}

/** Light stemming so "searching", "searched" and "searches" all reach "search". */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ing", "ed", "es", "s", "ly", "tion", "ment"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      // "running" → "run", "stopped" → "stop": drop the doubled consonant.
      if ((suffix === "ing" || suffix === "ed") && w.length > 3 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
      break;
    }
  }
  return w;
}

/** A token matches a vocabulary word exactly, by stem, or within one typo for longer words. */
export function wordMatches(token: string, word: string): boolean {
  if (token === word) return true;
  const ts = stem(token);
  const ws = stem(word);
  if (ts === ws) return true;
  if (token.length >= 5 && word.length >= 5) {
    const tolerance = token.length >= 8 ? 2 : 1;
    if (editDistance(token, word) <= tolerance) return true;
    if (editDistance(ts, ws) <= 1 && Math.min(ts.length, ws.length) >= 4) return true;
  }
  return false;
}

interface Hit {
  capability: Capability;
  evidence: string[];
  score: number;
}

function findHits(description: string): Hit[] {
  const norm = normalize(description);
  const tokens = tokenize(description);
  const hits: Hit[] = [];
  for (const cap of CAPABILITIES) {
    const evidence = new Set<string>();
    let score = 0;
    for (const phrase of cap.phrases ?? []) {
      if (norm.includes(phrase)) {
        evidence.add(phrase);
        score += 2;
      }
    }
    for (const token of tokens) {
      for (const word of cap.words) {
        if (wordMatches(token, word)) {
          evidence.add(token);
          // A long, specific word ("calculate", "database") is unambiguous even misspelled; short fuzzy hits count less.
          score += token === word ? 1 : word.length >= 8 ? 0.9 : 0.6;
          break;
        }
      }
    }
    if (score > 0) hits.push({ capability: cap, evidence: [...evidence], score });
  }
  return hits;
}

/* ─────────────────────────────── analyzer ──────────────────────────── */

export interface RuleAnalysis extends Omit<AgentBlueprint, "source" | "model" | "usage"> {
  hits: { capability: string; score: number }[];
}

/** Deterministic analysis. Same words in, same plan out; every choice cites its evidence. */
export function analyzeDescription(description: string, options: { knowledgeBaseAvailable?: boolean } = {}): RuleAnalysis {
  const text = description.trim();
  const norm = normalize(text);
  const hits = findHits(text);
  const hasUrl = /https?:\/\/\S+/i.test(text);

  // A stray common word ("check", "time", "write") is not a request for a tool; weak
  // single hits stay out unless nothing else was found. Strong evidence keeps them.
  const threshold = 0.9;
  const ranked = hits.filter((h) => h.score >= threshold).sort((a, b) => b.score - a.score);
  const chosen = new Map<string, BlueprintTool>();
  const warnings: string[] = [];

  const add = (id: string, confidence: number, reason: string, evidence: string[]) => {
    const existing = chosen.get(id);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      for (const e of evidence) if (!existing.evidence.includes(e)) existing.evidence.push(e);
      return;
    }
    chosen.set(id, { id, confidence: Math.min(1, confidence), reason, evidence, from: "rules" });
  };

  for (const h of ranked) {
    if (!h.capability.tool) continue;
    // "time" words alone are usually incidental; require a phrase or two words.
    if (h.capability.id === "time" && h.score < 2 && !/\b(today|now|date|time)\b/.test(norm)) continue;
    // "read" without search, a URL or a document is usually "read the results", so pair it with search.
    add(h.capability.tool, Math.min(1, 0.45 + h.score * 0.15), h.capability.reason, h.evidence);
  }
  if (hasUrl) add("web_fetch", 0.95, "The description contains a link to read.", [text.match(/https?:\/\/\S+/i)![0]!.slice(0, 60)]);
  if (chosen.has("web_fetch") && !chosen.has("web_search") && !hasUrl && !chosen.has("rag_retrieve")) add("web_search", 0.6, "Reading a page usually starts with finding it.", ["read"]);
  if (chosen.has("web_search") && !chosen.has("web_fetch") && ranked.some((h) => h.capability.id === "search" && h.score >= 3)) add("web_fetch", 0.55, "Detailed facts often need the page behind a search result.", ["search"]);
  if (chosen.has("http_api") && /\b(weather|forecast|temperature)\b/.test(norm)) warnings.push("Weather works without a key through https://api.open-meteo.com (the agent needs coordinates; a search can supply them).");
  if (chosen.has("http_api") && /\b(stock|stocks|crypto|bitcoin|currency|exchange)\b/.test(norm)) warnings.push("Price APIs often need a key. The agent can try public endpoints; if they refuse, it will say so rather than invent numbers.");

  // Retrieval only helps when the person's documents exist.
  const needsKnowledgeBase = chosen.has("rag_retrieve");
  if (needsKnowledgeBase && options.knowledgeBaseAvailable === false) warnings.push("This agent reads your own documents. Add them in the RAG lab and attach the knowledge base before running.");

  // Side effects wait for a person. Files are low-stakes and stay unguarded; sending things does not.
  const approvalRequired: string[] = [];
  if (chosen.has("external_service")) approvalRequired.push("external_service");
  const asksForConfirmation = ranked.some((h) => h.capability.id === "ask");
  if (asksForConfirmation && chosen.has("file_ops") && /\b(before (saving|writing|deleting)|confirm (the|before))\b/.test(norm)) approvalRequired.push("file_ops");

  // Resilience demo wiring.
  const fallbacks: Record<string, string> = {};
  let retry = { ...DEFAULT_AGENT_CONFIG.retry };
  if (chosen.has("unreliable_service")) {
    add("external_service", 0.6, "A backup tool to fall back to when the flaky service keeps failing.", ["fallback"]);
    fallbacks.unreliable_service = "external_service";
    retry = { maxAttempts: 3, backoffMs: 400 };
    if (!approvalRequired.includes("external_service")) warnings.push("The flaky service and its fallback are simulations, so this run demonstrates retries rather than doing real work.");
  }

  const tools = [...chosen.values()].sort((a, b) => b.confidence - a.confidence);
  const parallel = PARALLEL_SIGNS.some((re) => re.test(text)) || tools.filter((t) => ["web_search", "http_api", "clock", "calculator"].includes(t.id)).length >= 3;
  const thorough = /\b(detailed|thorough|deep|comprehensive|research|investigate|report)\b/.test(norm);
  const maxIterations = Math.max(3, Math.min(AGENT_LIMITS.maxIterations, 3 + tools.length + (thorough ? 2 : 0)));

  const constraints: string[] = [];
  for (const { re, instruction } of CONSTRAINT_PATTERNS) {
    const m = text.match(re);
    if (m) constraints.push(instruction(m));
  }
  if (/[؀-ۿ]/.test(text)) constraints.push("The description is written in Urdu or Arabic script; answer in the same language.");

  const gaps: BlueprintGap[] = [];
  const tokens = tokenize(text);
  for (const gap of GAPS) {
    const evidence = new Set<string>();
    for (const phrase of gap.phrases ?? []) if (norm.includes(phrase)) evidence.add(phrase);
    for (const token of tokens) for (const word of gap.words) if (wordMatches(token, word) && token.length >= 4) evidence.add(token);
    if (evidence.size) gaps.push({ capability: gap.capability, evidence: [...evidence], suggestion: gap.suggestion });
  }

  if (tools.length === 0) warnings.push("No tool matched the description, so the agent will answer from what the model knows. Mention searching, calculating, files, data or sending things to give it tools.");

  const goal = tidyGoal(text);
  const summary = summarize(tools, gaps, parallel, approvalRequired);
  const systemPrompt = [...constraints, ...(needsKnowledgeBase ? ["Prefer the knowledge base over general knowledge for anything the documents might cover, and say which passage a fact came from."] : []), ...(approvalRequired.length ? ["Some actions pause for the person's approval; if one is rejected, respect that and continue without it."] : [])].join("\n");

  return {
    goal,
    summary,
    tools,
    approvalRequired,
    fallbacks,
    parallelToolCalls: parallel,
    maxIterations,
    retry,
    needsKnowledgeBase,
    systemPrompt,
    constraints,
    gaps,
    warnings,
    hits: ranked.map((h) => ({ capability: h.capability.id, score: Math.round(h.score * 10) / 10 })),
  };
}

function tidyGoal(text: string): string {
  let goal = text.replace(/\s+/g, " ").trim();
  // "an agent that finds X" reads better as an instruction to the agent.
  goal = goal.replace(/^(i want|i need|i would like|i'd like|please|can you|could you|make|build|create|design)\s+(an?\s+|the\s+)?(agent|bot|assistant)?\s*(that|which|who|to)?\s*/i, "");
  goal = goal.replace(/^(an?|the)\s+(agent|bot|assistant)\s+(that|which|who|to)\s+/i, "");
  goal = goal.replace(/^(agent|bot|assistant)\s+(that|which|who|to)\s+/i, "");
  goal = goal.replace(/^(finds|searches|checks|reads|writes|calculates|sends|looks|works|computes|summarizes|summarises|gets|fetches|tells|asks|saves|stores|remembers|runs|queries|analyzes|analyses|researches)\b/i, (v) => imperative(v));
  goal = goal.charAt(0).toUpperCase() + goal.slice(1);
  if (!/[.!?]$/.test(goal)) goal += ".";
  return goal.slice(0, AGENT_LIMITS.maxGoalChars);
}

function imperative(verb: string): string {
  const v = verb.toLowerCase();
  if (v.endsWith("ches") || v.endsWith("shes") || v.endsWith("zes") || v.endsWith("sses")) return v.slice(0, -2);
  if (v.endsWith("ies")) return `${v.slice(0, -3)}y`;
  if (v.endsWith("s")) return v.slice(0, -1);
  return v;
}

const TOOL_VERBS: Record<string, string> = {
  web_search: "searches the web",
  web_fetch: "reads pages",
  http_api: "calls public APIs",
  calculator: "does exact arithmetic",
  code_exec: "writes and runs code",
  database: "queries the database",
  file_ops: "writes files",
  memory: "remembers facts",
  rag_retrieve: "reads your documents",
  clock: "checks the date and time",
  external_service: "sends notifications (simulated)",
  unreliable_service: "calls a flaky service (simulated)",
  ask_human: "asks you questions",
};

function summarize(tools: BlueprintTool[], gaps: BlueprintGap[], parallel: boolean, approvals: string[]): string {
  if (tools.length === 0) return "An agent that answers from the model's own knowledge, with no tools.";
  const verbs = tools.map((t) => TOOL_VERBS[t.id] ?? t.id);
  const list = verbs.length === 1 ? verbs[0] : `${verbs.slice(0, -1).join(", ")} and ${verbs.at(-1)}`;
  const bits = [`An agent that ${list}`];
  if (parallel) bits.push("running independent lookups at the same time");
  if (approvals.length) bits.push(`pausing for your approval before it uses ${approvals.join(" and ")}`);
  let s = `${bits.join(", ")}.`;
  if (gaps.length) s += ` ${gaps.length === 1 ? "One thing" : `${gaps.length} things`} it asks for cannot be done for real here; see below.`;
  return s;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ────────────────────────────── refinement ─────────────────────────── */

const PROPOSE_TOOL = {
  id: "propose_agent",
  name: "propose_agent",
  description: "Propose the agent configuration for the user's description. Use only tool ids from the allowed list.",
  category: "custom" as const,
  inputSchema: {
    type: "object" as const,
    properties: {
      goal: { type: "string" as const, description: "The task, written as one clear instruction to the agent, in the user's language." },
      summary: { type: "string" as const, description: "One sentence, plain words, describing what the agent will do." },
      tools: { type: "string" as const, description: "Comma-separated tool ids from the allowed list, most important first." },
      approvalRequired: { type: "string" as const, description: "Comma-separated tool ids that should wait for the human's approval; usually tools with side effects." },
      parallelToolCalls: { type: "boolean" as const, description: "True when the task has independent lookups that can run at once." },
      maxIterations: { type: "integer" as const, description: "Tool-calling rounds needed, 2–12." },
      systemPrompt: { type: "string" as const, description: "Extra instructions for the agent: constraints on format, language, caution. Empty if none." },
      gaps: { type: "string" as const, description: "Semicolon-separated things the user asked for that none of the allowed tools can do for real. Empty if none." },
    },
    required: ["goal", "summary", "tools", "parallelToolCalls", "maxIterations"],
  },
  source: "live" as const,
  sourceNote: "",
  sideEffects: false,
  available: true,
};

/**
 * Asks a model to refine the rule analysis. The model sees the description, the
 * rule result and the tool catalogue, and answers only through a typed tool
 * call. Anything outside the catalogue is dropped; if the model returns text
 * instead, the rule result stands. This keeps the correctness in code.
 */
export async function refineWithModel(description: string, rules: RuleAnalysis, model: AgentModel, toolDescriptions: { id: string; description: string; source: string }[], signal: AbortSignal): Promise<AgentBlueprint> {
  const allowed = new Set(toolDescriptions.map((t) => t.id));
  const catalogue = toolDescriptions.map((t) => `- ${t.id}: ${t.description.split("\n")[0]} (${t.source})`).join("\n");
  const system = `You turn a person's plain-language description of an agent into a configuration for a lab that can only use these tools:\n${catalogue}\n\nRules: choose only from these ids; never invent a tool; prefer fewer tools; tools with side effects (external_service, file_ops when destructive) should require approval; name honestly, under gaps, anything the person asked for that these tools cannot do for real. Answer by calling propose_agent exactly once.`;
  const user = `Description:\n"""${description.trim()}"""\n\nA rule-based analyzer proposed: tools ${rules.tools.map((t) => t.id).join(", ") || "none"}; parallel ${rules.parallelToolCalls}; iterations ${rules.maxIterations}; constraints ${rules.constraints.join(" | ") || "none"}. Improve on it where the description supports it.`;
  let turn;
  try {
    turn = await model.complete({ system, messages: [{ role: "user", content: user }], tools: [PROPOSE_TOOL], temperature: 0, maxOutputTokens: 700, forceText: false, parallelToolCalls: false, signal });
  } catch {
    return { ...stripHits(rules), source: "rules", warnings: [...rules.warnings, "The model could not be reached, so only the rule analyzer ran."] };
  }
  const call = turn.toolCalls.find((c) => c.name === "propose_agent");
  if (!call) return { ...stripHits(rules), source: "rules", model: turn.model, usage: turn.usage, warnings: [...rules.warnings, "The model answered in prose instead of a proposal, so only the rule analyzer's plan is used."] };

  const a = call.args;
  const list = (v: unknown) => (typeof v === "string" ? v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : []);
  const aiTools = list(a.tools).filter((id) => allowed.has(id));
  const rejected = list(a.tools).filter((id) => !allowed.has(id));
  const warnings = [...rules.warnings];
  if (rejected.length) warnings.push(`The model suggested ${rejected.join(", ")}, which do not exist here; they were dropped.`);

  const tools: BlueprintTool[] = rules.tools.map((t) => ({ ...t, from: aiTools.includes(t.id) ? "both" : "rules" }));
  for (const id of aiTools) if (!tools.some((t) => t.id === id)) tools.push({ id, confidence: 0.5, reason: "Proposed by the model from the description.", evidence: [], from: "ai" });
  // Tools only the rules found but the model left out are kept at lower confidence: the rules are the floor.
  for (const t of tools) if (t.from === "rules" && aiTools.length) t.confidence = Math.min(t.confidence, 0.5);
  tools.sort((a2, b) => b.confidence - a2.confidence);

  const approvalRequired = [...new Set([...rules.approvalRequired, ...list(a.approvalRequired).filter((id) => allowed.has(id) && tools.some((t) => t.id === id))])];
  const maxIterations = typeof a.maxIterations === "number" && Number.isFinite(a.maxIterations) ? Math.max(2, Math.min(AGENT_LIMITS.maxIterations, Math.round(a.maxIterations))) : rules.maxIterations;
  const parallelToolCalls = typeof a.parallelToolCalls === "boolean" ? a.parallelToolCalls : rules.parallelToolCalls;
  const aiPrompt = typeof a.systemPrompt === "string" ? a.systemPrompt.trim().slice(0, 1500) : "";
  const systemPrompt = [rules.systemPrompt, aiPrompt].filter(Boolean).join("\n").slice(0, AGENT_LIMITS.maxSystemPromptChars);
  const aiGaps = typeof a.gaps === "string" ? a.gaps.split(";").map((s) => s.trim()).filter(Boolean) : [];
  const gaps: BlueprintGap[] = [...rules.gaps];
  const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4));
  for (const g of aiGaps) {
    const gw = words(g);
    const duplicate = gaps.some((x) => [...words(`${x.capability} ${x.suggestion} ${x.evidence.join(" ")}`)].some((w) => gw.has(w)));
    if (!duplicate) gaps.push({ capability: g, evidence: [], suggestion: "Named by the model as something these tools cannot do for real." });
  }
  const goal = typeof a.goal === "string" && a.goal.trim().length > 8 ? a.goal.trim().slice(0, AGENT_LIMITS.maxGoalChars) : rules.goal;
  const summary = typeof a.summary === "string" && a.summary.trim() ? a.summary.trim().slice(0, 300) : rules.summary;

  return {
    goal,
    summary,
    tools,
    approvalRequired,
    fallbacks: rules.fallbacks,
    parallelToolCalls,
    maxIterations,
    retry: rules.retry,
    needsKnowledgeBase: tools.some((t) => t.id === "rag_retrieve"),
    systemPrompt,
    constraints: rules.constraints,
    gaps,
    warnings,
    source: "ai+rules",
    model: turn.model,
    usage: turn.usage,
  };
}

function stripHits(r: RuleAnalysis): Omit<AgentBlueprint, "source"> {
  const { hits: _hits, ...rest } = r;
  return rest;
}

export const KNOWN_TOOL_IDS = BUILTIN_TOOL_IDS;
