# Spec: Connection Lifecycle

This spec defines the state machine that owns the WebSocket connection inside `<RoomView>`: how it transitions between connecting, connected, reconnecting, and terminal states; how reconnect is paced; what conditions force a fresh sync; and what each transition does to the store and the UI.

The **wire-level message contract** (URL resolution, frame encoding, error codes) lives in [`wire-client.md`](wire-client.md). The **store** that the lifecycle hydrates and rolls back lives in [`store.md`](store.md). The **error view** the lifecycle routes to on terminal states lives in [`routing.md`](routing.md). This document is scoped to *what state the connection is in, and what flips that state*.

---

## States

```
                       ┌──────────────┐
                       │  connecting  │◀─────────────┐
                       └──────┬───────┘              │
                              │ onSync               │ backoff timer fires
                              ▼                      │
                       ┌──────────────┐              │
              ┌───────▶│  connected   │──┐           │
              │        └──────┬───────┘  │           │
              │               │          │ ack       │
              │               │ onClose  │ timeout   │
              │ onSync        │ (retry)  │           │
              │               ▼          ▼           │
              │        ┌──────────────────────┐      │
              └────────│    reconnecting      │──────┘
                       └──────────┬───────────┘
                                  │ max attempts exceeded
                                  │ OR terminal close code
                                  ▼
                       ┌─────────────────────────────┐
                       │  disconnected_terminal      │
                       │  (rendered as error view)   │
                       └─────────────────────────────┘
```

| State | Meaning |
|---|---|
| `connecting` | A socket has been opened and `join` has been sent; we are waiting for the first `sync`. UI shows a spinner over the canvas; toolbar disabled. |
| `connected` | `sync` arrived; the store is hydrated; the user can interact. UI shows the connected badge (green dot). |
| `reconnecting` | A previous `connected` (or `connecting`) state ended with a retryable close. A backoff timer is running; when it fires, transition to `connecting` and open a new socket. UI shows a yellow banner "Reconnecting…"; canvas interaction disabled. |
| `disconnected_terminal` | Reconnect is not attempted. UI renders the error view with the appropriate `kind`. |

The four states are exhaustive. There is no separate "idle" or "ready-to-join" — the lifecycle controller is mounted by `<RoomView>` and starts in `connecting` immediately.

---

## State variables

The lifecycle controller owns a small struct stored in a single Zustand slice (see [`store.md`](store.md) §"Connection slice"):

```ts
type ConnectionStatus =
  | { kind: "connecting"; attempt: number }
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number; retryAt: number }
  | { kind: "disconnected_terminal"; reason: TerminalReason };

type TerminalReason =
  | "not_found"
  | "room_destroyed"
  | "server_shutdown"
  | "client_bug"
  | "max_retries"
  | "network";
```

- `attempt` is 0-indexed. The first connection is `attempt: 0`. Each fresh socket open after a retryable failure increments it.
- `retryAt` is `Date.now() + currentBackoffMs` — the absolute time the backoff timer is expected to fire. Stored so the UI can render a countdown if it wants (the MVP banner does not, but the data is exposed for future use).
- `reason` on `disconnected_terminal` maps to the error view `kind` (see [`routing.md`](routing.md) §"Error view → kinds") via a 1:1 lookup.

---

## Reconnect schedule

Backoff sequence in milliseconds: `1000, 2000, 4000, 8000, 16000, 30000`. Capped at 30 s.

```ts
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_ATTEMPTS = 5;

function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}
```

- `attempt: 0` is the initial connect — no backoff, no wait.
- After a retryable failure at `attempt: N`, schedule the next attempt at `now + backoffFor(N)`.
- If `attempt` would exceed `MAX_ATTEMPTS - 1 = 4`, transition to `disconnected_terminal` with `reason: "max_retries"`. Five attempts in total: 0 (initial) plus 4 retries.

The actual timer is a single `setTimeout` keyed off `retryAt`. On any state transition that exits `reconnecting` (manual close, navigation away), the timer is cleared.

---

## Transitions

### 1. Mount

**Trigger:** `<RoomView>` mounts with a non-null `roomId`.

**Effect:**
1. Read `userId` from the store (mint via `crypto.randomUUID()` and persist to `localStorage` if absent — see [`store.md`](store.md) §"Identity").
2. Call `wire.connect(roomId, userId, callbacks)`.
3. Set status `{ kind: "connecting", attempt: 0 }`.

### 2. `onSync`

**Trigger:** Wire client dispatches `onSync({ roomId, state })`.

