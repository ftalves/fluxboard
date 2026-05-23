# FluxBoard

A real-time collaborative diagram tool built in TypeScript. Multiple users can create, move, and resize shapes, edit text, and connect shapes with arrows. All changes propagate via WebSockets and are emitted into an async event pipeline.

This is an **engineering exploration project** — not a production product. The focus areas are real-time systems, event-driven architecture, and spec-driven development.

## Repository Layout

The repo is an npm workspaces monorepo with three packages:

```
packages/
  domain/      # shared pure logic — types, applyEvent, used by both backend and frontend
backend/       # Node.js WebSocket + HTTP server
frontend/      # React + Vite + Konva client
```

```
packages/domain/
  src/
    types.ts       # DiagramState, Element, Arrow, Event types
    applyEvent.ts  # pure (state, event) => newState
  tests/

backend/
  src/
    realtime/      # WebSocket connections, rooms, wire protocol
    event-bus/     # publish/subscribe topics
    workers/       # async event consumers (logging today; persistence/replay next)
    server.ts      # HTTP + WS bootstrap
  specs/           # spec documents written before implementation
  tests/

frontend/
  src/
    net/           # WebSocket client + connection lifecycle
    store/         # Zustand store + identity
    views/         # HomeView, RoomView, ErrorView
    router.ts      # hash router
    App.tsx, main.tsx
  tests/
```

## Architecture

Three layers with a hard boundary between them:

**Domain layer** (`packages/domain/`) — pure `applyEvent(state, event) => newState`. No side effects, no I/O. Imported by both backend and frontend so state transitions stay consistent across the wire.

**Real-time layer** (`backend/src/realtime/`) — WebSocket connections, rooms, and the wire protocol. Broadcasts state updates between clients immediately. Never blocks on downstream processing.

**Event-driven layer** (`backend/src/event-bus/`, `backend/src/workers/`) — workers consume events independently after the real-time layer publishes them (persistence, replay, analytics).

The frontend mirrors the backend's split: `net/` owns the socket and lifecycle, `store/` holds local `DiagramState` advanced via the shared `applyEvent`, `views/` renders with React + react-konva.

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

Install once at the repo root — npm workspaces handles all three packages:

```bash
npm install           # install dependencies for all workspaces
npm run build         # build all workspaces
npm test              # run all tests across workspaces
npm run lint          # lint all workspaces
```

Run a single workspace:

```bash
npm run dev --workspace=backend     # start WebSocket + HTTP server
npm run dev --workspace=frontend    # start Vite dev server
npm test --workspace=@fluxboard/domain
```

Run a single test file inside a workspace:

```bash
npm test --workspace=backend -- --testPathPattern=<name>
npm test --workspace=frontend -- <pattern>
```

## Project Status

| Package | Status |
|---|---|
| `packages/domain` | Done — `applyEvent` fully implemented and tested |
| `backend/realtime` | In progress — WS connections, rooms, wire protocol |
| `backend/event-bus` | Bootstrapped — pub/sub + logging worker |
| `backend/workers` | Logging worker only; persistence/replay next |
| `frontend` | In progress — routing, store, connection lifecycle wired |

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
