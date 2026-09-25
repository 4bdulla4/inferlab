import type { DatasetSummary, MLConfigInput, MLEvent, MLServiceStatus, PredictionTrace, SavedModelInfo } from "@shared/ml";
import { ApiError, createSSEParser } from "./llmClient";

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let message = `${fallback} (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchMLStatus(): Promise<MLServiceStatus> {
  return json(await fetch("/api/ml/status"), "Could not load the ML service status");
}

export async function fetchDatasets(): Promise<DatasetSummary[]> {
  const r = await json<{ datasets: DatasetSummary[] }>(await fetch("/api/ml/datasets"), "Could not load datasets");
  return r.datasets;
}

export async function fetchDatasetRows(id: string): Promise<{ dataset: DatasetSummary; rows: string[][]; columns: string[] }> {
  return json(await fetch(`/api/ml/datasets/${encodeURIComponent(id)}`), "Could not load the dataset");
}

/** Uploads a file's text; the name and type travel in the query string. */
export async function uploadDataset(file: File): Promise<DatasetSummary> {
  const params = new URLSearchParams({ name: file.name, type: file.type || "" });
  const r = await json<{ dataset: DatasetSummary }>(await fetch(`/api/ml/datasets?${params}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: file }), "The dataset could not be uploaded");
  return r.dataset;
}

export async function pasteDataset(name: string, text: string): Promise<DatasetSummary> {
  const r = await json<{ dataset: DatasetSummary }>(await fetch("/api/ml/datasets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, text }) }), "The dataset could not be added");
  return r.dataset;
}

/** Starts a training run and streams its events until the server signals `end`. */
export async function streamTraining(datasetId: string, config: MLConfigInput, sessionId: string, onEvent: (event: MLEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/ml/runs", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ datasetId, config, sessionId }), signal });
  if (!res.ok) {
    let message = `Training could not start (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) message = b.error;
    } catch {
      /* ignore */
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
      onEvent(JSON.parse(data) as MLEvent);
    } catch {
      /* malformed frame */
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

export async function fetchModelInfo(modelId: string): Promise<SavedModelInfo> {
  const r = await json<{ info: SavedModelInfo }>(await fetch(`/api/ml/models/${encodeURIComponent(modelId)}`), "Could not load the model");
  return r.info;
}

export async function predictWithModel(modelId: string, input: Record<string, string | number | boolean | null>): Promise<PredictionTrace> {
  const r = await json<{ trace: PredictionTrace }>(await fetch(`/api/ml/models/${encodeURIComponent(modelId)}/predict`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) }), "The prediction failed");
  return r.trace;
}

export function modelDownloadUrl(modelId: string): string {
  return `/api/ml/models/${encodeURIComponent(modelId)}/download`;
}
