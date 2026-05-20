# Spec: Wire Client

This spec defines the frontend's view of the FluxBoard protocol: how URLs are resolved, how WebSocket frames are encoded and decoded, and which `code` values on `error` frames mean what. It is the counterpart to `backend/specs/wire-protocol.md` on the client side.

The connection's **state machine** — connecting / connected / reconnecting / terminal — and the reconnect policy live in [`connection-lifecycle.md`](connection-lifecycle.md). The **store** that owns optimistic apply, pending-event tracking, and rollback lives in [`store.md`](store.md). This document covers the contract surface: URL resolution, message types in both directions, validation policy, and what each error code does to the lifecycle. It exposes a single module — `frontend/src/net/wire.ts` — that the lifecycle controller consumes.

---

## Backend URL resolution

The frontend never hard-codes a host. It resolves the backend at runtime:

```ts
function backendOrigin(): string {
  const env = import.meta.env.VITE_BACKEND_URL;
  if (env) return env.replace(/\/+$/, "");
  return window.location.origin;
}

function wsOrigin(): string {
  const http = backendOrigin();
  return http.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function roomsUrl():            string { return `${backendOrigin()}/rooms`; }
function wsUrl(roomId: string): string { return `${wsOrigin()}/ws/${encodeURIComponent(roomId)}`; }
```

| Mode | Source of `backendOrigin` | Why |
|---|---|---|
| Dev (Vite) | `window.location.origin` (`http://localhost:5173`) → Vite proxy forwards `/rooms` and `/ws` to `localhost:8080` | Single origin in dev avoids CORS; the proxy in [`workspace-and-build.md`](workspace-and-build.md) §"Frontend bootstrap" handles forwarding. |
| Prod with `VITE_BACKEND_URL` set | `VITE_BACKEND_URL` | Lets the backend live on a different origin from the static frontend. |
| Prod with `VITE_BACKEND_URL` unset | `window.location.origin` | Default for same-origin deployments. |

`encodeURIComponent` on the room id is a defense; backend room ids are 8-char URL-safe so encoding is a no-op in practice. It guards against `:` or `/` ever sneaking in.

---

## HTTP: `POST /rooms`

Used only by `<HomeView>` (see [`routing.md`](routing.md)) to auto-create a fresh room.

### Request

```http
POST /rooms HTTP/1.1
Content-Type: application/json

{"seed":{"elements":{},"arrows":{}}}
```

### Response handling

| Status | Treatment |
|---|---|
| `201` | Parse body as `{ roomId: string }`. Pass to the caller. |
| `400` | Parse as `{ error: "invalid_seed" \| "bad_json", detail?: string }`. Surface to the error view with `kind: "create_failed"`. An empty seed cannot legitimately fail validation, so a 400 here is a server-side bug or version skew. |
| `413` | Same as 400. Empty seed cannot exceed the cap. |
| `415` | Same as 400. The frontend always sets `Content-Type: application/json`, so a 415 means a proxy stripped the header. |
| `5xx` | `kind: "create_failed"`. |
| Network failure | `kind: "network"`. |

The fetch is wired with an `AbortController`; the home view aborts in-flight requests when its effect re-runs (StrictMode dev guard, see [`routing.md`](routing.md) §"Idempotency").

---

## WebSocket: connect and join

The client opens exactly one WebSocket per active room view. The connection-lifecycle controller is the only caller; it consumes the wire client's `connect(roomId, userId, callbacks)` function.

### `connect` signature

```ts
type WireCallbacks = {
  onSync:           (payload: { roomId: string; state: PublicState }) => void;
  onPeerEvent:      (event: DiagramEvent) => void;
  onAck:            (eventId: string, status: AckStatus) => void;
  onError:          (frame: ErrorFrame) => void;
  onRoomDestroyed:  (reason: "empty" | "shutdown") => void;
  onClose:          (info: CloseInfo) => void;
  onOpen:           () => void;
};

type PublicState = { elements: Record<string, Element>; arrows: Record<string, Arrow> };
type AckStatus = "applied" | "duplicate" | "rejected";
type ErrorFrame = { code: string; message?: string; eventId?: string };
type CloseInfo = { code: number; reason: string; wasClean: boolean };

function connect(roomId: string, userId: string, cb: WireCallbacks): WireHandle;

type WireHandle = {
  send(event: DiagramEvent): void;   // wraps as { type: "event", event }
  ping(): void;                      // not used in MVP; reserved
  close(code?: number): void;        // initiates a clean close (1000)
};
```

