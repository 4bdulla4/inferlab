// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The STOP bug: STOP and ANALYZE shared one <button>. Stopping re-rendered it
 * as the submit button while a real mouse click was still being handled, so
 * the browser submitted the form and a new scan started. A scripted click in a
 * test cannot replay that timing (the browser only updates mid-click for real
 * input), so these tests pin the two things that prevent it: the stop click
 * cancels its default action, and the stop and start buttons are never the
 * same element.
 */

// Runs never finish in these tests; the point is what the stop click does.
const analyzeRepo = vi.fn((..._args: unknown[]) => new Promise<never>(() => {}));
vi.mock("@/api/repoClient", () => ({ analyzeRepo: (...args: unknown[]) => analyzeRepo(...args) }));

const { RepoInput } = await import("./RepoInput");
const { useRepoStore } = await import("@/store/repoStore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  analyzeRepo.mockClear();
  useRepoStore.getState().reset();
  useRepoStore.getState().setUrl("https://github.com/acme/shop");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("GitHub Analyzer STOP", () => {
  it("cancels the scan, cancels the click's default action, and never turns into the submit button", async () => {
    await act(async () => root.render(<RepoInput />));
    await act(async () => button("ANALYZE")!.click());
    expect(analyzeRepo).toHaveBeenCalledTimes(1);

    const stop = button("STOP")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => void stop.dispatchEvent(click));

    expect(click.defaultPrevented).toBe(true);
    const analyze = button("ANALYZE")!;
    expect(analyze).toBeDefined();
    expect(analyze).not.toBe(stop);
    expect(stop.isConnected).toBe(false);

    expect(useRepoStore.getState().status).toBe("error");
    expect(useRepoStore.getState().error).toBe("Analysis cancelled.");
    expect((analyzeRepo.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
    expect(analyzeRepo).toHaveBeenCalledTimes(1);
  });
});

describe("Investigator 'Stop the agent'", () => {
  it("stops the run without its click starting a new investigation", async () => {
    const stopRun = vi.fn();
    const investigate = vi.fn();
    vi.doMock("@/engine/agent/agentRuntime", () => ({ agentRuntime: { stop: stopRun, investigate, refreshStatus: vi.fn(async () => {}) } }));
    vi.resetModules();
    const { QuestionPanel } = await import("./QuestionPanel");
    const { useRepoStore: repo } = await import("@/store/repoStore");
    const { useAgentStore } = await import("@/store/agentStore");
    const { createAgentRun } = await import("@/labs/agent/state");
    const { DEFAULT_AGENT_CONFIG } = await import("@shared/agent");

    const analysis = { id: "a1", meta: { fullName: "acme/shop", sha: "abc", htmlUrl: "https://github.com/acme/shop", isPrivate: false }, ai: { available: false, note: "" }, graph: { nodes: [], edges: [] }, files: [] };
    repo.setState({ analysis: analysis as never, status: "ready", askMode: "investigate", question: "How does login work?" });
    const run = createAgentRun({ id: "run-1", goal: "How does login work?", config: DEFAULT_AGENT_CONFIG, scenarioId: null });
    useAgentStore.setState({ runs: { "run-1": run }, status: { providers: [], tools: [], scenarios: [], limits: {} } as never });
    repo.getState().setInvestigation({ runId: "run-1", analysisId: "a1", question: "How does login work?", provider: "mock", startedAt: 0 });

    await act(async () => root.render(<QuestionPanel />));
    const stop = button("Stop the agent")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      stop.dispatchEvent(click);
      // The runtime marks the run stopped, which swaps the button back to Investigate.
      useAgentStore.getState().setRunStatus("run-1", "stopped", true);
    });

    expect(stopRun).toHaveBeenCalledWith("run-1");
    expect(click.defaultPrevented).toBe(true);
    const again = button("Investigate")!;
    expect(again).toBeDefined();
    expect(again).not.toBe(stop);
    expect(investigate).not.toHaveBeenCalled();
    vi.doUnmock("@/engine/agent/agentRuntime");
  });
});
