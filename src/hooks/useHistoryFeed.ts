import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "@shared/history";
import { fetchHistory } from "@/api/historyClient";

export interface FeedItem {
  id: string;
  title: string;
  detail: string;
  ok: boolean;
  at: number;
}

/** The notification menu forgets activity older than this; the Dashboard keeps all of it. */
export const FEED_WINDOW_MS = 24 * 60 * 60 * 1000;
const FEED_LIMIT = 12;

/** The newest items from the last 24 hours, at most FEED_LIMIT of them. */
export function recentFeed(items: FeedItem[], now: number): FeedItem[] {
  return items.filter((i) => now - i.at < FEED_WINDOW_MS).slice(0, FEED_LIMIT);
}

/** One line of the notification menu. It names the provider, never the model id. */
export function describeEntry(e: HistoryEntry): FeedItem {
  const base = { id: e.id, ok: e.ok, at: e.at };
  if (e.kind === "llm_run") return { ...base, title: `LLM request · ${e.vendor}`, detail: e.ok ? `${e.finishReason ?? "done"}${e.totalTokens ? ` · ${e.totalTokens} tokens` : ""}` : (e.error ?? "failed") };
  if (e.kind === "repo_analysis") return { ...base, title: e.repo, detail: e.ok ? `${e.filesScanned} files · ${e.nodes} modules` : (e.error ?? "failed") };
  if (e.kind === "repo_summarize") return { ...base, title: `AI summaries · ${e.repo}`, detail: e.ok ? `${e.usage?.outputTokens ?? 0} tokens out` : (e.error ?? "failed") };
  if (e.kind === "rag_ingest") return { ...base, title: `RAG · ${e.docName}`, detail: e.ok ? `${e.chunks} chunks · ${e.embeddingModel}` : (e.error ?? "failed") };
  if (e.kind === "rag_query") return { ...base, title: `RAG question · ${e.vendor}`, detail: e.ok ? `${e.retrieved} retrieved · ${e.strategy}${e.totalTokens ? ` · ${e.totalTokens} tokens` : ""}` : (e.error ?? "failed") };
  if (e.kind === "ml_run") return { ...base, title: `ML · ${e.algorithm.replace(/_/g, " ")}`, detail: e.ok ? `${e.datasetName} · ${e.headlineMetric ? `${e.headlineMetric.name} ${e.headlineMetric.value.toFixed(3)}` : "trained"}` : (e.error ?? "failed") };
  if (e.kind === "agent_run") return { ...base, title: `Agent · ${e.mock ? "offline planner" : e.vendor}`, detail: e.ok ? `${e.reason.replace(/_/g, " ")} · ${e.iterations} iteration${e.iterations === 1 ? "" : "s"} · ${e.toolCalls} tool call${e.toolCalls === 1 ? "" : "s"}` : (e.error ?? "failed") };
  return { ...base, title: e.question ?? "Question", detail: `${e.repo} · ${e.steps ?? 0} steps` };
}

/** Recent activity for the notification menu, refreshed while it is open. */
export function useHistoryFeed(active: boolean) {
  const [entries, setEntries] = useState<FeedItem[]>([]);
  const [unread, setUnread] = useState(0);
  const seenAt = useRef<number>(Date.now());

  const load = useCallback(async () => {
    try {
      // Fetch a little more than is shown, so the window still fills after older items drop out.
      const data = await fetchHistory(FEED_LIMIT * 4);
      const items = recentFeed(data.entries.map(describeEntry), Date.now());
      setEntries(items);
      setUnread(items.filter((i) => i.at > seenAt.current).length);
    } catch {
      /* the badge simply stays as it is */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), active ? 5000 : 30000);
    return () => clearInterval(timer);
  }, [load, active]);

  const markRead = useCallback(() => {
    seenAt.current = Date.now();
    setUnread(0);
  }, []);

  return { entries, unread, markRead };
}