- `PublicState`, `DiagramEvent`, `Element`, `Arrow` come from `@fluxboard/domain` (no local redefinition).
- The handle is opaque from the lifecycle controller's perspective; only `send` and `close` are normally called.
- `connect` synchronously instantiates a `WebSocket` and registers the listeners. The socket may not be open yet — callers must wait for `onOpen` before calling `send`.

### Open handshake

On `onOpen`, the wire client immediately sends:

```json
{"type":"join","userId":"<userId from store>"}
```

This is automatic — the lifecycle controller does not call a separate `join` method. From the controller's perspective, "open and joined" is one transition signalled by the first `onSync` callback.

The wire client tracks an internal `joinAcked: boolean`. Until the first `sync` arrives:

- Inbound frames other than `sync` are still dispatched to their respective callbacks (the server is permitted to send `error` before `sync` if `join` itself is malformed).
- Outbound `event` sends are buffered in a small array (capacity 64). On `sync`, the buffer drains in order via `socket.send`. If the buffer is full when a new `event` arrives, the oldest is dropped and a `console.warn` fires — this is a defensive cap; in practice the lifecycle controller does not send events until it observes the connected state.

### Frame encoding

Each outbound message is `JSON.stringify(obj)` followed by `socket.send(string)`. One JSON object per frame. No batching, no NDJSON, no binary frames. Matches `backend/specs/wire-protocol.md` §"General invariants".

Each inbound message is decoded via `JSON.parse(event.data)`. On parse failure or non-object root, the wire client logs the offending bytes (truncated to 200 chars) and ignores the frame — the backend should be closing with `1003` shortly after.

---

## Client → Server messages

The wire client sends three kinds of frames. Only `event` and `join` are used today; `ping` is reserved.

### `join`

Sent automatically on `onOpen`. Not exposed to callers.

```ts
{ type: "join", userId: string }
```

### `event`

Sent via `handle.send(event)`. The wire client wraps the bare `DiagramEvent` in an envelope:

```ts
{ type: "event", event: DiagramEvent }
```

