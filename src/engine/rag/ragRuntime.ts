import type { AddTextBody, KnowledgeBaseSnapshot, RagIngestEvent, RagQueryEvent, RagSettings } from "@shared/rag";
import {
  addTextDocument,
  addUrlDocument,
  createKnowledgeBase,
  explainRag,
  fetchKnowledgeBase,
  fetchRagStatus,
  rebuildIndex,
  removeDocument,
  streamQuery,
  updateRagSettings,
  uploadDocument,
} from "@/api/ragClient";
import { EventBus } from "@/engine/events/EventBus";
import { PlaybackController, type PlaybackHost } from "@/engine/execution/PlaybackController";
import type { AnyRagEvent } from "@/labs/rag/events";
import { RagEventSequencer } from "@/labs/rag/sequencer";
import { createRagRun, type RagRunKind } from "@/labs/rag/state";
import { useRagStore } from "@/store/ragStore";
import { useUIStore } from "@/store/uiStore";

interface Handle {
  controller: PlaybackController<AnyRagEvent>;
  bus: EventBus<AnyRagEvent>;
  abort: AbortController;
}

/** Behaviour lives here; the store only holds data. */
const handles = new Map<string, Handle>();
const KB_KEY = "inferlab.rag.kb.v1";

function host(runId: string): PlaybackHost<AnyRagEvent> {
  const store = useRagStore;
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

function nextRunId(kind: RagRunKind): string {
  return `${kind}-${useRagStore.getState().runCounter + 1}-${Date.now().toString(36)}`;
}

/** Starts a run: creates the record, wires the bus to the store, starts playback. */
function openRun(kind: RagRunKind, label: string, settings: RagSettings, comparisonLabel?: string): { runId: string; bus: EventBus<AnyRagEvent>; abort: AbortController; sequencer: RagEventSequencer } {
  const store = useRagStore.getState();
  const kbId = store.kb?.id ?? "";
  const runId = nextRunId(kind);
  // A question runs against an index that already exists, so its canvas starts
  // with that index in place. An ingestion run builds the index and starts bare.
  const kbSnapshot = kind === "query" ? store.kb : null;
  store.createRun(createRagRun({ id: runId, kind, label, kbId, settings, comparisonLabel, kbSnapshot }));
  const bus = new EventBus<AnyRagEvent>();
  bus.on("*", (e) => useRagStore.getState().appendEvents(runId, [e]));
  const controller = new PlaybackController<AnyRagEvent>(host(runId));
  const abort = new AbortController();
  handles.set(runId, { controller, bus, abort });
  controller.play();
  return { runId, bus, abort, sequencer: new RagEventSequencer(runId) };
}

function closeRun(runId: string, status: "completed" | "error" | "stopped"): void {
  useRagStore.getState().setRunStatus(runId, status, true);
}

async function withKb<T>(fn: (kbId: string) => Promise<T>): Promise<T> {
  const kb = await ragRuntime.ensureKb();
  return fn(kb.id);
}

/** Runs one ingestion stream (add or rebuild) as a visible run on the stage. */
async function runIngest(label: string, start: (onEvent: (e: RagIngestEvent) => void, signal: AbortSignal) => Promise<void>): Promise<void> {
  const store = useRagStore.getState();
  if (store.ingesting) throw new Error("Another document is still being added.");
  store.setIngesting(true);
  store.setComparison(null);
  const { runId, bus, abort, sequencer } = openRun("ingest", label, store.settings);
  store.setActiveRun(runId);
  let failed = false;
  try {
    await start((ev) => {
      if (ev.type === "ingest_completed") useRagStore.getState().setKb(ev.snapshot);
      if (ev.type === "error") failed = true;
      bus.emitAll(sequencer.fromIngest(ev));
    }, abort.signal);
    closeRun(runId, failed ? "error" : "completed");
  } catch (err) {
    if (abort.signal.aborted) {
      bus.emitAll(sequencer.stopped());
      closeRun(runId, "stopped");
    } else {
      bus.emitAll(sequencer.failed(err instanceof Error ? err.message : String(err), (err as { status?: number }).status));
      closeRun(runId, "error");
    }
  } finally {
    useRagStore.getState().setIngesting(false);
    // Whatever happened, the snapshot on the server is the truth.
    const kbId = useRagStore.getState().kb?.id;
    if (kbId) fetchKnowledgeBase(kbId).then((snap) => useRagStore.getState().setKb(snap)).catch(() => {});
  }
}

export const ragRuntime = {
  /** Loads service status (which embedding models and LLMs can run right now). */
  async refreshStatus(): Promise<void> {
    try {
      useRagStore.getState().setService(await fetchRagStatus());
    } catch {
      /* the settings panel degrades gracefully */
    }
  },

  /** Reuses the knowledge base from this browser session when the server still has it. */
  async ensureKb(): Promise<KnowledgeBaseSnapshot> {
    const store = useRagStore.getState();
    if (store.kb) return store.kb;
    store.setKbStatus("loading");
    try {
      let saved: string | null = null;
      try {
        saved = window.sessionStorage.getItem(KB_KEY);
      } catch {
        /* storage unavailable */
      }
      let snapshot: KnowledgeBaseSnapshot | null = null;
      if (saved) snapshot = await fetchKnowledgeBase(saved).catch(() => null);
      if (!snapshot) snapshot = await createKnowledgeBase();
      try {
        window.sessionStorage.setItem(KB_KEY, snapshot.id);
      } catch {
        /* ignore */
      }
      useRagStore.getState().setKb(snapshot);
      return snapshot;
    } catch (err) {
      useRagStore.getState().setKbStatus("error", err instanceof Error ? err.message : "Could not reach the RAG service.");
      throw err;
    }
  },

  /** Saves settings to the server; the snapshot says whether the index is now stale. */
  async saveSettings(partial: Partial<RagSettings>): Promise<void> {
    useRagStore.getState().setSettings(partial);
    await withKb(async (kbId) => {
      const snap = await updateRagSettings(kbId, partial);
      useRagStore.getState().setKb(snap);
    });
  },

  addText(body: AddTextBody): Promise<void> {
    return withKb((kbId) => runIngest(body.name, (onEvent, signal) => addTextDocument(kbId, body, onEvent, signal)));
  },

  addUrl(url: string): Promise<void> {
    return withKb((kbId) => runIngest(url.replace(/^https?:\/\//, ""), (onEvent, signal) => addUrlDocument(kbId, url, onEvent, signal)));
  },

  uploadFile(file: File): Promise<void> {
    return withKb((kbId) => runIngest(file.name, (onEvent, signal) => uploadDocument(kbId, file, onEvent, signal)));
  },

  rebuild(): Promise<void> {
    return withKb((kbId) => runIngest("Rebuild index", (onEvent, signal) => rebuildIndex(kbId, onEvent, signal)));
  },

  async removeDocument(docId: string): Promise<void> {
    await withKb(async (kbId) => {
      const snap = await removeDocument(kbId, docId);
      useRagStore.getState().setKb(snap);
    });
  },

  /** Asks a question. Overrides let a comparison run use different settings without saving them. */
  async ask(question: string, overrides?: Partial<RagSettings>, comparisonLabel?: string): Promise<string> {
    const kb = await this.ensureKb();
    const store = useRagStore.getState();
    const settings = { ...store.settings, ...(overrides ?? {}) };
    const { runId, bus, abort, sequencer } = openRun("query", question, settings, comparisonLabel);
    if (!comparisonLabel) {
      store.setComparison(null);
      store.setActiveRun(runId);
    }
    let failed = false;
    streamQuery(
      kb.id,
      { question, settings: overrides },
      (ev: RagQueryEvent) => {
        if (ev.type === "error") failed = true;
        bus.emitAll(sequencer.fromQuery(ev));
      },
      abort.signal,
    )
      .then(() => closeRun(runId, failed ? "error" : "completed"))
      .catch((err: unknown) => {
        if (abort.signal.aborted) {
          bus.emitAll(sequencer.stopped());
          closeRun(runId, "stopped");
        } else {
          bus.emitAll(sequencer.failed(err instanceof Error ? err.message : String(err), (err as { status?: number }).status));
          closeRun(runId, "error");
        }
      });
    return runId;
  },

  /** The same question twice with different settings, shown side by side. */
  async compare(question: string, variants: { label: string; overrides: Partial<RagSettings> }[]): Promise<string[]> {
    const ids: string[] = [];
    for (const v of variants) ids.push(await this.ask(question, v.overrides, v.label));
    const store = useRagStore.getState();
    store.setComparison(ids);
    store.setActiveRun(ids[0] ?? null);
    return ids;
  },

  async explain(question: string, runId?: string): Promise<void> {
    const store = useRagStore.getState();
    store.setExplain({ loading: true, question, error: null });
    try {
      const kb = await this.ensureKb();
      const result = await explainRag(kb.id, { question, runId });
      useRagStore.getState().setExplain({ loading: false, result });
    } catch (err) {
      useRagStore.getState().setExplain({ loading: false, error: err instanceof Error ? err.message : "Could not explain the pipeline." });
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

  /** Drops every run (not the knowledge base). */
  resetRuns(): void {
    for (const h of handles.values()) {
      h.abort.abort();
      h.controller.dispose();
      h.bus.clear();
    }
    handles.clear();
    useRagStore.getState().clearRuns();
  },
};
