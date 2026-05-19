# Spec: Wire Protocol

The wire protocol covers all bytes exchanged between a client and the FluxBoard backend: the HTTP route for room creation and the WebSocket session for collaboration.

This spec is the authoritative source for message envelopes, validation, error codes, and server-side stamping. Implementations of `realtime/connection.ts`, `realtime/protocol/`, and `realtime/httpRoutes.ts` must conform to it.

---

## Transport overview

Two transports, single port:

- **HTTP** — `POST /rooms` only. Used to create a new room with a seeded diagram.
- **WebSocket** — `ws://host/ws/:roomId`. Used for joining and live collaboration. Anyone with the URL can join; there is no auth.

A single `http.Server` instance handles both. The WebSocket runs on the same port via the `upgrade` event.

All message bodies (HTTP and WS) are UTF-8 JSON.

---

## HTTP: `POST /rooms`

Creates a new room seeded with the client's local diagram state.

### Request

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/rooms` |
| `Content-Type` | `application/json` |
| Body | `{ "seed": { "elements": Record<string, Element>, "arrows": Record<string, Arrow> } }` |
| Body cap | `MAX_SEED_BYTES` (default `1048576` = 1 MB; see [`server-entry.md`](server-entry.md)). Larger bodies are rejected with `413 payload_too_large` and the connection is closed. |

`Element` and `Arrow` are the existing types from `domain/types.ts`.

### Responses

| Status | Body | When |
|---|---|---|
| `201 Created` | `{ "roomId": string }` | Seed is well-formed and a room was created. |
| `400 Bad Request` | `{ "error": "invalid_seed", "detail": string }` | Seed validation failed (see *Seed validation*). |
| `400 Bad Request` | `{ "error": "bad_json" }` | Body is not parseable JSON or the top-level shape is wrong. |
| `405 Method Not Allowed` | `{ "error": "method_not_allowed" }` | Any method other than POST on `/rooms`. |
| `404 Not Found` | `{ "error": "not_found" }` | Any other path. |
| `413 Payload Too Large` | `{ "error": "payload_too_large" }` | Body exceeded the `MAX_SEED_BYTES` cap. |
| `415 Unsupported Media Type` | `{ "error": "unsupported_media_type" }` | `Content-Type` is missing or not `application/json`. |

### Seed validation

The handler validates the seed before creating the room. If any rule fails, return `400 invalid_seed` with a `detail` describing the first failure encountered.

Rules:
1. `seed.elements` and `seed.arrows` are objects (not arrays, not null).
2. Every key in `seed.elements` is a non-empty string equal to the contained element's `id`.
3. Every value in `seed.elements` matches the `Element` shape: `id` non-empty string, `type` is one of `"rectangle" | "circle" | "text"`, and `x`, `y`, `width`, `height` are finite numbers. `text`, when present, is a string.
4. Every key in `seed.arrows` is a non-empty string equal to the contained arrow's `id`.
5. Every value in `seed.arrows` matches the `Arrow` shape: `id`, `fromElementId`, `toElementId` all non-empty strings.
6. For every arrow, both `fromElementId` and `toElementId` exist as keys in `seed.elements`.
7. For every arrow, `fromElementId !== toElementId` — arrows must connect two distinct elements. (Matches `applyEvent`'s runtime rejection of self-referencing `ArrowCreated`.)

Coordinate values, sizes, and `text` length are not range-validated (consistent with `applyEvent`'s "no validation" stance). Negative or zero dimensions are accepted.

### Side effects

On success the registry creates a room with `state = { elements: seed.elements, arrows: seed.arrows, processedEventIds: {} }`, generates an 8-char URL-safe id, and publishes `room.created` to the event bus. The HTTP response body contains the id; the room is immediately joinable.

The seed is **not** translated into a stream of `ElementCreated` / `ArrowCreated` events. It is loaded directly into the room's `DiagramState`.

---

## WebSocket connection lifecycle

### URL

```
ws://host/ws/:roomId
```

`:roomId` is the path segment immediately following `/ws/`. No query string is read.

### Upgrade phase

| Situation | Server response |
|---|---|
| `:roomId` exists in the registry | Accept the upgrade. |
| `:roomId` is missing or empty in the path | Respond to the upgrade with `HTTP/1.1 404 Not Found\r\n\r\n` and destroy the socket. |
| `:roomId` does not match any room | Same as above (`HTTP/1.1 404 Not Found`). |

The upgrade response uses raw HTTP because `ws` exposes the socket pre-upgrade. Returning a JSON body is unnecessary — the client only needs the status.

### Connection states

```
connected ── (no message) ──▶ awaitingJoin ── { type: "join" } ──▶ joined ── (close) ──▶ closed
```

- **`awaitingJoin`** — socket is open. Server expects exactly one `{ type: "join" }` message. Any other client message returns an error and closes the socket.
- **`joined`** — `userId` is bound. Client may send `event` or `ping` messages. Server may broadcast `event`, send `ack`, `error`, `pong`, or `room_destroyed`.
- **`closed`** — terminal. The connection handler removes the client from the room.

### Timeouts, heartbeats, and frame limits

| Concern | Value | Behavior |
|---|---|---|
| Join timeout | `JOIN_TIMEOUT_MS` (default `5000`) | If no `join` is received within the window, server closes with code `4408`. |
| Heartbeat | `WS_HEARTBEAT_MS` (default `30000`) | After `joined`, server sends `ws.ping` every interval. If no `pong` is received by the next interval, the socket is terminated. |
| Max inbound frame size | `MAX_WS_MESSAGE_BYTES` (default `262144` = 256 KB) | Inbound WebSocket frames exceeding this are rejected by the `ws` library, which closes the socket with code `1009`. Server → client frames are not capped at the protocol level (bounded by Node memory). |

The 256 KB inbound cap accommodates the largest expected single message — typically an `ElementTextUpdated` carrying a long text body — with several multiples of headroom, while keeping the per-connection memory cost bounded. It is intentionally well below the seed cap, since seeds bundle many elements at once whereas individual events carry a single change.

Heartbeat uses the WebSocket protocol's ping/pong frames, not the application-level `ping`/`pong` messages described below. The application-level `ping`/`pong` is for clients that prefer JSON-only round-trips.

### Close codes

| Code | Name | Meaning |
|---|---|---|
| `1000` | Normal | Clean client-initiated close. |
| `1001` | Going away | Server is shutting down (`SIGINT` / `SIGTERM`). |
| `1003` | Unsupported data | Message was not parseable JSON or not a JSON object. |
| `1009` | Message too big | An inbound frame exceeded `MAX_WS_MESSAGE_BYTES`. |
| `4400` | Protocol error | Client violated the protocol (e.g. message before `join`, second `join`). |
| `4404` | Room not found | Used when the room no longer exists at upgrade time. (For path-time rejections, the upgrade itself returns HTTP 404 and never opens a WS.) |
| `4408` | Join timeout | No `join` received within `JOIN_TIMEOUT_MS`. |

Server emits `4xxx` codes (private use range) for application-level conditions. `1xxx` codes are reserved for transport-level conditions per the WebSocket RFC.

---

## Client → Server messages

Each WS frame carries one JSON object. Top-level shape: `{ "type": string, ... }`.

### `join`

```ts
{ type: "join"; userId: string }
```

| Field | Constraint |
|---|---|
| `userId` | Non-empty string. No format validation (auth is mocked). |

| Scenario | Server behavior |
|---|---|
| First message in `awaitingJoin` and well-formed | Add client to the room, transition to `joined`, reply `sync`. |
| Sent again after `joined` | Reply `error { code: "already_joined" }` and close `4400`. |
| `userId` missing or not a string | Reply `error { code: "invalid_join" }` and close `4400`. |

### `event`

```ts
{ type: "event"; event: DiagramEvent }
```

`DiagramEvent` is the union from `domain/types.ts`. The `event` object MUST include `id`, `timestamp`, `userId`, `type`, and `payload`. The server overwrites `timestamp` and `userId` (see *Server-side stamping*); the client SHOULD send placeholder values (e.g. `Date.now()` and the connection's `userId`) but the server does not require them to be correct.

| Scenario | Server behavior |
|---|---|
| Sent in `awaitingJoin` | Reply `error { code: "must_join_first" }` and close `4400`. |
| Schema-invalid event (wrong `type`, missing payload fields, etc.) | Reply `error { code: "invalid_event", eventId? }`. Connection stays open. |
| Valid event, applied successfully | Server broadcasts to peers (skip-sender) and replies `ack { eventId, status: "applied" }`. |
| Valid event, duplicate `event.id` | Server applies no-op (already in `processedEventIds`); replies `ack { eventId, status: "duplicate" }`. No broadcast. |
| Valid event, semantically rejected by `applyEvent` (e.g. `ArrowCreated` to missing element, `ElementMoved` of unknown id) | Server applies no-op; replies `ack { eventId, status: "rejected" }`. No broadcast. |

The `ack` is the sender's confirmation. Senders MUST treat `applied` and `duplicate` identically for state purposes. `rejected` is a hint that the client's state has drifted; recovery is the client's concern.

### `ping`

```ts
{ type: "ping" }
```

Application-level keepalive. Server replies `{ type: "pong" }`. Independent of WebSocket-protocol ping/pong frames.

---

## Server → Client messages

### `sync`

```ts
{ type: "sync"; roomId: string; state: { elements: Record<string, Element>; arrows: Record<string, Arrow> } }
```

Sent immediately after a successful `join`. `state` is the **public projection** of the room's `DiagramState` — `processedEventIds` is omitted. It is an internal idempotency device; clients have no use for it.

`sync` is sent exactly once per connection.

### `event` (broadcast)

```ts
{ type: "event"; event: DiagramEvent }
```

A peer's accepted event, broadcast to all clients in the room **except the original sender** (the sender already has the event from its own optimistic update). The `event` object reflects server-stamped `timestamp` and `userId`.

### `ack`

```ts
{ type: "ack"; eventId: string; status: "applied" | "duplicate" | "rejected" }
```

Sent to the client that submitted the event. Exactly one `ack` per accepted `event` message (well-formed events get an `ack`; malformed messages get an `error` instead).

| Status | Meaning |
|---|---|
| `applied` | Event was applied to room state and broadcast to peers. |
| `duplicate` | `event.id` was already in `processedEventIds`. State unchanged. No broadcast. |
| `rejected` | `applyEvent` no-op'd the event (semantic rule violation). State unchanged. No broadcast. |

### `error`

```ts
{ type: "error"; code: string; message?: string; eventId?: string }
```

Connection-level or message-level error. Some errors are followed by a close frame (see *Error codes* below).

| `code` | Followed by close? | Description |
|---|---|---|
| `bad_json` | Yes — `1003` | The frame was not parseable JSON or not a JSON object. |
| `must_join_first` | Yes — `4400` | A non-`join` message arrived before `join`. |
| `already_joined` | Yes — `4400` | A second `join` was received. |
| `invalid_join` | Yes — `4400` | `join` payload was malformed. |
| `invalid_event` | No | Event payload failed schema validation. Connection stays open. |
| `unknown_message` | No | `type` field did not match any client message type. |

`eventId` is set only when the error pertains to a specific `event` message and that id was extractable from the malformed payload.

### `room_destroyed`

```ts
{ type: "room_destroyed"; reason: "empty" | "shutdown" }
```

Sent immediately before the server closes the socket because the room is being torn down. Clients SHOULD render an "ended" state and not attempt to reconnect to the same room id.

`empty` is unusual on this path (a destroyed-by-empty room has no clients to notify); it appears here mainly for the `shutdown` case during `SIGINT` / `SIGTERM`.

### `pong`

```ts
{ type: "pong" }
```

Reply to a client `ping`.

---

## Server-side stamping

When the server accepts a client `event` message, it overwrites specific fields before applying.

| Field | Source | Why |
|---|---|---|
| `event.id` | **Client** (preserved as-is) | Idempotency depends on client retries hitting the same id. Server-generated ids would break dedupe. The id is the correlation token between the client's optimistic update and the server's `ack`. |
| `event.timestamp` | **Server** (overwritten with `Date.now()` at receive time) | Client clocks drift. Server timestamps give last-write-wins a stable ordering scheme within a room. |
| `event.userId` | **Server** (overwritten with the connection's `userId` from `join`) | Prevents one connection from spoofing another's userId, even though auth is mocked. |
| `event.type`, `event.payload` | Client (validated against the `DiagramEvent` union, otherwise rejected as `invalid_event`) | These carry the user's intent. |

The re-stamped event is what gets passed to `applyEvent`, broadcast to peers, and published to the bus.

---

## Validation policy

- **JSON parse failure** → `error { code: "bad_json" }`, close `1003`.
- **Top-level not an object, or `type` field not a string** → `error { code: "bad_json" }`, close `1003`.
- **`type` not in the client message union** → `error { code: "unknown_message" }`. Connection stays open.
- **`type` matches but payload fails schema** → message-specific error code per the tables above.

Schema validation is structural: required fields exist, types match, and for `event` messages the discriminated union resolves cleanly. Numeric ranges and string lengths are not validated (matches the domain layer's "no validation" stance).

---

## General invariants

- **One JSON object per WS frame.** No newline-delimited JSON, no batching, no fragmentation across frames.
- **`sync` is sent exactly once per connection.** Reconnection is a new connection and gets its own `sync`.
- **Skip-sender on broadcast.** A client never receives an `event` message for an event it sent. It receives `ack` instead.
- **Ack-or-error per `event` message.** Every well-formed `event` message produces exactly one `ack`. Every malformed message produces exactly one `error` (and possibly a close).
- **No cursor or presence data** in this iteration. Last-write-wins applies to everything; no awareness protocol.
- **`processedEventIds` never crosses the wire.** It is internal to the server's `DiagramState`.

---

## Out of Scope (MVP)

- Authentication and authorization (`userId` is mocked, anyone with the room URL joins).
- Compression or binary frames.
- Message batching, fragmentation, or streamed payloads.
- Presence / cursor / awareness protocol.
- Reconnection tokens or session resumption (a dropped socket is a dropped session; the client just opens a new one).
- Schema versioning of the protocol itself.
- Any HTTP routes other than `POST /rooms`.
- Validation of numeric ranges or finiteness on incoming `event` payloads. Seeds are validated structurally (rejecting `NaN`/`Infinity` coordinates, unknown element types, etc.), but live `event` messages pass through unchecked beyond the discriminated-union shape — consistent with [`apply-event.md`](apply-event.md)'s "no validation" stance for runtime events.
