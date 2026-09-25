import type { Response } from "express";
import type { ServerEvent } from "@shared/llm";

/**
 * Minimal Server-Sent Events writer. One JSON payload per `data:` line.
 * A heartbeat comment keeps proxies from closing idle connections while the
 * provider is still thinking. Generic over the event union so every lab's
 * stream is typed; the LLM lab's events are the default.
 */
export class SSEWriter<E extends { type: string } = ServerEvent> {
  private closed = false;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly res: Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    this.heartbeat = setInterval(() => {
      if (!this.closed) this.res.write(": ping\n\n");
    }, 15_000);
    res.on("close", () => this.close());
  }

  send(event: E): void {
    if (this.closed) return;
    this.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.res.write("event: end\ndata: {}\n\n");
    this.close();
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private close(): void {
    this.closed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
