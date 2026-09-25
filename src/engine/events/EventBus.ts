import type { ExecutionEvent } from "@/types/execution";

export type EventListener<E extends ExecutionEvent = ExecutionEvent> = (event: E) => void;

/**
 * Tiny synchronous pub/sub used to fan execution events out to sinks
 * (store, logging, future devtools). Labs share this bus; the event `type`
 * and `stage` vocabularies are lab-specific.
 */
export class EventBus<E extends ExecutionEvent = ExecutionEvent> {
  private listeners = new Map<string, Set<EventListener<E>>>();

  on(type: E["type"] | "*", listener: EventListener<E>): () => void {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener);
    return () => this.listeners.get(key)?.delete(listener);
  }

  emit(event: E): void {
    this.listeners.get(event.type)?.forEach((l) => l(event));
    this.listeners.get("*")?.forEach((l) => l(event));
  }

  emitAll(events: readonly E[]): void {
    for (const e of events) this.emit(e);
  }

  clear(): void {
    this.listeners.clear();
  }
}
