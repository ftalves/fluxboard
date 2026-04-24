# FluxBoard

A real-time collaborative diagram tool built in TypeScript. Multiple users can create, move, and resize shapes, edit text, and connect shapes with arrows. All changes propagate via WebSockets and are emitted into an async event pipeline.

This is an **engineering exploration project** — not a production product. The focus areas are real-time systems, event-driven architecture, and spec-driven development.

## Architecture

Two layers with a hard boundary between them:

```
src/
  domain/      # pure functions: state transformations, no I/O
  realtime/    # WebSocket handling and client broadcasting (synchronous)
  event-bus/   # publish/subscribe system (async)
  workers/     # async event consumers (persistence, replay, analytics)
tests/
specs/         # spec documents written before implementation
```

**Domain layer** — pure `applyEvent(state, event) => newState`. No side effects, no I/O.

**Real-time layer** — manages WebSocket connections and broadcasts state updates between clients immediately. Never blocks on downstream processing.

**Event-driven layer** — workers consume events independently after the real-time layer publishes them.

## Domain Model

| Type | Fields |
|---|---|
| `Element` | `id`, `type` (`rectangle` \| `circle` \| `text`), `x`, `y`, `width`, `height`, `text?` |
| `Arrow` | `id`, `fromElementId`, `toElementId` |
| `DiagramState` | `elements`, `arrows`, `processedEventIds` |

**Events** (all carry `id`, `timestamp`, `userId`):

| Event | Payload |
|---|---|
| `ElementCreated` | full `Element` |
| `ElementMoved` | `{ id, x, y }` |
| `ElementResized` | `{ id, width, height }` |
| `ElementTextUpdated` | `{ id, text }` |
| `ElementDeleted` | `{ id }` — also removes all connected arrows |
| `ArrowCreated` | full `Arrow` — no-op if either endpoint element is missing |
| `ArrowDeleted` | `{ id }` |

Events are idempotent: replaying an event with a previously-seen `id` is a no-op.

## Getting Started

**Prerequisites:** Node.js 20+

```bash
npm install          # install dependencies
npm run build        # compile TypeScript
npm test             # run all tests
npm test -- --testPathPattern=<name>  # run a single test file
npm run dev          # start dev server (WebSocket + HTTP)
npm run lint         # lint src/ and tests/
npm run format       # format src/ and tests/
```

## Project Status

| Layer | Status |
|---|---|
| Domain (`src/domain/`) | Done — `applyEvent` fully implemented and tested |
| Real-time (`src/realtime/`) | Not started |
| Event-bus (`src/event-bus/`) | Not started |
| Workers (`src/workers/`) | Not started |

## Development Approach

This project follows a spec-driven loop:

1. Write a precise spec (inputs, outputs, edge cases) in `specs/`
2. Write tests covering edge cases first
3. Implement the minimal solution
4. Refactor only after tests pass

Before implementing anything: surface edge cases and get spec sign-off. Do not jump ahead.

## Intentional Tradeoffs

- **Last-write-wins** for conflict resolution — no CRDTs, no OT
- **Text editing replaces the full string** — no cursor sync
- **No freehand drawing** — only structured shapes
- **Arrows connect by element ID** — no complex path routing
- **In-memory state** — no persistence requirement for MVP
- **No authentication** — `userId` is a mocked string
