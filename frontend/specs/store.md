# Spec: Store

This spec defines the frontend's Zustand store: its slices, the identity bootstrap, optimistic event application, pending-event tracking with per-type rollback, and the merge rules for peer events. The store is the single seam through which the rest of the app reads diagram state and submits changes.

The store does **not** open WebSockets — that is [`wire-client.md`](wire-client.md). It does **not** decide reconnect policy — that is [`connection-lifecycle.md`](connection-lifecycle.md). It does **not** render Konva nodes — that is [`rendering.md`](rendering.md). It does **not** hold viewport pan/zoom — that is [`viewport.md`](viewport.md). Tool-state (which tool is active, drag-in-progress geometry) is **component-local**, not in the store, per [`PLAN.md`](PLAN.md) §4. This document covers domain state, identity, pending events, and selection only.

---

## Store shape

```ts
import type { DiagramState, DiagramEvent, Element, Arrow } from "@fluxboard/domain";

type Selection =
  | { kind: "none" }
  | { kind: "element"; id: string }
  | { kind: "arrow";   id: string };

type PendingEvent = {
  event: DiagramEvent;
  sentAt: number;          // Date.now() when handed to the wire client
};

type ConnectionStatus =
  | { kind: "connecting";  attempt: number }
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

type StoreState = {
  // identity
  userId: string;

  // domain
  diagram: DiagramState;
  pendingEvents: Record<string, PendingEvent>;
  textEditingElementId: string | null;

  // ui
  selection: Selection;
  roomId: string | null;
  connection: ConnectionStatus;

  // actions
  submitEvent: (event: DiagramEvent) => void;
  applyAck: (eventId: string, status: AckStatus) => void;
  applyPeerEvent: (event: DiagramEvent) => void;
  hydrateFromSync: (roomId: string, state: { elements: Record<string, Element>; arrows: Record<string, Arrow> }) => void;
  setSelection: (s: Selection) => void;
  setConnection: (c: ConnectionStatus) => void;
  beginTextEdit: (id: string) => void;
  endTextEdit: () => void;
};

type AckStatus = "applied" | "duplicate" | "rejected";
```

The store is a single Zustand store, not multiple stores. Selectors keep re-renders narrow. There is no immer; the action implementations build new state explicitly to keep the shared `applyEvent` from `@fluxboard/domain` the only mutation primitive for `diagram`.

---

## Identity

```ts
const USER_ID_KEY = "fluxboard.userId";

function loadOrMintUserId(): string {
  const existing = localStorage.getItem(USER_ID_KEY);
  if (existing && existing.length > 0) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(USER_ID_KEY, fresh);
  return fresh;
}
```

`userId` is read once at store construction and never reassigned. It is mocked-auth — the backend does not validate format (`backend/specs/wire-protocol.md` §"join"). UUID v4 from `crypto.randomUUID()` provides enough entropy that two browsers will not collide.

`localStorage` access is wrapped in a try/catch in the actual implementation — private-browsing modes can throw on write. On failure, an in-memory fallback is used (a module-scoped variable). This is a quality-of-life detail, not a correctness requirement.

---

## Initial state

```ts
const initialState: Omit<StoreState, "userId"> = {
  diagram: { elements: {}, arrows: {}, processedEventIds: {} },
  pendingEvents: {},
  textEditingElementId: null,
  selection: { kind: "none" },
  roomId: null,
  connection: { kind: "connecting", attempt: 0 },
  // actions omitted
};
```

The store is constructed once per page load. `<HomeView>` and `<NotFoundView>` reset `roomId`, `selection`, `connection`, and `diagram` via the `hydrateFromSync` action (with an empty state when no sync has arrived). `userId` survives.

---

## `submitEvent` — optimistic apply

The single entry point for user-driven changes. The tool layer (see [`tools-and-gestures.md`](tools-and-gestures.md)) calls `submitEvent` when a gesture commits an event.

```ts
submitEvent: (event) => {
  // Stamp envelope fields. The id is the correlation token.
  const stamped: DiagramEvent = {
    ...event,
    id:        event.id ?? crypto.randomUUID(),
    timestamp: Date.now(),
    userId:    get().userId,
  };

  // Apply locally first (optimistic).
  set((s) => ({
    diagram: applyEvent(s.diagram, stamped),
    pendingEvents: { ...s.pendingEvents, [stamped.id]: { event: stamped, sentAt: Date.now() } },
  }));

  // Hand to the wire layer. Externally injected — the store does not import wire.
  wireBridge.send(stamped);
};
```

