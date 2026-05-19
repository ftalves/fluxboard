# Spec: Realtime Broadcast

This spec describes what happens between the moment an `event` message arrives on a WebSocket and the moment its consequences (broadcast, ack, bus publish) settle. It also covers heartbeat behavior at the WebSocket-protocol level and the ordering guarantees the realtime layer provides to clients.

Wire message shapes are in [`wire-protocol.md`](wire-protocol.md). State transformation rules are in [`apply-event.md`](apply-event.md). Per-room state machine is in [`room-lifecycle.md`](room-lifecycle.md). Bus dispatch contract is in [`event-bus.md`](event-bus.md).

---

## Event flow

When a client message `{ type: "event", event }` is received on a connection that is in `joined` state and has passed schema validation:

1. **Re-stamp.** Overwrite `event.timestamp` with `Date.now()` and `event.userId` with the connection's bound `userId`. `event.id`, `event.type`, and `event.payload` are preserved.
2. **Check for duplicate.** If `room.state.processedEventIds[event.id] === true`, classify as **duplicate**. Skip steps 3–5 and 7; proceed directly to step 6 (ack).
3. **Apply.** Compute `nextState = applyEvent(room.state, event)`.
4. **Classify and commit.**
   - Compare `nextState.elements` to `room.state.elements`, and `nextState.arrows` to `room.state.arrows`.
   - If **either** reference changed — **applied**. The event produced a visible state change.
   - Else — **rejected**. `applyEvent` no-op'd for a semantic reason (e.g. `ElementMoved` of an unknown id, `ArrowCreated` to a missing element). The visible state (elements, arrows) is unchanged, but `processedEventIds` has the event id added.
   - In **both** cases, set `room.state = nextState`. The commit is required even for rejections so that a retry of the same `event.id` is later detected as a *duplicate* in step 2 and not re-evaluated.
5. **Broadcast** (only for *applied*). Send `{ type: "event", event }` to every client in the room **except the sender**. The broadcast event carries the server-stamped `timestamp` and `userId`.
6. **Ack the sender.** Send `{ type: "ack", eventId: event.id, status }` where `status` is `"applied" | "duplicate" | "rejected"`.
7. **Publish to bus** (only for *applied*). `bus.publish('domain.event', { roomId, event })`. *Duplicate* and *rejected* outcomes are not published.

Steps 1–6 are synchronous from the perspective of the connection's message handler. Step 7 returns synchronously (the bus dispatches via microtask) but its subscribers run asynchronously per [`event-bus.md`](event-bus.md).

### Why this ordering

The duplicate check at step 2 is logically prior: a known-duplicate event has no semantic content to evaluate. `applyEvent` would short-circuit at its own internal idempotency check anyway, but checking at the realtime layer first avoids the wasted call and produces a cleaner classification.

After step 2, `applyEvent` has only two possible outcomes:
- `nextState.elements` or `nextState.arrows` is a new reference → the event produced a visible state change → *applied*.
- Both are the same reference as before → only `processedEventIds` was extended → *rejected* (semantic rule violation).

Reference equality on `elements` and `arrows` is the cheapest "did anything visible happen?" check and matches the immutability pattern used throughout the domain layer. We cannot use reference equality on the whole `nextState` because `applyEvent` always returns a new state object (even on rejected paths, to record the event id in `processedEventIds`).

`applyEvent` retains its own idempotency check by design (see [`apply-event.md`](apply-event.md)) — the domain layer is the source of truth for correctness, and any other caller (tests, future replay workers) gets the same guarantee. The realtime layer's pre-check is an optimization and a classification aid, not a replacement.

```
if (state.processedEventIds[event.id]) {
  status = 'duplicate';
} else {
  const next = applyEvent(state, event);
  const applied = next.elements !== state.elements || next.arrows !== state.arrows;
  state = next; // commit in both branches; rejected path retains the new processedEventIds entry
  status = applied ? 'applied' : 'rejected';
}
```

---

## Skip-sender broadcast

The accepted event is sent to every client in the room **except** the connection that submitted it.

**Rationale:**
- The sender already applied the event optimistically when its UI emitted the action. Echoing it back forces an unnecessary state-merge step and a redundant render.
- The sender's `ack` carries enough information (`eventId`, `status`) for the client to confirm the action landed.
- Skip-sender matches the convention used by most optimistic-UI / CRDT systems and avoids a "ghost echo" UX where the sender sees its own action appear twice.

**What "the sender" means precisely:** the `ConnectionId` that submitted this event message. Two tabs from the same `userId` are two senders; an event from tab A is broadcast to tab B (it is not the originating connection).

