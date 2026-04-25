# Spec: Room Lifecycle

A room is the unit of collaboration in FluxBoard. This spec describes a single room's journey from creation to destruction: the phases it passes through, the events that drive transitions, and the invariants that hold within and across phases.

Wire-level message shapes are defined in [`wire-protocol.md`](wire-protocol.md). State transformation rules are in [`apply-event.md`](apply-event.md). The bookkeeping that owns the set of all rooms is in [`room-registry.md`](room-registry.md). This spec is the source of truth for everything that happens *to a single room over time*.

---

## Room state

```ts
type Room = {
  id: string;                                    // 8-char URL-safe; assigned at creation
  state: DiagramState;                           // includes processedEventIds (internal)
  clients: Map<ConnectionId, ClientHandle>;     // ConnectionId is locally generated
  createdAt: number;                             // unix ms at creation
  lastEmptyAt: number | null;                    // null when occupied; set when last client leaves
  destroyTimer: NodeJS.Timeout | null;           // grace-period timer; null when occupied or already destroyed
};

type ClientHandle = {
  connectionId: ConnectionId;
  userId: string;                                // bound at join
  send: (msg: ServerMessage) => void;            // serialize + write to socket
};
```

`ConnectionId` is implementation-internal: it never crosses the wire and is not part of any spec contract beyond "uniquely identifies a single WebSocket connection within this process." Its concrete type and generation strategy are left to `realtime/connection.ts`.

`processedEventIds` is the same map already used by `applyEvent` for idempotency. It doubles as the per-room dedupe set; no separate structure is introduced.

---

## Phases

```
   ┌─────────┐  create   ┌────────┐  first join  ┌────────┐
   │  (none) │──────────▶│seeded  │─────────────▶│ active │
   └─────────┘           └────────┘              └────────┘
                              │                       │
                              │ no client joins ever  │ last client disconnects
                              │ (still seeded, but    │
                              │  never visited)       ▼
                              │                  ┌─────────┐  reconnect within grace
                              │                  │  empty  │─────────────────────────▶ active
                              │                  └─────────┘
                              │                       │ grace expires
                              ▼                       ▼
                                              ┌─────────────┐
                                              │  destroyed  │
                                              └─────────────┘
```

| Phase | Meaning |
|---|---|
| `seeded` | Room exists in the registry. State is the validated seed. No clients have ever connected. The destroy timer is not running. |
| `active` | At least one client is connected. `lastEmptyAt = null`, `destroyTimer = null`. Edits flow. |
| `empty` | All clients have disconnected. `lastEmptyAt` is set, `destroyTimer` is running. The room still exists; a reconnect within `GRACE_PERIOD_MS` returns it to `active`. |
| `destroyed` | Removed from the registry. All references should drop. `destroyRoom` is the only entry point to this phase. |

`seeded` and `empty` are observably similar (no clients, state held in memory) but distinguished because `empty` has a running destroy timer and `seeded` does not. A room that is created and never joined remains in `seeded` indefinitely — there is no timeout for "first join". This is intentional: the room URL may be shared asynchronously, and the creator may not be the first to join.

---

## Transitions

### Creation

**Trigger:** `POST /rooms` with a valid seed (validation rules in [`wire-protocol.md`](wire-protocol.md)).

**Effect:**
1. Registry generates an 8-char URL-safe id (rules in [`room-registry.md`](room-registry.md)).
2. Construct `Room` with:
   - `state = { elements: seed.elements, arrows: seed.arrows, processedEventIds: {} }`
   - `clients = new Map()`
   - `createdAt = Date.now()`
   - `lastEmptyAt = null`
   - `destroyTimer = null`
3. Insert into the registry.
4. Publish `room.created` to the event bus with `{ roomId, createdAt, seedElementCount, seedArrowCount }`.
5. HTTP responds `201 { roomId }`.

The room enters phase `seeded`. It is immediately joinable.

The seed is loaded directly into `state`, **not** replayed as `ElementCreated` / `ArrowCreated` events. Synthesizing event ids server-side would pollute `processedEventIds` and confuse workers consuming `domain.event`.

### First join (and every subsequent join)

**Trigger:** WebSocket upgrade succeeds for `/ws/:roomId`, followed by a well-formed `{ type: "join", userId }` message.