- The `id` is generated client-side. The wire layer forwards it verbatim; the server preserves it (`backend/specs/wire-protocol.md` §"Server-side stamping").
- Optimistic apply uses the same `applyEvent` the backend uses, so the local state is bit-identical to what the server will produce (provided the server accepts).
- `timestamp` and `userId` are placeholders that the server overwrites. The local copy retains the placeholder values; that has no semantic effect — `applyEvent` does not depend on them.
- `wireBridge` is a tiny module-scoped indirection (set up at `<RoomView>` mount) that connects the store to the wire client without creating a circular import.

### Concurrent submits

The store does no locking. Two `submitEvent` calls in the same JS tick simply produce two events with distinct ids. The wire client serializes them onto the socket; the server orders them by receive time.

---

## `applyAck` — server confirmation

```ts
applyAck: (eventId, status) => {
  const pending = get().pendingEvents[eventId];
  if (!pending) return; // already cleared, or never existed

  if (status === "applied" || status === "duplicate") {
    set((s) => {
      const next = { ...s.pendingEvents };
      delete next[eventId];
      return { pendingEvents: next };
    });
    return;
  }

  // status === "rejected": run rollback
  rollback(pending.event);
  set((s) => {
    const next = { ...s.pendingEvents };
    delete next[eventId];
    return { pendingEvents: next };
  });
};
```

`applied` and `duplicate` are equivalent for state purposes (the spec mandates this; see `backend/specs/wire-protocol.md` §"event"). Both just drop the pending entry.

`rejected` means the server refused to apply the event. The local store applied it optimistically, so we must undo the optimistic effect. The rollback table below specifies how.

---

## Rollback table

When a server `ack` says `rejected`, the local state has diverged from the server. The frontend reconciles by undoing the optimistic effect. Per [`PLAN.md`](PLAN.md) §10:

| Event type | Rollback action |
|---|---|
| `ElementCreated` | Remove the element from `diagram.elements`. Also remove any arrows that referenced it (cascade), and clear the selection if it pointed at the removed element. |
| `ElementMoved` | Remove the element. (A rejection on move implies the element was deleted server-side; the local copy is a zombie.) |
| `ElementResized` | Remove the element. (Same rationale as move.) |
| `ElementTextUpdated` | Remove the element. (Same rationale.) |
| `ElementDeleted` | No-op. (The server rejecting a delete means the element was already gone or never existed; the local delete already removed it. State is correct.) |
| `ArrowCreated` | Remove the arrow from `diagram.arrows`. |
| `ArrowDeleted` | No-op. (Same as `ElementDeleted` rationale.) |

```ts
function rollback(event: DiagramEvent): void {
  switch (event.type) {
    case "ElementCreated":
    case "ElementMoved":
    case "ElementResized":
    case "ElementTextUpdated": {
      const id = event.type === "ElementCreated" ? event.payload.id : event.payload.id;
      set((s) => {
        const elements = { ...s.diagram.elements };
        delete elements[id];
        const arrows = Object.fromEntries(
          Object.entries(s.diagram.arrows).filter(
            ([, a]) => a.fromElementId !== id && a.toElementId !== id,
          ),
        );
        const selection = clearSelectionIfMatches(s.selection, id, "element", arrows);
        return { diagram: { ...s.diagram, elements, arrows }, selection };
      });
      return;
    }
    case "ArrowCreated": {
      const id = event.payload.id;
      set((s) => {
        const arrows = { ...s.diagram.arrows };
        delete arrows[id];
        const selection = clearSelectionIfMatches(s.selection, id, "arrow", arrows);
        return { diagram: { ...s.diagram, arrows }, selection };
      });
      return;
    }
    case "ElementDeleted":
    case "ArrowDeleted":
      return; // no-op
  }
}

function clearSelectionIfMatches(
  sel: Selection,
  id: string,
  kind: "element" | "arrow",
  arrowsAfter: Record<string, Arrow>,
): Selection {
  if (sel.kind === "element" && kind === "element" && sel.id === id) return { kind: "none" };
  if (sel.kind === "arrow"   && kind === "arrow"   && sel.id === id) return { kind: "none" };
  if (sel.kind === "arrow"   && !arrowsAfter[sel.id]) return { kind: "none" }; // arrow cascaded
  return sel;
}
```

Rollback does **not** call `applyEvent`. It mutates the state directly. There is no inverse-event in the domain layer; constructing one would risk drift from the actual rejection cause.

The cascade in `ElementCreated`/`Moved`/`Resized`/`TextUpdated` rollbacks (remove arrows referencing the removed element) mirrors `applyEvent`'s `ElementDeleted` handler. It is unlikely to fire in practice — these rollbacks only run when the element was created locally and then rejected; arrows referencing it would have to have been created in the same local session against a not-yet-acked element. Defensive correctness.

---

## `applyPeerEvent` — merge a broadcast from a peer

