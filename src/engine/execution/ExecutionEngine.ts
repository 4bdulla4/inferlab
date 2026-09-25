import type { ChatRequestBody, GenerationSettings, ProviderDescriptor, ServerEvent } from "@shared/llm";
import type { RunStatus } from "@/types/execution";
import { streamChat } from "@/api/llmClient";
import type { EventBus } from "@/engine/events/EventBus";
import type { AnyLLMEvent } from "@/labs/llm/events";
import { LLMEventSequencer } from "@/labs/llm/sequencer";

export interface ExecutionEngineOptions {
  runId: string;
  provider: ProviderDescriptor;
  input: string;
  settings: GenerationSettings;
  bus: EventBus<AnyLLMEvent>;
  onLiveDone: (status: RunStatus) => void;
}

/**
 * Owns one real execution: opens the streaming request, converts every live
 * server event into execution events (interleaving simulation stages via the
 * sequencer) and publishes them on the event bus. It never waits for the
 * visualizer — playback is a separate system.
 */
export class ExecutionEngine {
  private readonly abort = new AbortController();
  private readonly sequencer: LLMEventSequencer;
  private finished = false;
  private sawTerminal = false;

  constructor(private readonly options: ExecutionEngineOptions) {
    this.sequencer = new LLMEventSequencer(options.runId, options.input, options.provider);
  }

  start(): void {
    const { bus, provider, input, settings } = this.options;
    bus.emitAll(this.sequencer.begin());

    const body: ChatRequestBody = { provider: provider.id, message: input, settings };
    streamChat(body, (ev) => this.handleServerEvent(ev), this.abort.signal)
      .then(() => {
        if (this.finished) return;
        if (!this.sawTerminal) {
          bus.emitAll(this.sequencer.failed("The stream ended before the provider reported completion.", undefined, "stream_ended", true));
          this.finish("error");
        } else {
          this.finish(this.terminalStatus);
        }
      })
      .catch((err: unknown) => {
        if (this.finished) return;
        if (this.abort.signal.aborted) {
          bus.emitAll(this.sequencer.stopped());
          this.finish("stopped");
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number }).status;
        bus.emitAll(this.sequencer.failed(message, status, undefined, true));
        this.finish("error");
      });
  }

  stop(): void {
    if (this.finished) return;
    this.abort.abort();
  }

  private terminalStatus: RunStatus = "completed";

  private handleServerEvent(ev: ServerEvent): void {
    if (this.finished) return;
    if (ev.type === "completed") {
      this.sawTerminal = true;
      this.terminalStatus = "completed";
    } else if (ev.type === "error") {
      this.sawTerminal = true;
      this.terminalStatus = "error";
    }
    this.options.bus.emitAll(this.sequencer.fromServer(ev));
  }

  private finish(status: RunStatus): void {
    if (this.finished) return;
    this.finished = true;
    this.options.onLiveDone(status);
  }
}