**`send` failures during broadcast:** if a per-client `send` throws (closed socket mid-broadcast), it is caught and logged. The broadcast continues for the remaining clients. The failing client will be removed from the room when its `close` handler runs.

---

## Ack semantics

Every well-formed `event` message produces exactly one `ack` to the sender, regardless of outcome.

| `status` | Meaning | Sender contract |
|---|---|---|
| `applied` | Event was applied to room state and broadcast to peers. | Treat the optimistic update as confirmed. |
| `duplicate` | `event.id` was in `processedEventIds`. State unchanged, no broadcast. | Treat identically to `applied`. The server already saw this event before; the original send succeeded even if the client never received that confirmation. |
| `rejected` | `applyEvent` no-op'd for a semantic rule (missing target, dangling reference, etc.). State unchanged, no broadcast. | The client's optimistic state may have drifted from the server's. Recovery is the client's concern — typically reverting the optimistic update or requesting a fresh `sync` via reconnect. |

**`applied` and `duplicate` are functionally equivalent for the client.** The distinction exists for diagnostics: if a client repeatedly sees `duplicate` for events it believes are fresh, the client is buggy (id collisions, replay logic).

**`rejected` is rare in practice** — clients with correct optimistic-UI logic do not produce events that violate `applyEvent` rules. When it happens, it usually indicates a stale local state (e.g. the user dragged an arrow onto an element that was deleted in another tab before the local UI received the broadcast).

The ack is sent **before** the bus publish (step 6 before step 7). This ordering ensures the sender hears back regardless of bus subscriber behavior.

---

## Bus publication policy

The bus receives a `domain.event` only when the event was *applied*. *Duplicate* and *rejected* outcomes are not published.

**Rationale:** the bus represents "things that happened to room state." A duplicate event already produced a publish on its first acceptance; publishing again would inflate event counts in any worker that tallies them. A rejected event never altered state at all.

If a future worker needs visibility into rejected attempts (e.g. for client-bug telemetry), that is a new topic — `realtime.event_rejected` or similar — added in a future spec change. Out of scope for this iteration.

---

## Ordering guarantees

### Within a single connection

Events from one connection are delivered to the room's broadcast in the order they arrive on that connection's TCP stream. The realtime layer processes one message at a time per connection (the `ws` library guarantees in-order frame delivery, and the message handler is synchronous through step 6 above).

### Within a single room

Events from different connections are interleaved in the order their messages are dequeued by the Node event loop. There is no per-room serialization queue beyond the natural single-threadedness of the event loop.

This produces a deterministic outcome from the **server's** perspective — at any moment, `room.state` reflects exactly the events the server has chosen to apply, in the order it applied them. Clients receive broadcasts in that same order.