```ts
applyPeerEvent: (event) => {
  // §16: in-edit text suppression
  if (
    event.type === "ElementTextUpdated" &&
    get().textEditingElementId === event.payload.id
  ) {
    return; // skip apply; local textarea wins until blur
  }

  set((s) => {
    const nextDiagram = applyEvent(s.diagram, event);
    const nextSelection = clearSelectionIfDeleted(s.selection, event, nextDiagram);
    return { diagram: nextDiagram, selection: nextSelection };
  });
};

function clearSelectionIfDeleted(
  sel: Selection,
  event: DiagramEvent,
  after: DiagramState,
): Selection {
  if (sel.kind === "element") {
    return after.elements[sel.id] ? sel : { kind: "none" };
  }
  if (sel.kind === "arrow") {
    return after.arrows[sel.id] ? sel : { kind: "none" };
  }
  return sel;
}
```

- The shared `applyEvent` does idempotency via `processedEventIds`; a duplicate broadcast is silently no-op'd.
- `ElementDeleted` from a peer triggers the same cascade as a local delete — `applyEvent` handles it. The selection-clear afterwards covers both direct and cascade removals.
- For `ElementMoved` / `Resized` on an element the local user is currently dragging, **the peer event is still applied** per [`PLAN.md`](PLAN.md) §16. The next throttled local emit re-asserts the local position. Visual jitter under contention is accepted as informative LWW behavior. This is *not* implemented as a special case in `applyPeerEvent`; it is the absence of a special case — the apply just runs.

---

## `hydrateFromSync` — wholesale state replacement

```ts
hydrateFromSync: (roomId, state) => {
  set({
    roomId,
    diagram: {
      elements: { ...state.elements },
      arrows:   { ...state.arrows   },
      processedEventIds: {},
    },
    pendingEvents: {},
    selection: { kind: "none" },
    textEditingElementId: null,
  });
};
```

Called by the lifecycle controller on every `sync`. Per [`connection-lifecycle.md`](connection-lifecycle.md) §"`onSync`":

- `pendingEvents` cleared — pre-sync optimistic state is abandoned.
- `selection` cleared — the selected id may not exist in the new state.
- `textEditingElementId` cleared — even if the element survived, the textarea would now be syncing against a different state baseline.
- `processedEventIds` reset to `{}` — the server's processed-ids set is internal to it; the local one only matters for the local `applyEvent` to dedupe between optimistic apply and the eventual peer broadcast. Since peers never broadcast back to the sender (skip-sender rule), local dedupe is only relevant for repeated own-events, which would have the same id and be handled by `applyEvent` naturally.

---

## Selection

```ts
setSelection: (selection) => set({ selection });
```

Selection lives in the store because multiple components observe it: the canvas (to draw the selection ring), the toolbar (to enable delete behavior on keyboard), the text-edit overlay (to render only when the selected element matches the in-edit id).

Selection clears automatically in three cases:
1. The selected element/arrow is removed by an `applyPeerEvent`.
2. The selected element/arrow is removed by a `rollback`.
3. The store is hydrated via `hydrateFromSync`.

It does **not** auto-clear when the user submits an `ElementDeleted` themselves — the tool layer is expected to call `setSelection({ kind: "none" })` as part of the delete gesture.

### Selection vs. tool

The active tool (Select, Rectangle, Circle, Text, Arrow) is **not** in the store. It is component-local state in the toolbar / canvas tree. Tools are a UI concern; switching tools does not change any persistable state. See [`tools-and-gestures.md`](tools-and-gestures.md) §"State location".

The store's selection is independent of the tool: switching to the Rectangle tool does not deselect; switching back to Select preserves the previous selection. Selection clears only when the selected entity ceases to exist or when the canvas is clicked on empty space (a tool-layer responsibility that calls `setSelection`).

---

## Text-editing flag

```ts
beginTextEdit: (id) => set({ textEditingElementId: id });
endTextEdit:   ()   => set({ textEditingElementId: null });
```

The flag exists so that:

1. `applyPeerEvent` can suppress `ElementTextUpdated` for the in-edit element (§"applyPeerEvent" above).
2. The text-overlay component can render conditionally without subscribing to selection alone (selecting a text element does not start editing).
3. The keyboard handler can ignore `Delete`/`Backspace` while a textarea has focus (handled in [`tools-and-gestures.md`](tools-and-gestures.md), but the flag is the gate).

At most one element is in edit mode at a time. Calling `beginTextEdit` while another id is active overwrites — the prior textarea component is responsible for committing its current text (debounced emit + blur) before yielding focus.

---

## `setConnection`

```ts
setConnection: (connection) => set({ connection });
```

Called only by the lifecycle controller. The store holds the connection status so any component can render based on it (the toolbar disables itself; the canvas hides the cursor; the chrome shows the badge).