**Effect:**
1. Wholesale-replace the store's `DiagramState` slice with `{ elements: state.elements, arrows: state.arrows, processedEventIds: {} }`.
2. Clear `pendingEvents` (any unacked events from a prior connection are abandoned; the server's authoritative state in `sync` supersedes them).
3. Clear the selection (any selected id from a prior session may no longer exist).
4. Set status `{ kind: "connected" }`.

`sync` arriving from any prior state (connecting, reconnecting, even an unexpected duplicate in connected) follows the same path — the public projection is the source of truth.

### 3. `onPeerEvent`

**Trigger:** Wire client dispatches `onPeerEvent(event)`.

**Effect:**
1. Forward to the store's peer-event merge handler (see [`store.md`](store.md) §"Peer event merge").

Does not change connection status.

### 4. `onAck`

**Trigger:** Wire client dispatches `onAck(eventId, status)`.

**Effect:**
1. Forward to the store. The store drops `eventId` from `pendingEvents` and, on `status === "rejected"`, runs the rollback (see [`store.md`](store.md) §"Rollback table").
2. Clear the per-event ack-timeout timer (see §"Ack timeout" below).

Does not change connection status.

### 5. `onError`

**Trigger:** Wire client dispatches `onError({ code, eventId? })`.

**Effect:** Look up `code` in the table from [`wire-client.md`](wire-client.md) §"Error code handling":

| Frontend action | Lifecycle effect |
|---|---|
| Run per-event rollback (`invalid_event`) | None — connection stays open. |
| Log only (`unknown_message`) | None. |
| Treat as client bug (`bad_json`, `must_join_first`, `already_joined`, `invalid_join`) | Wait for the close frame the backend will send; on `onClose`, transition to `disconnected_terminal` with `reason: "client_bug"`. |

The wire client does **not** preempt the close; it lets the backend's close frame do the lifecycle transition. This keeps the close-code interpretation in one place (§"6. `onClose`" below).

### 6. `onClose`

**Trigger:** Wire client dispatches `onClose({ code, reason, wasClean })`.

**Effect:** Map `code` to a transition using the table from [`wire-client.md`](wire-client.md) §"Close codes":

| Code class | Transition |
|---|---|
| `1000` (we initiated a clean close) | No transition — controller is unmounting or already terminal. |
| `1001` (server shutdown) | `disconnected_terminal` with `reason: "server_shutdown"`. |
| `1003`, `1009`, `4400`, unknown `4xxx` (client bug or unrecoverable) | `disconnected_terminal` with `reason: "client_bug"`. |
| `4404` (room gone mid-session) | `disconnected_terminal` with `reason: "not_found"`. |
| `4408` (join timeout) on attempt 0 | Treat as retryable: schedule a reconnect. On attempt > 0 with `4408`, terminal `reason: "client_bug"` (we should have sent `join` instantly). |
| `1006`, `1011`, other transient | Schedule a reconnect (see §"Scheduling a reconnect" below). |

### 7. `onRoomDestroyed`

**Trigger:** Wire client dispatches `onRoomDestroyed(reason)`.

**Effect:** The backend sends this frame immediately before closing the socket. The frontend pre-stages the terminal reason so the subsequent `onClose` does not interpret it as a transient transient close:

- `reason: "empty"` is treated as `room_destroyed`. (The frontend conceptually distinguishes this from `shutdown`; the backend treats them similarly.)
- `reason: "shutdown"` is treated as `server_shutdown`.

The `onClose` handler checks a "pre-staged terminal reason" flag set here and uses it instead of the close-code mapping. After the close, the flag is cleared.

### 8. Scheduling a reconnect

When a retryable close occurs in `connected` or `connecting`:

1. Read current `attempt`; compute `next = attempt + 1`.
2. If `next >= MAX_ATTEMPTS`, transition to `disconnected_terminal` with `reason: "max_retries"`.
3. Otherwise, set status `{ kind: "reconnecting", attempt: next, retryAt: now + backoffFor(attempt) }`.
4. Set a `setTimeout` for `backoffFor(attempt)` ms; on fire, transition to `connecting` by calling `wire.connect(roomId, userId, callbacks)` and updating status.

Note: `attempt` in the new `connecting` state is the same as the `reconnecting.attempt` (the increment happened in step 2). The `attempt` counter is monotonically increasing across all reconnect cycles within a single mount.

### 9. Unmount

**Trigger:** `<RoomView>` unmounts (route change, browser navigation away).

**Effect:**
1. Clear any pending backoff timer.
2. Clear any pending ack-timeout timers.
3. Call `wire.close(1000)` if a socket is open. Discard subsequent callbacks.
4. Do not update store status — the view is gone, the store is also being reset by the new view (`<HomeView>` clears it, `<NotFoundView>` ignores it).

---

## Ack timeout

The wire spec allows `event` messages to receive an `ack` of `applied`, `duplicate`, or `rejected`. The frontend assumes every well-formed `event` will receive an `ack`. If it does not within a bounded window, the frontend assumes silent drift and forces a fresh sync.

| Constant | Value | Effect |
|---|---|---|
| `ACK_TIMEOUT_MS` | `10_000` | Per-event budget for the server to ack. |

### Mechanism

When the store records a new pending event, it returns the `eventId` to the lifecycle controller, which sets a `setTimeout` for `ACK_TIMEOUT_MS`. On `onAck` for that id, the timer is cleared. If the timer fires:

1. Log: `console.warn('ack timeout for event', eventId)`.
2. Force a reconnect by calling `wire.close(1000)`. The `onClose` handler observes `1000` from a controller-initiated close and proceeds *not* to a terminal state but to the reconnecting state with the current `attempt` preserved (this is the only path where a `1000` close triggers a reconnect; the close was initiated by the controller for diagnostic reasons, not by the user).
3. The reconnect path triggers a fresh `sync` which wholesale-replaces state and clears `pendingEvents`, recovering from whatever drift occurred.

Implementation: the controller distinguishes "user-initiated close" (true 1000) from "ack-timeout close" via an internal flag set just before calling `wire.close`. The flag overrides the default `1000 → no transition` rule for that single close event.

### Why force a reconnect rather than retry the event

The event might have been applied server-side and the broadcast lost, or the event was rejected and the ack was lost, or any number of intermediate states. The cheap correct recovery is to ask the server "what is the truth?" — that is `sync`. Per-event retry would risk applying the event twice on the server (the second would be `duplicate` thanks to `processedEventIds`, but the local rollback logic does not need to deal with the partial-success case).

---

## Edits blocked during non-`connected`

When `status.kind !== "connected"`, the canvas and toolbar are interactive-disabled:

- The toolbar buttons appear grey/inactive; clicks are no-ops.
- The Konva stage's pointer events are still wired (so hover doesn't crash), but the tool state machine in [`tools-and-gestures.md`](tools-and-gestures.md) refuses to start any gesture.
- An overlay banner is rendered above the canvas: yellow with text "Reconnecting…" during `reconnecting`, and a centred spinner with "Connecting…" during `connecting`.
- The connection badge in the chrome top-right reflects status: green dot ("Connected"), yellow dot ("Reconnecting…"), red dot ("Disconnected" — only briefly before the error view replaces the room view).

