# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FluxBoard is a real-time collaborative diagram tool (TypeScript). Multiple users can create/move/resize shapes, edit text, and connect shapes with arrows. All changes propagate via WebSockets and are also emitted into an async event pipeline.

This is an **engineering exploration project** — not a production product. Key areas of focus: real-time systems, event-driven architecture, and spec-driven development.

## Commands

These will be available once the project is bootstrapped. Typical setup:

```bash
npm install          # install dependencies
npm run build        # compile TypeScript
npm test             # run all tests
npm test -- --testPathPattern=<name>  # run a single test file
npm run dev          # start dev server (WebSocket + HTTP)
```

## Architecture

The system has two distinct layers with a clear boundary between them:

**Real-time layer** (`src/realtime/`) — synchronous, latency-sensitive
- Manages WebSocket connections
- Broadcasts state updates between clients immediately
- Does not care about persistence or downstream processing

**Event-driven layer** (`src/event-bus/`, `src/workers/`) — asynchronous, decoupled
- Receives domain events published by the real-time layer
- Workers consume events independently (persistence, replay, analytics)
- Never blocks the real-time path

**Domain layer** (`src/domain/`) — pure logic, no I/O
- All state transformations happen here as pure functions
- Central function: `applyEvent(state, event) => newState`
- No dependencies on WebSocket or event-bus concerns

```
src/
  domain/      # pure functions: elements, events, state transformations
  realtime/    # WebSocket handling and client broadcasting
  event-bus/   # publish/subscribe system
  workers/     # async event consumers
tests/
specs/         # spec documents before implementation
```

## Domain Model

**DiagramState**
```ts
{ elements: Record<string, Element>; arrows: Record<string, Arrow> }
```

**Element**
```ts
{ id: string; type: "rectangle" | "circle" | "text"; x: number; y: number; width: number; height: number; text?: string }
```

**Arrow**
```ts
{ id: string; fromElementId: string; toElementId: string }
```

**Events** (each includes `timestamp: number` and `userId: string`):
- `ElementCreated` — payload: full Element
- `ElementMoved` — payload: `{ id, x, y }`
- `ElementResized` — payload: `{ id, width, height }`
- `ElementUpdated` — payload: `{ id, text }`
- `ArrowCreated` — payload: full Arrow

## Intentional Tradeoffs (do not change without discussion)

- **Last-write-wins** for conflict resolution — no CRDTs, no OT
- **Text editing replaces the full string** — no cursor sync
- **No freehand drawing** — only structured shapes
- **Arrows connect by element ID** — no complex path routing
- **In-memory state** — no persistence requirement for MVP
- **No authentication** — userId is a mocked string

## Development Approach

This project follows a **spec-driven loop**:
1. Define a precise spec (inputs, outputs, edge cases)
2. Write tests covering edge cases first
3. Implement the minimal solution
4. Refactor only after tests pass

Before implementing anything: ask clarifying questions, surface edge cases, and get spec sign-off. Do not jump ahead.

Prefer pure functions. Keep modules small and independently testable. Avoid heavy frameworks.