From any **client's** perspective, the relative ordering of its own events vs peers' events is *not* guaranteed to match its optimistic-UI ordering. Two clients moving the same element concurrently produce a last-write-wins outcome that one or both will see as a "snap" when the broadcasts arrive. This is the intentional consequence of last-write-wins (see CLAUDE.md's locked-in tradeoffs); CRDT/OT machinery is out of scope.

### Across rooms

Strictly independent. The realtime layer makes no cross-room ordering claims.

### Bus publication order vs broadcast order

For *applied* events within a room, `bus.publish('domain.event', ...)` is called in the same order broadcasts go out. Bus subscribers therefore see events in broadcast order per room. (Subscribers see microtask-deferred delivery; see [`event-bus.md`](event-bus.md).)

---

## Heartbeat

Heartbeat operates at the WebSocket-protocol level (ping / pong frames), separate from the application-level `ping` / `pong` JSON messages described in [`wire-protocol.md`](wire-protocol.md).

| Aspect | Behavior |
|---|---|
| Frequency | Every `WS_HEARTBEAT_MS` (default `30_000` ms). One interval per connection, started after the connection enters `joined`. |
| Mechanism | Server calls `ws.ping()`. Client's WS implementation auto-replies with a `pong` frame; no application action needed. |
| Liveness flag | Each connection holds an `isAlive: boolean`. **Initial value: `true`**, set when the connection enters `joined`. On `pong`, reset to `true`. |
| Per-interval check | At the start of each interval, if `isAlive === false`, terminate the connection. Otherwise set `isAlive = false` and send the next `ping`. The next pong (if it arrives in time) flips the flag back. |
| Termination | `ws.terminate()` (not `ws.close()`) — bypasses the closing handshake for an already-unresponsive peer. |
| Effect on room | The `close` handler runs as for any disconnect: client removed, grace timer started if room becomes empty (see [`room-lifecycle.md`](room-lifecycle.md)). |

**Effective dead-socket detection window: 1 × to 2 × `WS_HEARTBEAT_MS`.** A socket that goes silent immediately after a successful pong is detected at the next interval (≈30 s). At default values, this is acceptable for an MVP.

The `awaitingJoin` state has its own join timeout (`JOIN_TIMEOUT_MS`, default `5_000`). Heartbeat does not run before `joined`.

---

## Backpressure and send failures

The realtime layer does not implement application-level backpressure. Each `send` call writes the serialized message to the socket's underlying buffer; the `ws` library handles TCP-level flow control.

**Send-failure handling:**
- A throwing `send` (writing to an already-closed socket) is caught and logged.
- The broadcast loop continues for remaining clients.
- The failing client's `close` handler is responsible for cleanup; the broadcast does not eagerly remove it from the room.

**No buffering of pending events.** If a client's socket becomes slow, `ws.send` will queue internally up to the OS socket buffer. A client that falls catastrophically behind is detected by the heartbeat (no pong → terminate), not by send-queue length.

For the MVP this is sufficient. A future spec MAY add per-client send-buffer caps and explicit slow-client eviction. Out of scope for this iteration.

---

## Broadcast delivery guarantees

The spec relies on transport-level delivery and explicitly omits per-event peer acknowledgement.

**What the server guarantees:**
- Within a single open WebSocket connection, broadcast events are delivered in the order they were applied. TCP and WebSocket together provide ordered, reliable in-stream delivery: a frame either arrives or the connection breaks.
- A silently dead connection is detected within 1× to 2× `WS_HEARTBEAT_MS` via missed pongs, and the socket is terminated.
- A reconnecting client always receives a fresh `sync` reflecting the room's current `DiagramState`.

**What the server does NOT guarantee:**
- That every peer received every broadcast. There is no per-event acknowledgement from peers. If a peer's connection silently fails between the server's `ws.send()` and the bytes reaching them, the missed event is not retransmitted; the server only learns about the failure on the next heartbeat interval.
- That a peer can detect its own staleness without reconnecting. The protocol carries no sequence numbers and no "you missed events" signal from server to client.

**What clients must do:**
- Reconnect on socket close. The new connection's `sync` is the recovery mechanism — any events missed during a disconnect are absorbed into the snapshot.
- Treat each `sync` payload as authoritative; discard any locally optimistic state that conflicts with it.

**Why this is acceptable for MVP:**
- Last-write-wins is the conflict model (see CLAUDE.md). There is no per-event merge math, so a missed event is fully recoverable from the server's current state.
- Rooms are in-memory and short-lived, so the server can always serve "the current state" cheaply.
- `processedEventIds` deduplicates client retries during reconnect.

A future iteration that needs tighter delivery guarantees should consider per-room sequence numbers, client-side gap detection, and a server-initiated resync message; see *Out of Scope* below.

---

## Invariants

- **Exactly one `ack` per well-formed `event` message.** Three statuses, mutually exclusive, total: an event is either *applied*, *duplicate*, or *rejected*.
- **Skip-sender on broadcast.** A connection never receives an `event` message for an event it submitted on that same connection.
- **Bus publish iff applied.** `domain.event` is published exactly when the event produced a state change. *Duplicate* and *rejected* outcomes do not publish.
- **Ordering within a room.** Broadcast order matches `applyEvent` invocation order, which matches message-dequeue order from the event loop.
- **`ack` precedes bus publish.** Step 6 before step 7. The sender's confirmation never depends on bus subscriber behavior.
- **`send` and `close` failures are swallowed and logged.** They never short-circuit a broadcast or cause the connection handler to throw.
- **No application-level backpressure.** The bus, the broadcast, and the per-client `send` are all fire-and-forget; flow control lives in TCP and the heartbeat.

---

## Out of Scope (MVP)

- Per-client send-buffer caps and explicit slow-client eviction.
- Server-driven event reordering or batching.
- Cross-room event ordering or causality.
- Echo-to-sender as an option (sender would have to dedupe via `processedEventIds` on its own copy — adds client complexity for no realtime benefit).
- A `realtime.event_rejected` bus topic for client-drift telemetry.
- Compression of broadcast payloads.
- Application-level backpressure protocol (e.g. `pause` / `resume` from server to slow clients).
- Replay of recent events to late joiners (the `sync` snapshot is sufficient; no event-log delivery).
- Per-event peer acknowledgement. The only `ack` in the protocol is sender-bound; peers receive the broadcast and apply it without confirming back.
- Per-room sequence numbers on broadcast events, and any client-side gap detection that would build on them.
- Server-initiated resync messages ("you missed events; here is the current state"). Recovery from missed broadcasts is by client reconnect, which produces a fresh `sync`.
- Server-side event log buffering for `replay-since-seq` semantics.