No events are queued during disconnects. Pending events that existed at the moment of disconnect remain in `pendingEvents` and are cleared by the next `onSync`.

---

## Terminal triggers

The `disconnected_terminal` state is reached only through the following paths. Once reached, the controller stops processing wire callbacks (other than discarding them) and re-renders `<RoomView>` to swap in `<NotFoundView>` with the matching `kind`. (`<RoomView>` reads `status` from the store and chooses which child to render.)

| Source | `reason` | Error view `kind` |
|---|---|---|
| Close code `1001` | `server_shutdown` | `server_shutdown` |
| Close code `4404` mid-session | `not_found` | `not_found` |
| `room_destroyed { reason: "empty" }` | `room_destroyed` | `room_destroyed` |
| `room_destroyed { reason: "shutdown" }` | `server_shutdown` | `server_shutdown` |
| Close codes `1003`, `1009`, `4400`, unknown `4xxx` | `client_bug` | `create_failed` (with logged code) |
| Close code `4408` on attempt > 0 | `client_bug` | `create_failed` |
| `MAX_ATTEMPTS` exhausted | `max_retries` | `network` |
| `network` (initial connect's `WebSocket` constructor throws or onOpen never fires) | `network` | `network` |

`client_bug` reasons surface as `create_failed` in the UI because the user has no recourse other than to try again — distinguishing "the server didn't like us" from "the create call failed" is not useful to the user. The console logs preserve the technical reason for debugging.

---

## Invariants

- **At most one socket is open per controller instance.** Reconnect always closes the old socket (it's already closed by the time we're in `reconnecting`) and `wire.connect` opens a new one.
- **`pendingEvents` is cleared on every `sync`.** No event from a prior connection survives a fresh sync.
- **`attempt` is monotonic across the controller's lifetime.** It only resets when the controller unmounts and remounts (i.e. a new `<RoomView>` instance).
- **The backoff timer is at most one outstanding `setTimeout`.** Any state transition out of `reconnecting` clears it.
- **A user-initiated close (`handle.close()` on unmount) never transitions to `reconnecting`.** It either lands in terminal-already-set state or unmounts cleanly.
- **An ack-timeout close is the only path where `1000` leads to a reconnect.** That path uses an internal flag to override the close-code interpretation.

---

## Out of scope (MVP)

- A user-facing reconnect indicator with a live countdown. The data (`retryAt`) is exposed but the MVP banner is static text.
- A "Reconnect now" button that bypasses the backoff timer. If added later, it fires the next attempt immediately and resets the backoff index.
- Resuming pending events across a reconnect. MVP discards them; the user re-does the action if it didn't take. A future spec may add a session-resume protocol.
- Different policies for `4408` (join timeout) on initial vs. retry attempts beyond what is documented above.
- Adjusting `ACK_TIMEOUT_MS` based on observed network latency.
- Server-driven backoff (e.g. `Retry-After` header on a WS close). The backoff sequence is fixed in the client.
- Reconnect attempts that change `userId` (e.g. on `invalid_join`). The userId stays stable per browser; an `invalid_join` is a client bug, not a recoverable state.