**Effect:**
1. Allocate a fresh `ConnectionId` (locally unique within the process).
2. Construct `ClientHandle { connectionId, userId, send }`.
3. **Cancel any running destroy timer** (`clearTimeout(destroyTimer); destroyTimer = null`) and clear `lastEmptyAt`. This MUST happen before any `await` or yielded boundary in the join handler.
4. Insert handle into `room.clients`.
5. Send `{ type: "sync", roomId, state: snapshot() }` to the joining client. `snapshot()` returns the public projection (see *Public projection* below).

If this is the first join, the room transitions `seeded → active`. If the room was `empty`, it transitions `empty → active`.

The `userId` is bound to this connection for its entire lifetime. Subsequent `event` messages from this connection are stamped with this `userId` regardless of what the client puts in `event.userId` (see [`wire-protocol.md`](wire-protocol.md)).

### Edit (live)

**Trigger:** A connected client sends `{ type: "event", event }`.

**Effect:** Detailed in [`realtime-broadcast.md`](realtime-broadcast.md). In short: server re-stamps, calls `applyEvent`, broadcasts to peers (skip-sender), acks the sender, and publishes `domain.event` to the bus when (and only when) the event was actually applied.

This transition does not change the phase — the room remains `active`.

### Disconnect

**Trigger:** Socket close (any cause: client-initiated, heartbeat timeout, server-initiated terminate).

**Effect:**
1. Remove handle from `room.clients` by `connectionId`.
2. If `room.clients.size === 0`:
   - Set `lastEmptyAt = Date.now()`.
   - Schedule `destroyTimer = setTimeout(() => registry.destroyRoom(id, 'empty'), GRACE_PERIOD_MS)`.
   - Phase: `active → empty`.
3. Otherwise, phase remains `active`.

The cleanup function bound to `socket.on('close')` is the single seam through which a client leaves a room. Heartbeat termination, protocol-error closes, and graceful client closes all funnel through it.

### Reconnect within grace period

A reconnect is just a new connection; there is no protocol-level "resume" mechanism. The new connection performs the standard upgrade + `join` handshake. The grace-period cancellation in step 3 of *Join* is what restores the room to `active`.

If the same client retries an event with the same `event.id` after reconnecting, [`apply-event.md`](apply-event.md)'s idempotency rule ensures it is a no-op and the sender receives `ack { status: "duplicate" }`.

### Grace expiry

**Trigger:** `destroyTimer` fires after `GRACE_PERIOD_MS` (default `30_000`) of continuous emptiness.

**Effect:** The timer callback calls `registry.destroyRoom(id, 'empty')`.

`destroyRoom` re-checks `room.clients.size === 0` synchronously. If a client slipped in between the timer firing and the callback running (only possible if the join handler did not properly cancel the timer — see *Edge case: grace race* below), the destroy is aborted and the room remains `active`.

### Destruction

**Trigger:** `registry.destroyRoom(id, reason)` is called. There are two reasons:

| `reason` | When |
|---|---|
| `"empty"` | Grace timer expired with no clients connected. |
| `"shutdown"` | Process is shutting down (`SIGINT` / `SIGTERM`). |

**Effect:**
1. Re-check: if `room.clients.size > 0` and `reason === 'empty'`, abort. (For `'shutdown'`, proceed regardless — see step 2.)
2. For each remaining handle, send `{ type: "room_destroyed", reason }` and close the socket with code `1001` (going away). On `'empty'`, this should be a no-op; on `'shutdown'`, it notifies still-connected clients before tearing down.
3. Clear `destroyTimer` if set.
4. Delete the room from the registry.
5. Publish `room.destroyed` to the event bus with `{ roomId, destroyedAt: Date.now(), reason }`.

`destroyRoom` is **idempotent**: if the id is already absent from the registry, it returns without effect. The function MUST NOT throw — broadcast and close steps are wrapped in try/catch internally so that a bad socket does not prevent the registry deletion.

After destruction, future upgrades to `/ws/:roomId` are rejected with HTTP 404 at the upgrade phase (see [`wire-protocol.md`](wire-protocol.md)).

---

## Public projection

The room's `DiagramState` includes `processedEventIds`, which is internal. The public projection returned by `snapshot()` and embedded in `sync` messages is:

```ts
{ elements: Record<string, Element>, arrows: Record<string, Arrow> }
```

`processedEventIds` never crosses the wire. Clients have no use for it.

---

## Timing

