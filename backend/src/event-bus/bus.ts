import { Topic, PayloadOf } from './topics';
import { Subscriber, Unsubscribe } from './types';

/**
 * One registration. Wrapping the handler in a fresh object per `subscribe`
 * call gives each registration a stable identity, so unsubscribing the
 * specific call site works correctly even when the same handler function
 * is subscribed multiple times.
 */
type Entry = { handler: (payload: unknown) => void };

export class EventBus {
  private readonly subs = new Map<Topic, Entry[]>();
  private closed = false;

  publish<T extends Topic>(topic: T, payload: PayloadOf<T>): void {
    if (this.closed) return;
    const list = this.subs.get(topic);
    if (!list || list.length === 0) return;

    // Snapshot at publish time. Per event-bus.md:
    //   - Subscribers added after publish are NOT invoked for this publish.
    //   - Subscribers unsubscribed between publish and their microtask ARE
    //     still invoked (microtasks cannot be cancelled).
    const snapshot = list.map((e) => e.handler);
    for (const handler of snapshot) {
      queueMicrotask(() => {
        try {
          handler(payload);
        } catch (err) {
          console.error('[bus] subscriber threw', { topic, err });
        }
      });
    }
  }

  subscribe<T extends Topic>(topic: T, handler: Subscriber<T>): Unsubscribe {
    if (this.closed) return () => {};

    let list = this.subs.get(topic);
    if (!list) {
      list = [];
      this.subs.set(topic, list);
    }
    const entry: Entry = { handler: handler as Entry['handler'] };
    list.push(entry);

    return () => {
      const cur = this.subs.get(topic);
      if (!cur) return;
      const idx = cur.indexOf(entry);
      if (idx >= 0) cur.splice(idx, 1);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subs.clear();
  }
}
