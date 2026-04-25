# Spec: Event Bus

## Signature

```ts
type EventBus = {
  publish<T extends Topic>(topic: T, payload: PayloadOf<T>): void;
  subscribe<T extends Topic>(topic: T, handler: (payload: PayloadOf<T>) => void): Unsubscribe;
  close(): void;
};

type Unsubscribe = () => void;
```

The bus is a generic, in-process pub/sub primitive. It has no knowledge of rooms, sockets, or domain events beyond the topic union it carries.

---

## Topics

The topic union is fixed in this iteration. Adding a topic is a spec change.

```ts
type Topic = 'domain.event' | 'room.created' | 'room.destroyed';

type PayloadOf<T extends Topic> =
  T extends 'domain.event'   ? { roomId: string; event: DiagramEvent } :
  T extends 'room.created'   ? { roomId: string; createdAt: number; seedElementCount: number; seedArrowCount: number } :
  T extends 'room.destroyed' ? { roomId: string; destroyedAt: number; reason: 'empty' | 'shutdown' } :
  never;
```

`DiagramEvent` is the existing union from `domain/types.ts`. The bus references it but does not import any other domain logic.

Topic granularity is intentionally coarse — one topic per logical event family. Per-event-type topics (e.g. `domain.element_moved`) are out of scope (see *Out of Scope*).

---

## Dispatch contract

`publish` schedules each subscriber's handler via `queueMicrotask`. The `publish` call itself is synchronous and **never invokes a subscriber inline**.

This is the central guarantee:
- A slow subscriber cannot extend the duration of the `publish` call.
- A throwing subscriber cannot interrupt the publisher's call stack.
- The realtime layer publishes *after* broadcasting and must not be delayed by worker behavior.

`queueMicrotask` (not `setImmediate`) is used so subscribers run as soon as the publisher's call stack unwinds, before the next I/O tick — minimizing latency while still honoring the "never blocks realtime" rule.

---

## Subscriber rules

Subscribers MUST:
- Return quickly. Handlers are invoked synchronously inside their microtask; long synchronous work blocks other microtasks.
- Not throw. The bus catches throws so siblings continue, but a thrown subscriber is a bug, not normal control flow.
- Be tolerant of being called multiple times for distinct logical events with the same content (the bus itself does not deduplicate).

Subscribers MAY:
- Schedule their own async work via `Promise.resolve().then(...)`, `setImmediate`, or `setTimeout`. The bus does not await this.
- Subscribe to multiple topics with the same handler (each subscription is independent).

The handler signature is **synchronous** (`(payload) => void`). Async handlers (`Promise<void>`) are out of scope (see *Out of Scope*).

---

## Behaviors

### publish

**Behavior:** Take a snapshot of the subscribers registered for `topic` at the time of the call. For each, schedule a microtask that invokes the handler with `payload`. Return synchronously.

| Scenario | Result |
|---|---|
| No subscribers for the topic | No-op. Returns synchronously. |
| Subscriber throws | Caught; logged via `console.error('[bus] subscriber threw', { topic, err })`; sibling subscribers unaffected. |
| Subscriber subscribes during the publish call (before microtasks fire) | Not called for this publish. Snapshot is taken at publish time. |
| Subscriber unsubscribes between publish and its scheduled microtask running | Still called. Microtasks cannot be cancelled. |
| Subscriber publishes another event from inside its handler | Permitted. The new event's microtasks chain naturally after the current microtask queue drains. |
| Bus is closed | No-op. No microtasks scheduled. |

### subscribe

**Behavior:** Register `handler` for `topic`. Return an `Unsubscribe` function that removes only this specific registration.

| Scenario | Result |
|---|---|
| Same handler reference subscribed twice to the same topic | Called twice per `publish` — each registration is independent. |
| One handler subscribed to multiple topics | Each subscription is independent. Unsubscribing one does not affect the others. |
| Unsubscribe called twice | Second call is a no-op. |
| Unsubscribe called from inside the handler itself | Permitted. Affects future publishes only; the current microtask completes normally. |
| Subscribe on a closed bus | Returns a no-op `Unsubscribe`. The handler is never called. |

### close

**Behavior:** Drop all registrations. Make `publish` and `subscribe` no-ops thereafter. Used during graceful shutdown.

| Scenario | Result |
|---|---|
| Microtasks already scheduled at close time | They still run. Scheduled microtasks cannot be cancelled. |
| `publish` after close | No-op. Returns synchronously. |
| `subscribe` after close | Returns a no-op `Unsubscribe`. |
| `close` called twice | Second call is a no-op. |

---

## General Invariants

- **Type safety:** `publish('domain.event', x)` requires `x: PayloadOf<'domain.event'>`. `subscribe<T>` infers the payload type for the handler. Calling `publish` with a topic outside the `Topic` union is a TypeScript error.
- **At-most-once delivery per subscription:** an event is delivered exactly once to each subscriber that was registered at publish time, never retried, never replayed.
- **Invocation order:** within a single `publish` call, subscribers are invoked in registration order. Across `publish` calls, microtasks run in publish-call order.
- **No buffering, no backpressure, no retry:** the bus owns no queue beyond the JS microtask queue. A subscriber that needs buffering implements it internally.
- **No I/O in the bus itself:** the bus does not log domain events, does not persist, does not do network. Workers do those things.
- **Pure module surface:** `EventBus` is a class (or factory) with no module-level singletons. The composition root in `index.ts` constructs and threads the instance.

---

## Out of Scope (MVP)

- Persistence, replay, or event sourcing of past publishes.
- Wildcard or pattern subscriptions (e.g. `'room.*'`).
- Async handler signatures (`(payload) => Promise<void>`) — handlers are synchronous; async work is the subscriber's responsibility.
- Per-subscriber error handlers, dead-letter queues, or retry policies.
- Cross-process or cross-node pub/sub (e.g. Redis, NATS).
- Listener-leak warnings / max-listener caps.
- Priority or ordering controls beyond registration order.
