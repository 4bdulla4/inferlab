import type { MLConfig, MLEvent } from "@shared/ml";
import { fetchDatasetRows, fetchDatasets, fetchMLStatus, fetchModelInfo, pasteDataset, predictWithModel, streamTraining, uploadDataset } from "@/api/mlClient";
import { EventBus } from "@/engine/events/EventBus";
import { PlaybackController, type PlaybackHost } from "@/engine/execution/PlaybackController";
import type { AnyMLEvent } from "@/labs/ml/events";
import { MLEventSequencer } from "@/labs/ml/sequencer";
import { createMLRun } from "@/labs/ml/state";
import { useMLStore } from "@/store/mlStore";
import { useUIStore } from "@/store/uiStore";

interface Handle {
  controller: PlaybackController<AnyMLEvent>;
  bus: EventBus<AnyMLEvent>;
  abort: AbortController;
  sequencer: MLEventSequencer;
}

/** Behaviour lives here; the store only holds data. */
const handles = new Map<string, Handle>();
const SESSION_KEY = "inferlab.ml.session.v1";

function sessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

function host(runId: string): PlaybackHost<AnyMLEvent> {
  const store = useMLStore;
  return {
    getLogLength: () => store.getState().runs[runId]?.log.length ?? 0,
    getCursor: () => store.getState().runs[runId]?.cursor ?? 0,
    isLiveDone: () => store.getState().runs[runId]?.liveDone ?? true,
    getEvent: (i) => store.getState().runs[runId]?.log[i],
    applyNext: () => store.getState().applyNext(runId),
    resetVisual: () => store.getState().resetVisual(runId),
    setPlaybackState: (s) => store.getState().setPlayback(runId, s),
    getSpeed: () => useUIStore.getState().speed,
    onLogGrow: (listener) =>
      store.subscribe((state, prev) => {
        const a = state.runs[runId];
        const b = prev.runs[runId];
        if (!a) return;
        if (a.log.length !== (b?.log.length ?? 0) || a.liveDone !== (b?.liveDone ?? false)) listener();
      }),
  };
}

function algorithmName(config: MLConfig): string {
  return config.algorithm.replace(/_/g, " ");
}