The store does **not** read or compute `connection`; the controller is the source of truth for what state the connection is in. The store is dumb persistence.

---

## Pending event lifecycle

A pending event lives through these phases:

```
submitEvent ──▶ pendingEvents[id] set, optimistic state applied
                                  │
                                  ├── applyAck "applied"   ──▶ pending cleared, no state change
                                  ├── applyAck "duplicate" ──▶ pending cleared, no state change
                                  ├── applyAck "rejected"  ──▶ rollback runs, pending cleared
                                  ├── onError invalid_event with eventId ──▶ rollback runs, pending cleared
                                  └── hydrateFromSync       ──▶ all pending cleared, no rollback
                                                                  (state is replaced wholesale)
```

The ack-timeout in [`connection-lifecycle.md`](connection-lifecycle.md) §"Ack timeout" enforces an upper bound on how long an event can stay pending: 10 s. If exceeded, the lifecycle forces a reconnect, which triggers `hydrateFromSync`, which clears the pending map.

`onError` with `code: "invalid_event"` and an `eventId` reuses the rollback path. The wire client looks up the pending entry and calls into the store's rollback (technically: it calls `applyAck(eventId, "rejected")` — semantically identical to a rejected ack since the event was never applied server-side).

---

## Wire bridge

The store cannot import the wire client (it would create a circular import: wire → store-callbacks → store → wire). Instead, the store exposes a setter for an injected sender:

```ts
let wireBridge = {
  send: (_event: DiagramEvent) => {
    // no-op until <RoomView> wires it up
  },
};

export function setWireBridge(send: (event: DiagramEvent) => void) {
  wireBridge.send = send;
}
```

`<RoomView>` calls `setWireBridge` on mount with the wire client's `send`. On unmount it resets to the no-op. Components calling `submitEvent` during a disconnect get a silent drop, which is the desired behavior (per [`connection-lifecycle.md`](connection-lifecycle.md), edits are blocked at the tool layer too, so this should not fire in practice).

The wire client, going the other direction, does not import the store — the lifecycle controller is the one component that ties the two together via callbacks. The store is event-sink for the lifecycle, not directly for the wire.

---

## Selectors

For React component consumers, the store exposes hooks like:

```ts
const useDiagram        = () => useStore((s) => s.diagram);
const useElements       = () => useStore((s) => s.diagram.elements);
const useElement        = (id: string) => useStore((s) => s.diagram.elements[id]);
const useArrows         = () => useStore((s) => s.diagram.arrows);
const useSelection      = () => useStore((s) => s.selection);
const useConnection     = () => useStore((s) => s.connection);
const useTextEditingId  = () => useStore((s) => s.textEditingElementId);
```

These are the primary read surface. Components that need multiple slices use `shallow` equality from Zustand to avoid re-rendering on unrelated changes.

The toolbar consumes `useConnection` to know when to grey out. The canvas consumes `useElements` + `useArrows`. The text overlay consumes `useTextEditingId` + the matching `useElement(id)`.

---

## Invariants

- **`applyEvent` is the only function that mutates `diagram` on the apply path.** Rollback and hydrate construct new state directly because there is no inverse domain function; everything else routes through `applyEvent` so local and server states agree.
- **`pendingEvents[id]` exists iff the event has been submitted but not yet acked, rolled back, or cleared by sync.** No orphans.
- **Selection points only at existing entities.** Any code path that removes an element/arrow checks `selection` and clears it if it matches.
- **`textEditingElementId` is either `null` or refers to an existing text element in `diagram.elements`.** A hydrate-sync clears it; a peer or local delete of the element clears it (the text overlay component observes the element's existence and tears itself down).
- **`userId` is stable for the lifetime of the page.** Reading it twice yields the same value.
- **The store contains no Konva references, no DOM nodes, no React refs.** It is plain data. Tests construct it in node without jsdom (the store-only tests do not need a DOM).

---

## Out of scope (MVP)

- Selectors derived from `applyEvent` (e.g. "elements connected to this one"). Components compute these inline; if it becomes a perf bottleneck, memoized selectors will be added in a new spec.
- Multi-selection. The `Selection` union is single-kind by design.
- Undo/redo. Per [`PLAN.md`](PLAN.md) §12, undo is out of scope MVP — no inverse-event stack is maintained.
- Per-user view of "who created what". `event.userId` is captured in the event stream but the store does not index by user.
- Time-travel debugging. The Redux DevTools middleware is not wired; the store is opaque to external inspection beyond `JSON.stringify(get())`.
- Persisting the store to `localStorage` for offline-first behavior. The store is in-memory only; a reload re-syncs from the server.
- Selectors that return computed bounding boxes, arrow paths, or rendered geometry. Those live in [`rendering.md`](rendering.md).
