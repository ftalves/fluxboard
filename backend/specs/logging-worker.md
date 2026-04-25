# Spec: Logging Worker

The logging worker is a single bus subscriber that prints every published event to stdout. It exists to prove the realtime ↔ event-bus ↔ worker decoupling end-to-end, and to give a developer running `npm run dev` an immediate, grep-friendly trace of what the server is doing.

It is the only worker in this iteration. The worker contract it follows ("subscribers must not throw / must return quickly") is defined in [`event-bus.md`](event-bus.md). The topic payloads it consumes are defined there as well.

---

## Surface

```ts
function startLoggingWorker(bus: EventBus): Unsubscribe;
```

The function subscribes to all three bus topics and returns a single `Unsubscribe` that removes every subscription it created. There is no instance, no class, no per-call configuration.

It is registered through `workers/register.ts`:

```ts
function registerWorkers(bus: EventBus): Unsubscribe[];
```

`registerWorkers` is called once from `index.ts` at boot. Its return value is collected and used during shutdown.

---

## Subscribed topics

All three topics defined in [`event-bus.md`](event-bus.md):

- `room.created`
- `domain.event`
- `room.destroyed`

The worker does no filtering by topic content. Every published event produces exactly one log line.

---

## Output format

One line per published event, written via `console.log`. Each line has the same shape:

```
[bus] <topic-padded-to-16> <one-line JSON object>
```

The topic is padded to 16 characters so columns line up across topics in a terminal. The trailing payload is a JSON object; field order matches the table below.

| Topic | Line format |
|---|---|
| `room.created` | `[bus] room.created    { "roomId": <id>, "createdAt": <ms>, "seedElementCount": <n>, "seedArrowCount": <n> }` |
| `domain.event` | `[bus] domain.event    { "roomId": <id>, "event": { "id": <id>, "timestamp": <ms>, "userId": <id>, "type": <DiagramEvent type>, "payload": <object> } }` |
| `room.destroyed` | `[bus] room.destroyed  { "roomId": <id>, "destroyedAt": <ms>, "reason": "empty" \| "shutdown" }` |

The `domain.event` line carries the **full event** — metadata plus payload — so a developer reading the log can reconstruct exactly what changed. The payload's shape varies by event type (per [`apply-event.md`](apply-event.md) and `domain/types.ts`).

Implementation: each handler builds its line with a topic-name prefix and `JSON.stringify(payload)` of the full bus payload. No field selection, no payload trimming — the bus payload is logged verbatim.

Notes:

- Numbers are unquoted JSON numbers. String fields are JSON strings.
- No newlines or pretty-printing inside the payload object — `JSON.stringify` with no spacing argument. One log line per event is the readability contract.
- No timestamps are added by the worker itself. The events already carry the relevant timestamps (`createdAt`, `destroyedAt`, `event.timestamp`). A surrounding log collector can add wall-clock timestamps if desired.
- Long payloads (e.g. an `ElementTextUpdated` with a multi-kB string, or a future event carrying a large blob) produce long log lines. The worker does not truncate. If line length becomes a problem, a future spec can introduce a payload-size cap or move the worker behind a log-level gate.

---

## Behavior

| Scenario | Behavior |
|---|---|
| `room.created` published | Print one `[bus] room.created` line. |
| `domain.event` published | Print one `[bus] domain.event` line. |
| `room.destroyed` published | Print one `[bus] room.destroyed` line. |
| `console.log` throws (e.g. EPIPE on a closed stdout) | Caught by the bus's per-subscriber `try/catch` (see [`event-bus.md`](event-bus.md)). The worker itself does not catch — it has nothing useful to do with such an error. |
| `Unsubscribe` is called | All three subscriptions are removed. Subsequent publishes do not produce log lines. |
| `Unsubscribe` is called twice | Second call is a no-op (per the `Unsubscribe` contract in [`event-bus.md`](event-bus.md)). |
| Bus is closed before `Unsubscribe` is called | All in-flight microtask logs still run (already scheduled). The worker's stored unsubscribe handles, when called later, become no-ops. |

The worker MUST return quickly from each handler — `console.log` of a small JSON object is well within the budget. It MUST NOT throw; if a handler ever needs to do conditional work that might throw (e.g. file I/O in a future variant), it wraps that work in its own `try/catch`.

---

## Lifecycle

| Phase | Behavior |
|---|---|
| Start | `startLoggingWorker(bus)` is called from `registerWorkers(bus)` during `index.ts` boot, after the bus is constructed and before the HTTP server starts listening. The worker prints no startup banner. |
| Run | Subscriptions remain active for the life of the process, or until `Unsubscribe` is called. |
| Shutdown | On `SIGINT` / `SIGTERM`, `index.ts` invokes the unsubscribers returned from `registerWorkers`. The worker stops receiving new events at that point. Already-scheduled microtasks (events published before `Unsubscribe` ran) still print — this is a property of the bus's microtask dispatch, not a worker-level concern. |

The worker does not log its own lifecycle. Its presence is implied by the appearance of `[bus]` lines.

---

## Invariants

- **One subscriber registration per topic.** Three subscriptions total per `startLoggingWorker` call.
- **One log line per published event.** No batching, no deduplication, no rate limiting.
- **No state held by the worker.** It is a pure subscription wrapper. Restarting the worker mid-process is equivalent to unsubscribing and resubscribing.
- **No I/O other than `console.log`.** No file writes, no network, no metrics emission. Future workers may do those things; this one does not.

---

## Out of Scope (MVP)

- Structured-logging libraries (pino, winston, etc.).
- Log levels (info / debug / warn / error). Every line is unconditionally printed at one level.
- Per-topic filtering, sampling, or rate limiting.
- Truncation or size caps on long payloads.
- Per-room log file separation. All rooms' events interleave on a single stdout stream; consumers grep by `roomId` if needed.
- Persistence of log output to a file or external sink.
- Correlation ids beyond what the events already carry (`eventId`, `roomId`).
- Worker self-metrics (lines logged, errors caught).
- Multiple instances of the logging worker per process.