The frontend stamps `event.id`, `event.timestamp` (`Date.now()`), and `event.userId` (the connection's userId) before calling `send`. The server preserves `id` and overwrites the other two — the frontend's values for `timestamp` / `userId` are placeholders to satisfy schema validation, as documented in `backend/specs/wire-protocol.md` §"Server-side stamping".

### `ping`

Reserved. `handle.ping()` exists in the API but is a no-op in MVP. The browser's automatic WebSocket protocol-level ping/pong handles liveness.

---

## Server → Client messages

The wire client dispatches every inbound frame to one of the callbacks.

| `type` | Callback | Frame shape |
|---|---|---|
| `sync` | `onSync({ roomId, state })` | `{ type: "sync", roomId: string, state: PublicState }` |
| `event` | `onPeerEvent(event)` | `{ type: "event", event: DiagramEvent }` |
| `ack` | `onAck(eventId, status)` | `{ type: "ack", eventId: string, status: AckStatus }` |
| `error` | `onError({ code, message?, eventId? })` | `{ type: "error", code: string, message?: string, eventId?: string }` |
| `room_destroyed` | `onRoomDestroyed(reason)` | `{ type: "room_destroyed", reason: "empty" \| "shutdown" }` |
| `pong` | (ignored) | `{ type: "pong" }` |
| anything else | logged + ignored | — |

### Validation

Inbound frames are validated structurally before dispatch:

1. Parse JSON. On failure: log + ignore. Backend should close shortly.
2. Reject if root is not an object or `type` is not a string. Log + ignore.
3. For each `type`, check the required fields exist and have the expected primitive shapes. Unknown `type` values are logged and ignored — forward-compatible.
4. For `event` and peer-event frames, the validator checks that `event.type` is one of the known `DiagramEvent` discriminants. Unknown discriminants are logged and dropped (the server's own validator should have caught this already; this is defensive).

The wire client does not deeply validate `DiagramEvent` payloads. The store's `applyEvent` is the source of truth; if a payload is malformed, `applyEvent` will treat it as a no-op (returning state unchanged) per the domain spec.

---

## Error code handling

The `error` frame's `code` field drives both UI surface and connection lifecycle. The table below is the contract between this spec and [`connection-lifecycle.md`](connection-lifecycle.md): when the wire client receives a frame, it forwards it via `onError`, and the lifecycle controller consults this table.

| `code` | Backend closes after? | Frontend action |
|---|---|---|
| `bad_json` | Yes (`1003`) | Treat as a client bug. Log frame. Lifecycle moves to `disconnected_terminal` with no reconnect. |
| `must_join_first` | Yes (`4400`) | Client bug. Same as `bad_json`. |
| `already_joined` | Yes (`4400`) | Client bug. Same as `bad_json`. |
| `invalid_join` | Yes (`4400`) | Bad `userId`. Lifecycle terminal; error view `kind: "create_failed"` with a clarifying message (this should be unreachable — the frontend always sends a UUID). |
| `invalid_event` | No | Look up `eventId` in the store's pending-event map and run the per-type rollback from [`store.md`](store.md) §"Rollback table". Drop from pending. Connection stays open; no lifecycle change. |
| `unknown_message` | No | Client bug. Log. No state change. |
| anything else | unknown | Log warning. No state change unless followed by a close. |

Every `error` frame is `console.warn`'d regardless of severity. Production builds keep these logs — they are debugging surface, not user-facing.

---

## Close codes

The wire client maps WebSocket close codes to a `CloseInfo` and forwards via `onClose`. The lifecycle controller decides what to do with them.

| Code | Source | Lifecycle interpretation |
|---|---|---|
| `1000` | Normal close (we called `handle.close()`) | No reconnect. |
| `1001` | Server shutdown | Terminal, `kind: "server_shutdown"`. |
| `1003` | Unsupported data (bad JSON) | Terminal, treat as client bug. |
| `1006` | Abnormal close (no clean close frame) | Trigger reconnect path. |
| `1009` | Message too big | Terminal, client bug (an `event` payload exceeded 256 KB). |
| `4400` | Protocol error | Terminal, client bug. |
| `4404` | Room not found (mid-session — rare) | Terminal, `kind: "not_found"`. |
| `4408` | Join timeout (we didn't send `join` fast enough) | Reconnect once; if it happens again terminal. |
| `1011` / other `1xxx` | Server error or unhandled | Reconnect path. |
| anything `4xxx` not in this table | Unknown server-defined code | Terminal, log code. |

Lifecycle-side decisions live in [`connection-lifecycle.md`](connection-lifecycle.md); this table is a reference for the codes the wire client can observe.

---

## Server stamping and event id

The frontend mints `event.id` as a UUID v4 (via `crypto.randomUUID()`). The id is:

- Persisted in the store's `pendingEvents` map (see [`store.md`](store.md)).
- Used to correlate the eventual `ack` back to the optimistic state.
- The idempotency key on the server. If the frontend retries the same event after a disconnect (rare; MVP does not queue, but a duplicate could occur if the user clicks rapidly across reconnects), the server returns `ack { status: "duplicate" }` and no broadcast fires.

`event.timestamp` and `event.userId` are set on the frontend to satisfy schema validation. The server overwrites both before applying. The store does not depend on the local values being correct — once `ack` arrives, the canonical event is already in the room's state on the server side; the frontend's optimistic copy may carry slightly stale timestamps, which has no semantic effect.

---

## Invariants

- **One WebSocket per active `<RoomView>`.** The wire client never opens a second socket for the same room view; reconnects close the old socket and open a new one via the lifecycle controller.
- **`join` is sent exactly once per socket open.** The wire client emits it from the `open` handler and never again.
- **No `event` frame is sent before `onSync` fires.** If `handle.send` is called earlier, the event is buffered (capacity 64) and drained after sync. The lifecycle controller normally enforces this externally; the buffer is a defense-in-depth.
- **Outbound frames never reference a stale `userId`.** The userId at `connect()` time is captured in the wire client closure. If the lifecycle controller reopens the socket, it calls `connect` again with the (still-the-same) userId from the store.
- **Inbound frames are structurally validated before dispatch.** Bad shapes are logged and dropped; they never reach the store.

---

## Out of scope (MVP)

- Compression or binary frames (`permessage-deflate`, `arraybuffer` transport).
- Application-level `ping` / `pong`. Reserved in the API; not used.
- Message batching or fragmentation across frames.
- Reconnection tokens / session resumption protocol. A reconnect is a fresh `connect()`.
- Schema versioning of the wire format. The frontend assumes the backend's current protocol; mismatched servers will produce `unknown_message` errors that fall through to the generic handler.
- Per-event retry with exponential backoff. The frontend does not retry rejected or un-ack'd events; the ack-timeout in [`connection-lifecycle.md`](connection-lifecycle.md) forces a full reconnect instead.
- Authentication, TLS pinning, or origin restrictions. The frontend uses whatever scheme the backend URL specifies.
