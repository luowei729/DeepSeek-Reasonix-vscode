import type * as vscode from "vscode";

export type EventListener<T = unknown> = (payload: T) => void | Promise<void>;

/**
 * Tiny in-process event bus. Modules communicate through events instead of
 * importing each other, which keeps new features pluggable and easy to remove.
 */
export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

  on<T>(event: string, listener: EventListener<T>): vscode.Disposable {
    const bucket = this.listeners.get(event) ?? new Set<EventListener>();
    bucket.add(listener as EventListener);
    this.listeners.set(event, bucket);

    return {
      dispose: () => {
        bucket.delete(listener as EventListener);
        if (bucket.size === 0) this.listeners.delete(event);
      },
    };
  }

  async emit<T>(event: string, payload: T): Promise<void> {
    const bucket = this.listeners.get(event);
    if (!bucket) return;

    // Copy listeners first so a listener can safely unsubscribe while events are dispatched.
    for (const listener of [...bucket]) {
      await listener(payload);
    }
  }
}
