import express, { Router } from "express";
import type { MLEvent, MLServiceStatus, PredictRequestBody, StartMLRunBody } from "@shared/ml";
import { ALGORITHMS, ML_LIMITS } from "../../shared/ml";
import type { HistoryStore } from "../lib/history";
import { SSEWriter } from "../lib/sse";
import { parseTable } from "../ml/data";
import { sampleInfo } from "../ml/samples";
import { MLStore } from "../ml/store";
import { predictWithTrace, runTraining, sanitizeMLConfig } from "../ml/trainer";
import { sanitize } from "./llm";

export function createMLRouter({ history }: { history?: HistoryStore }): Router {
  const router = Router();
  const store = new MLStore();
  let counter = 0;

  router.get("/status", (_req, res) => {
    const status: MLServiceStatus = { samples: sampleInfo(), algorithms: ALGORITHMS, limits: ML_LIMITS };
    res.json(status);
  });

  router.get("/datasets", (_req, res) => {
    res.json({ datasets: store.listDatasets() });
  });

  router.get("/datasets/:id", (req, res) => {
    const d = store.dataset(String(req.params.id));
    if (!d) {
      res.status(404).json({ error: "That dataset has expired or does not exist." });
      return;
    }
    res.json({ dataset: d.summary, rows: d.table.rows.slice(0, 200), columns: d.table.columns });
  });

  /** Upload: raw bytes with the name and type in the query string, or JSON { name, text, format }. */
  router.post(
    "/datasets",
    express.json({ limit: "6mb", type: "application/json" }),
    express.text({ type: ["text/*", "application/octet-stream", "application/vnd.ms-excel"], limit: ML_LIMITS.maxUploadBytes }),
    (req, res) => {
      const isJson = (req.headers["content-type"] ?? "").includes("application/json");
      let text: string;
      let name: string;
      let format: "csv" | "json";
      if (isJson) {
        const body = req.body as { name?: string; text?: string; format?: string };
        text = typeof body.text === "string" ? body.text : "";
        name = (typeof body.name === "string" && body.name.trim()) || "pasted data";
        format = body.format === "json" || (text.trim().startsWith("[") || text.trim().startsWith("{")) ? "json" : "csv";
      } else {
        text = typeof req.body === "string" ? req.body : "";
        name = String(req.query.name ?? "upload").slice(0, 120);
        format = /json/i.test(String(req.query.type ?? "")) || name.toLowerCase().endsWith(".json") ? "json" : "csv";
      }
      if (!text.trim()) {
        res.status(400).json({ error: "The upload was empty." });
        return;
      }
      try {
        const table = parseTable(text, format);
        res.json({ dataset: store.addDataset(table, name, format, Buffer.byteLength(text)) });
      } catch (err) {
        res.status(400).json({ error: sanitize(err instanceof Error ? err.message : String(err)) });
      }
    },
  );

  router.post("/runs", express.json({ limit: "64kb" }), async (req, res) => {
    const body = req.body as Partial<StartMLRunBody> | undefined;
    const ds = body?.datasetId ? store.dataset(body.datasetId) : undefined;
    if (!ds) {
      res.status(400).json({ error: "Pick a dataset first." });
      return;
    }
    const config = sanitizeMLConfig(body?.config);
    const runId = `ml-${++counter}-${Date.now().toString(36)}`;
    const sse = new SSEWriter<MLEvent>(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const startedAt = Date.now();
    console.log(`[api] ml run ${runId} start (${ds.summary.name}, ${config.algorithm}, ${ds.table.rows.length} rows)`);
    let outcome: Awaited<ReturnType<typeof runTraining>> | undefined;
    let failure: string | undefined;
    try {
      outcome = await runTraining({ runId, datasetId: ds.summary.id, datasetName: ds.summary.name, table: ds.table, config, emit: (e) => sse.send(e), signal: abort.signal });
      if (outcome.saved) store.saveModel(outcome.saved);
    } catch (err) {
      if (!abort.signal.aborted) {
        failure = sanitize(err instanceof Error ? err.message : String(err));
        sse.send({ type: "error", at: Date.now(), message: failure, retryable: false });
      }
    } finally {
      sse.end();
      console.log(`[api] ml run ${runId} ${failure ? "error" : abort.signal.aborted && !outcome ? "aborted" : "completed"} in ${Date.now() - startedAt} ms`);
      history?.record({
        kind: "ml_run",
        at: startedAt,
        ok: Boolean(outcome) && !failure,
        error: failure,
        durationMs: Date.now() - startedAt,
        datasetName: ds.summary.name,
        rows: ds.table.rows.length,
        algorithm: config.algorithm,
        task: outcome?.saved?.info.task ?? "classification",
        iterations: outcome?.iterations ?? 0,
        epochs: outcome?.epochs ?? 0,
        headlineMetric: outcome?.metrics ? (outcome.metrics.task === "classification" ? { name: "accuracy", value: outcome.metrics.accuracy } : { name: "rmse", value: outcome.metrics.rmse }) : undefined,
        modelId: outcome?.saved?.info.modelId,
      });
    }
  });

  router.get("/models/:id", (req, res) => {
    const m = store.model(String(req.params.id));
    if (!m) {
      res.status(404).json({ error: "That model has expired or does not exist." });
      return;
    }
    res.json({ info: m.info });
  });

  router.get("/models/:id/download", (req, res) => {
    const m = store.model(String(req.params.id));
    if (!m) {
      res.status(404).json({ error: "That model has expired or does not exist." });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="${m.info.modelId}.json"`);
    res.json({ info: m.info, ...(m.json as object) });
  });

  router.post("/models/:id/predict", express.json({ limit: "32kb" }), (req, res) => {
    const m = store.model(String(req.params.id));
    if (!m) {
      res.status(404).json({ error: "That model has expired or does not exist." });
      return;
    }
    const body = req.body as Partial<PredictRequestBody> | undefined;
    if (!body?.input || typeof body.input !== "object") {
      res.status(400).json({ error: "Send { input: { column: value, ... } }." });
      return;
    }
    try {
      res.json({ trace: predictWithTrace(m, body.input) });
    } catch (err) {
      res.status(400).json({ error: sanitize(err instanceof Error ? err.message : String(err)) });
    }
  });

  return router;
}
