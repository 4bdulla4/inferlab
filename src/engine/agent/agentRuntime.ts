import type { AgentConfig, AgentEvent } from "@shared/agent";
import { clearAgentSession, fetchAgentSession, fetchAgentStatus, resolveAgentApproval, stopAgentRun, streamAgentRun } from "@/api/agentClient";
import { EventBus } from "@/engine/events/EventBus";
import { PlaybackController, type PlaybackHost } from "@/engine/execution/PlaybackController";
import type { AnyAgentEvent } from "@/labs/agent/events";
import { AgentEventSequencer } from "@/labs/agent/sequencer";
import { createAgentRun } from "@/labs/agent/state";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";

interface Handle {
  controller: PlaybackController<AnyAgentEvent>;
  bus: EventBus<AnyAgentEvent>;
  abort: AbortController;
}

/** Behaviour lives here; the store only holds data. */
const handles = new Map<string, Handle>();
const SESSION_KEY = "inferlab.agent.session.v1";

/** One id per browser tab, so memory and files persist across runs in it. */
export function agentSessionId(): string {
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

function host(runId: string): PlaybackHost<AnyAgentEvent> {
  const store = useAgentStore;
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

export const agentRuntime = {
  /** Loads providers, tools and scenarios, retrying while the API boots. */
  async refreshStatus(kbId?: string | null): Promise<void> {
    const delays = [500, 1000, 2000, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        useAgentStore.getState().setStatus(await fetchAgentStatus(kbId));
        return;
      } catch (err) {
        const delay = delays[attempt];
        if (delay === undefined) {
          useAgentStore.getState().setStatus(useAgentStore.getState().status, err instanceof Error ? err.message : "Could not reach the agent service.");
          return;
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  },

  async refreshWorkspace(): Promise<void> {
    try {
      useAgentStore.getState().setWorkspace(await fetchAgentSession(agentSessionId()));
    } catch {
      /* the workspace panel degrades gracefully */
    }
  },

  async clearWorkspace(): Promise<void> {
    await clearAgentSession(agentSessionId());
    await this.refreshWorkspace();
  },

  /** Starts a run: creates the record, wires the bus to the store, starts playback and the stream. */
  async start(goal: string, config: AgentConfig, scenarioId: string | null): Promise<string> {
    const store = useAgentStore.getState();
    const runId = `agent-${store.runCounter + 1}-${Date.now().toString(36)}`;
    store.createRun(createAgentRun({ id: runId, goal, config, scenarioId }));
    store.setActiveRun(runId);
    store.selectNode(null);
    const bus = new EventBus<AnyAgentEvent>();
    bus.on("*", (e) => useAgentStore.getState().appendEvents(runId, [e]));
    const controller = new PlaybackController<AnyAgentEvent>(host(runId));
    const abort = new AbortController();
    handles.set(runId, { controller, bus, abort });
    controller.play();
    const sequencer = new AgentEventSequencer(runId);
    let failed = false;
    let stoppedByUs = false;

    const onEvent = (ev: AgentEvent) => {
      if (ev.type === "run_started") useAgentStore.getState().setServerRunId(runId, ev.runId);
      if (ev.type === "error") failed = true;
      if (ev.type === "run_completed" && ev.reason === "stopped") stoppedByUs = true;
      bus.emitAll(sequencer.fromServer(ev));
    };

    streamAgentRun({ goal, config, scenarioId, sessionId: agentSessionId() }, onEvent, abort.signal)
      .then(() => {
        useAgentStore.getState().setRunStatus(runId, failed ? "error" : stoppedByUs ? "stopped" : "completed", true);
        void this.refreshWorkspace();
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) {
          bus.emitAll(sequencer.stopped());
          useAgentStore.getState().setRunStatus(runId, "stopped", true);
        } else {
          bus.emitAll(sequencer.failed(err instanceof Error ? err.message : String(err), (err as { status?: number }).status));
          useAgentStore.getState().setRunStatus(runId, "error", true);
        }
      });
    return runId;
  },

  /** Approve or reject a gated tool call, or answer the agent's question. */
  async resolve(runId: string, callId: string, approved: boolean, input?: string): Promise<void> {
    const run = useAgentStore.getState().runs[runId];
    if (!run?.serverRunId) throw new Error("The run has no server id yet.");
    await resolveAgentApproval(run.serverRunId, callId, { approved, input });
  },

  stop(runId: string): void {
    const run = useAgentStore.getState().runs[runId];
    // Ask the server to end the loop cleanly; closing the stream also aborts it.
    if (run?.serverRunId) void stopAgentRun(run.serverRunId);
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

  /** Drops every run (not the workspace). */
  resetRuns(): void {
    for (const h of handles.values()) {
      h.abort.abort();
      h.controller.dispose();
      h.bus.clear();
    }
    handles.clear();
    useAgentStore.getState().clearRuns();
  },
};
