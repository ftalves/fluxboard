# Spec: Server Entry

`backend/src/index.ts` is the composition root. It wires every other module together, starts the server listening, and orchestrates graceful shutdown. It is the only file in the codebase that knows about all of: configuration, the bus, the registry, the workers, the HTTP server, and the WebSocket server.

This spec defines the boot order, the configuration surface, and the shutdown contract. Module-level behavior (bus dispatch, room lifecycle, broadcast rules, etc.) is in the per-module specs and is not repeated here.

---

## Surface

`index.ts` exports nothing. It is invoked as the process entry point via:

```bash
ts-node src/index.ts        # dev (existing npm run dev script)
node dist/index.js          # production-style, after npm run build
```

It does not parse CLI arguments. Configuration is via environment variables (see *Configuration*).

---

## Configuration

A small `config.ts` module reads environment variables once at import time and exports an immutable `Config` object. Defaults are hardcoded; the user is expected to override via env vars or Node 20's `--env-file` flag.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | TCP port for the HTTP + WebSocket server. |
| `GRACE_PERIOD_MS` | `30000` | Time an empty room is held before destruction (see [`room-lifecycle.md`](room-lifecycle.md)). |
| `ROOM_ID_LENGTH` | `8` | Length of generated room ids (see [`room-registry.md`](room-registry.md)). |
| `JOIN_TIMEOUT_MS` | `5000` | How long the server waits for a `join` after upgrade (see [`wire-protocol.md`](wire-protocol.md)). |
| `WS_HEARTBEAT_MS` | `30000` | Heartbeat interval (see [`realtime-broadcast.md`](realtime-broadcast.md)). |
| `MAX_SEED_BYTES` | `1048576` (1 MB) | Body cap for `POST /rooms` (see [`wire-protocol.md`](wire-protocol.md)). |
| `MAX_WS_MESSAGE_BYTES` | `262144` (256 KB) | Inbound WebSocket frame cap, applied via `ws.WebSocketServer({ maxPayload })` (see [`wire-protocol.md`](wire-protocol.md)). |

Validation rules:

- All numeric values are parsed as integers. Non-integer or non-positive values cause `index.ts` to log the offending variable and exit with code `1` before any server starts. The process should fail fast on misconfiguration; partial startup is worse than no startup.
- Unknown env vars are ignored (no warnings). Future variables can be added without breaking existing deployments.

There is no `.env` file loader (`dotenv` or similar). Node 20's `--env-file=path` is the supported mechanism if file-based config is desired.

---

## Boot order

The order is significant — each step depends on the prior steps' guarantees.

1. **Read config.** `import { config } from './config'`. If config validation fails, the process exits at this step.
2. **Construct the event bus.** `const bus = new EventBus()`. No dependencies.
3. **Construct the room registry.** `const registry = new RoomRegistry({ bus, gracePeriodMs: config.GRACE_PERIOD_MS })`. Depends on the bus so it can publish lifecycle events.
4. **Register workers.** `const unsubs = registerWorkers(bus)`. Workers must be subscribed before any `room.created` can be published, so this happens before the HTTP server starts accepting requests.
5. **Build the HTTP server.** Construct an `http.Server` whose request handler delegates to `httpRoutes`. The handler closes over `{ registry, config }`.
6. **Attach the WebSocket server.** Construct a `WebSocketServer({ noServer: true })`. Register an `upgrade` listener on the `http.Server` that:
   - Parses `:roomId` from the URL path.
   - Looks it up via `registry.getRoom(id)`.
   - On hit: completes the upgrade and hands the resulting `ws` socket to `connection.handleConnection({ socket, room, registry, bus, config })`.
   - On miss: writes `HTTP/1.1 404 Not Found\r\n\r\n` to the raw socket and destroys it (per [`wire-protocol.md`](wire-protocol.md)).
7. **Start listening.** `httpServer.listen(config.PORT, () => console.log('[server] listening on port', config.PORT))`.
8. **Install shutdown handlers.** `SIGINT` and `SIGTERM` both call the shutdown sequence (see *Shutdown* below). Both signals install only after `listen` succeeds; if `listen` fails, the failure handler logs and exits with code `1`.

The composition is **explicit and threaded** — no module-level singletons. The bus, registry, and config are passed into every consumer that needs them. This keeps tests trivial: each test owns its own instances.

---

## Shutdown

On `SIGINT` or `SIGTERM`:

1. **Stop accepting new connections.**
   - `httpServer.close()` is called immediately. This stops accepting new HTTP connections and prevents new WebSocket upgrades. In-flight HTTP requests are allowed to complete; existing WS connections remain.
2. **Snapshot the registry.** Collect existing room ids into a local array via `registry.forEachRoom(r => ids.push(r.id))`. Iterating during mutation is forbidden (see [`room-registry.md`](room-registry.md)).
3. **Destroy each room.** For each id in the snapshot, call `registry.destroyRoom(id, 'shutdown')`. This sends `{ type: "room_destroyed", reason: "shutdown" }` to every connected client and closes their sockets with code `1001`.
4. **Unsubscribe workers.** Call each unsubscribe from the array returned by `registerWorkers`. After this point, new bus publishes (none should occur — the registry is empty) would not be delivered.
5. **Close the bus.** `bus.close()` per [`event-bus.md`](event-bus.md). Already-scheduled microtasks still run; further publishes become no-ops.
6. **Wait for `httpServer.close` to resolve**, then exit cleanly.
7. **Hard timeout.** If shutdown has not completed within `10_000` ms, force `process.exit(1)`. This guards against hung sockets or stuck destroy paths.