export const mlRuntime = {
  /**
   * Loads samples, algorithms, limits and the dataset list, retrying while the
   * API boots. The tail is long because editing a server file restarts the API
   * mid-session: a browser that reloads into that window must wait it out
   * rather than stranding the lab on "connecting" until someone reloads again.
   */
  async refreshStatus(): Promise<void> {
    const delays = [400, 800, 1500, 3000, 5000, 8000, 8000];
    for (let attempt = 0; ; attempt++) {
      try {
        const [status, datasets] = await Promise.all([fetchMLStatus(), fetchDatasets()]);
        useMLStore.getState().setStatus(status);
        useMLStore.getState().setDatasets(datasets);
        return;
      } catch (err) {
        const delay = delays[attempt];
        if (delay === undefined) {
          useMLStore.getState().setStatus(useMLStore.getState().status, err instanceof Error ? err.message : "Could not reach the ML service.");
          return;
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  },

  async refreshDatasets(): Promise<void> {
    useMLStore.getState().setDatasets(await fetchDatasets());
  },

  /** Loads the rows of the chosen dataset for the inspector table. */
  async loadRows(id: string): Promise<void> {
    const store = useMLStore.getState();
    if (store.datasetRows?.id === id) return;
    store.setDatasetRows(null);
    try {
      const r = await fetchDatasetRows(id);
      if (useMLStore.getState().datasetId === id) useMLStore.getState().setDatasetRows({ id, columns: r.columns, rows: r.rows });
    } catch {
      /* the table simply stays empty */
    }
  },

  async upload(file: File): Promise<void> {
    const store = useMLStore.getState();
    store.setUploading(true);
    try {
      const dataset = await uploadDataset(file);
      await this.refreshDatasets();
      useMLStore.getState().selectDataset(dataset.id);
      useMLStore.getState().setUploading(false);
    } catch (err) {
      useMLStore.getState().setUploading(false, err instanceof Error ? err.message : "The dataset could not be uploaded.");
      throw err;
    }
  },

  async paste(name: string, text: string): Promise<void> {
    const store = useMLStore.getState();
    store.setUploading(true);
    try {
      const dataset = await pasteDataset(name, text);
      await this.refreshDatasets();
      useMLStore.getState().selectDataset(dataset.id);
      useMLStore.getState().setUploading(false);
    } catch (err) {
      useMLStore.getState().setUploading(false, err instanceof Error ? err.message : "The dataset could not be added.");
      throw err;
    }
  },

  /** Trains on the selected dataset with the current settings (or an override) and streams every step. */
  async start(overrides?: Partial<MLConfig>, comparisonLabel?: string): Promise<string> {
    const store = useMLStore.getState();
    const datasetId = store.datasetId;
    if (!datasetId) throw new Error("Pick a dataset first.");
    const dataset = store.datasets.find((d) => d.id === datasetId);
    const config: MLConfig = { ...store.config, ...overrides, hyperparameters: { ...store.config.hyperparameters, ...(overrides?.hyperparameters ?? {}) } };
    const runId = `ml-${store.runCounter + 1}-${Date.now().toString(36)}`;
    const label = `${algorithmName(config)} on ${dataset?.name ?? datasetId}`;
    store.createRun(createMLRun({ id: runId, datasetId, datasetName: dataset?.name ?? datasetId, config, label, comparisonLabel }));
    if (!comparisonLabel) {
      store.setActiveRun(runId);
      store.setComparison(null);
    }
    store.selectStage(null);

    const bus = new EventBus<AnyMLEvent>();
    bus.on("*", (e) => useMLStore.getState().appendEvents(runId, [e]));
    const controller = new PlaybackController<AnyMLEvent>(host(runId));
    const abort = new AbortController();
    const sequencer = new MLEventSequencer(runId);
    handles.set(runId, { controller, bus, abort, sequencer });
    controller.play();
    let failed = false;

    const onEvent = (ev: MLEvent) => {
      if (ev.type === "run_started") useMLStore.getState().setServerRunId(runId, ev.runId);
      if (ev.type === "error") failed = true;
      if (ev.type === "model_saved") {
        void fetchModelInfo(ev.modelId)
          .then((info) => useMLStore.getState().addModel(info))
          .catch(() => {});
      }
      bus.emitAll(sequencer.fromServer(ev));
    };

    streamTraining(datasetId, config, sessionId(), onEvent, abort.signal)
      .then(() => useMLStore.getState().setRunStatus(runId, failed ? "error" : "completed", true))
      .catch((err: unknown) => {
        if (abort.signal.aborted) {
          bus.emitAll(sequencer.stopped());
          useMLStore.getState().setRunStatus(runId, "stopped", true);
        } else {
          bus.emitAll(sequencer.failed(err instanceof Error ? err.message : String(err)));
          useMLStore.getState().setRunStatus(runId, "error", true);
        }
      });
    return runId;
  },

  /** Trains twice on the same data with one setting changed, so the two runs can be compared. */
  async compare(variants: { label: string; overrides: Partial<MLConfig> }[]): Promise<string[]> {
    const ids: string[] = [];
    for (const v of variants) ids.push(await this.start(v.overrides, v.label));
    const store = useMLStore.getState();
    store.setComparison(ids);
    store.setActiveRun(ids[0] ?? null);
    return ids;
  },

  /** Sends a new row through the saved model and appends the inference stages to the run. */
  async predict(runId: string, input: Record<string, string | number | boolean | null>): Promise<void> {
    const run = useMLStore.getState().runs[runId];
    const modelId = run?.visual.saved?.modelId;
    if (!run || !modelId) throw new Error("Train a model first.");
    const handle = handles.get(runId);
    const trace = await predictWithModel(modelId, input);
    const events = (handle?.sequencer ?? new MLEventSequencer(runId)).fromPrediction(input, trace);
    if (handle) {
      handle.bus.emitAll(events);
      handle.controller.play();
    } else {
      useMLStore.getState().appendEvents(runId, events);
      for (const _ of events) useMLStore.getState().applyNext(runId);
    }
  },

  stop(runId: string): void {
    handles.get(runId)?.abort.abort();
  },
  play(runId: string): void {
    handles.get(runId)?.controller.play();
  },
  pause(runId: string): void {
    handles.get(runId)?.controller.pause();
  },
  toggle(runId: string): void {
    handles.get(runId)?.controller.toggle();
  },
  step(runId: string): void {
    handles.get(runId)?.controller.step();
  },
  replay(runId: string): void {
    handles.get(runId)?.controller.replay();
  },
  isFinished(runId: string): boolean {
    return handles.get(runId)?.controller.isFinished() ?? true;
  },

  resetRuns(): void {
    for (const h of handles.values()) {
      h.abort.abort();
      h.controller.dispose();
      h.bus.clear();
    }
    handles.clear();
    useMLStore.getState().clearRuns();
  },
};
