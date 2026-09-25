import type { HistoryResponse } from "@shared/history";
import { ApiError } from "./llmClient";

export async function fetchHistory(limit = 200): Promise<HistoryResponse> {
  const res = await fetch(`/api/history?limit=${limit}`);
  if (!res.ok) throw new ApiError(`Failed to load history (${res.status})`, res.status);
  return (await res.json()) as HistoryResponse;
}

export async function clearHistory(): Promise<HistoryResponse> {
  const res = await fetch("/api/history", { method: "DELETE" });
  if (!res.ok) throw new ApiError(`Failed to clear history (${res.status})`, res.status);
  return (await res.json()) as HistoryResponse;
}