| Constant | Default | Source | Effect |
|---|---|---|---|
| `GRACE_PERIOD_MS` | `30000` | env | How long an empty room is held before destruction. |
| `JOIN_TIMEOUT_MS` | `5000` | env | How long the server waits for `join` after a successful upgrade before closing the socket. |
| `WS_HEARTBEAT_MS` | `30000` | env | Heartbeat interval; double the value is the effective dead-socket detection window. |

The grace period is a single `setTimeout` per room — not a polling sweeper. Joining clears it via `clearTimeout`; this is O(1) and avoids a global scan.

---

## Edge cases

### Grace-period race

A reconnect can arrive between the destroy timer firing (callback queued on the event loop) and the callback actually running. Three rules close the gap:

1. The join handler MUST `clearTimeout(destroyTimer)` and set `destroyTimer = null` *synchronously* before any await or callback boundary.
2. `destroyRoom('empty', ...)` MUST re-check `room.clients.size === 0` synchronously at the top.
3. Both code paths run on the single event loop, so if the join handler ran first it has already cleared the timer (the queued callback is a no-op against a timer handle that no longer exists, and the registry's lookup will find nothing or find a populated room).

If `destroyRoom` runs first and clears the room, an upgrade arriving for that id immediately afterward is rejected with HTTP 404. The client gets a clean failure, not a half-destroyed room.

### `destroyRoom` idempotency and safety

`destroyRoom` is called from at least two places: the grace timer callback and the shutdown sweep. It MUST tolerate:

- The room id being absent from the registry (already destroyed).
- A handle's `send` throwing (closed socket, write-after-end).
- A handle's underlying socket being already closed.

Implementation MUST wrap broadcast and close in try/catch so a single bad socket does not prevent the room from being removed from the registry. A leaked entry in the registry is the worst failure mode.

### Empty room created and never joined

A room created via `POST /rooms` but never joined remains in `seeded` indefinitely. This is intentional. The creator may share the URL asynchronously; the first join may be minutes or hours later.

The cost is bounded: the room holds only the seed payload (capped at 1 MB) plus bookkeeping. There is no long-running timer. Cleanup happens at process restart.

A future spec MAY introduce a "first-join timeout" if memory growth becomes a concern. Out of scope for this iteration.

### Multiple connections from the same userId

Permitted. `userId` is mocked and not unique. Each connection gets its own `ConnectionId`. Two tabs from the same user are two clients.

### Self-published events on reconnect

If a client sends `event` `evt-42`, then disconnects before receiving the `ack`, then reconnects and resends `evt-42`:

- Server's `room.state.processedEventIds['evt-42']` is set.
- `applyEvent` no-ops; the room state is unchanged.
- Server replies `ack { status: "duplicate" }`.
- No broadcast to peers (they already received `evt-42` from the original send).

This works as long as the room has not been destroyed in between. If the room was destroyed (grace expired) and recreated, the new room has a different `roomId` and `processedEventIds = {}`; the resend would be applied as a fresh event. This is acceptable: a destroyed room is a different conversation.

---

## Invariants

- **`destroyTimer` and `clients.size > 0` are mutually exclusive.** When clients are connected, the timer must be `null`. When the timer is set, `clients` must be empty.
- **`lastEmptyAt` is set if and only if the room is in phase `empty`.** Joining clears it; destroying drops the field with the room.
- **`createdAt`, `id`, and `state.elements`/`state.arrows`/`state.processedEventIds` are the only fields workers care about.** `clients` and timer state are realtime-internal and never published to the bus.
- **No room exists in the registry without a corresponding `room.created` having been published.** Conversely, every `room.destroyed` corresponds to a room that was previously in the registry.
- **`destroyRoom` is the sole removal path.** No other code mutates the registry's map.
- **A connection belongs to exactly one room.** The room id is fixed at upgrade time (URL path) and cannot change. Re-joining a different room requires a new connection.

---

## Out of Scope (MVP)

- Persistence of room state across process restarts. All rooms die with the process.
- Room metadata: titles, descriptions, owner, ACLs, expiration policies.
- Limits on the number of concurrent rooms or clients per room.
- Reconnection tokens / session resumption protocol. A dropped socket is a dropped session.
- Read-only / observer roles.
- Snapshot compression for large `sync` payloads.
- "First-join timeout" for `seeded` rooms that are never visited.