Shutdown is idempotent: receiving a second signal during shutdown is logged and ignored. A third signal triggers `process.exit(1)` immediately.

The `SIGINT` / `SIGTERM` distinction is not honored beyond logging the received signal name. Both run the same sequence.

---

## Failure modes

### Startup failures

| Failure | Behavior |
|---|---|
| `config.ts` validation fails | Log the offending variable and exit `1`. No server started. |
| `httpServer.listen(PORT)` fails (port in use, etc.) | Log the error and exit `1`. Workers, bus, and registry exist but are torn down via the same shutdown sequence on the way out. |
| Any `import` throws | Node's default unhandled-exception path: stderr trace and exit `1`. |

### Runtime failures

| Failure | Behavior |
|---|---|
| An uncaught exception escapes a request or socket handler | Logged via `process.on('uncaughtException')`. Process exits `1`. (We do not attempt to limp along after an uncaught exception; in-memory state cannot be assumed sound.) |
| An unhandled promise rejection | Same as above, via `process.on('unhandledRejection')`. |
| A worker subscriber throws | Caught by the bus's per-subscriber `try/catch`. The process continues. (Per [`event-bus.md`](event-bus.md).) |
| A socket `send` or `close` throws | Caught by realtime-layer try/catch. The process continues. (Per [`room-registry.md`](room-registry.md) and [`realtime-broadcast.md`](realtime-broadcast.md).) |

The `uncaughtException` / `unhandledRejection` handlers are installed once, immediately after step 1 (config), so they catch failures during boot as well.

---

## Framework boundary

The HTTP layer uses raw `node:http` rather than Express (or any other framework), per CLAUDE.md's "avoid heavy frameworks" stance and because `POST /rooms` is the only route. The design, however, **keeps the door open** to swap in Express (or Fastify, Hono, etc.) later if we add features that benefit from a framework — e.g. authenticated users, persistent rooms, multiple HTTP routes, or middleware-style cross-cutting concerns.

**Portability invariant:** route logic must not import or reference Node-specific HTTP types. Specifically:

- `handleHttpRequest` (in [`httpRoutes.ts`](../src/realtime/httpRoutes.ts)) takes a plain `HttpRequest` (method, url, headers, body-as-string) and returns a plain `HttpResponse` (status, headers, body-as-string). It does not see `IncomingMessage` or `ServerResponse`.
- `validateSeed`, `parseClientMessage`, `Room`, `RoomRegistry`, and `EventBus` are framework-agnostic by construction.
- The body is passed as a **string**, not a pre-parsed object. This keeps JSON-parse error handling local to the route (`400 bad_json`) and is what makes the route Express-swappable: with Express, we'd use `express.text({ type: 'application/json', limit: MAX_SEED_BYTES })` rather than `express.json()`.

**Node-specific code is confined to `server.ts`:** body streaming with the `MAX_SEED_BYTES` cap, response writing, and the `upgrade` event handler. A future Express adoption replaces only these pieces; nothing else changes.

**WebSocket is unaffected by the HTTP framework choice.** `ws.WebSocketServer({ noServer: true })` attaches directly to the underlying `http.Server` via `upgrade`, so it sits beside the HTTP router rather than under it. Express would not own the WS path even if adopted for HTTP.

---

## Invariants

- **`index.ts` is the only place modules are constructed.** No other file constructs an `EventBus`, a `RoomRegistry`, or starts an `http.Server`.
- **Boot order is fixed.** Workers are subscribed before the HTTP server listens. The bus exists before the registry. The registry exists before the connection handler context is built.
- **Shutdown is graceful by default and bounded by a hard timeout.** No code path can keep the process alive past `10_000` ms after a signal.
- **Single port for HTTP and WebSocket.** One `http.Server` instance, one `listen` call. The WS server attaches via `noServer: true`.
- **No globals.** All shared instances are explicitly passed.
- **Route logic is framework-agnostic.** `server.ts` is the only Node-HTTP-aware file; route handlers take plain request/response objects so the layer can be swapped to Express or another framework if future requirements warrant it.
- **Fail fast on misconfig.** Bad env vars exit before any port is bound or any side effect occurs.

---

## Out of Scope (MVP)

- TLS / HTTPS — terminated upstream if needed (e.g. a reverse proxy).
- Multi-process clustering or worker threads.
- Health-check endpoints (`/healthz`, `/readyz`). The single `POST /rooms` route is the only HTTP surface.
- Metrics endpoints (Prometheus, etc.).
- Structured boot logging beyond the single "listening" line.
- Hot-reload of configuration. Config is read once at import time; changes require a restart.
- Drain-mode (refusing new rooms while keeping existing ones alive). On shutdown, every room is destroyed.
- Persistence of state on shutdown (snapshotting rooms to disk). All state is intentionally ephemeral per CLAUDE.md.
- CLI argument parsing. Configuration is env-only.
