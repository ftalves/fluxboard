# Spec: applyEvent

## Signature

```ts
applyEvent(state: DiagramState, event: DiagramEvent): DiagramState
```

Returns a new `DiagramState`. Never mutates the input state.

---

## Types

```ts
type DiagramState = {
  elements: Record<string, Element>;
  arrows: Record<string, Arrow>;
  processedEventIds: Record<string, true>;  // for idempotency
};

type Element = {
  id: string;
  type: "rectangle" | "circle" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};

type Arrow = {
  id: string;
  fromElementId: string;
  toElementId: string;
};

// All events include:
//   id: string         (unique; used for idempotency)
//   timestamp: number  (unix ms)
//   userId: string     (mocked; not validated)

type DiagramEvent =
  | ElementCreatedEvent
  | ElementMovedEvent
  | ElementResizedEvent
  | ElementTextUpdatedEvent
  | ElementDeletedEvent
  | ArrowCreatedEvent
  | ArrowDeletedEvent;
```

---

## Idempotency

Before applying any event, check `state.processedEventIds[event.id]`.

- If present → return `state` unchanged (no-op).
- If absent → apply the event, then add `event.id` to `processedEventIds` in the returned state.

This applies to **all** event types without exception.

---

## Event Behaviors

### ElementCreated

**Payload:** full `Element` object (id, type, x, y, width, height, text?)

**Behavior:** Upserts the element into `state.elements` keyed by `element.id`.

- If an element with the same `id` already exists, it is overwritten (last-write-wins).
- `arrows` is unchanged.

| Scenario | Result |
|---|---|
| Duplicate element `id` | Overwrites existing element |

---

### ElementMoved

**Payload:** `{ id: string; x: number; y: number }`

**Behavior:** Updates `x` and `y` on the matching element. All other fields unchanged.

- If `id` does not exist in `state.elements` → silent no-op.
- `arrows` is unchanged.

| Scenario | Result |
|---|---|
| Unknown `id` | No-op, state returned as-is |
| Negative coordinates | Accepted as-is (no validation) |

---

### ElementResized

**Payload:** `{ id: string; width: number; height: number }`

**Behavior:** Updates `width` and `height` on the matching element. All other fields unchanged.

- If `id` does not exist in `state.elements` → silent no-op.
- `arrows` is unchanged.

| Scenario | Result |
|---|---|
| Unknown `id` | No-op, state returned as-is |
| Zero or negative dimensions | Accepted as-is (no validation) |

---

### ElementTextUpdated

**Payload:** `{ id: string; text: string }`

**Behavior:** Updates only the `text` field on the matching element. Text replaces the full string — no diffing or cursor sync. All other fields unchanged.

- If `id` does not exist in `state.elements` → silent no-op.
- `arrows` is unchanged.

| Scenario | Result |
|---|---|
| Unknown `id` | No-op, state returned as-is |
| Empty string `""` | Accepted — element's `text` is set to `""` |
| Element with no prior `text` | `text` field is set for the first time |

---

### ElementDeleted

**Payload:** `{ id: string }`

**Behavior:** Removes the element from `state.elements`. Also removes any arrow where `fromElementId === id` or `toElementId === id`.

- If `id` does not exist in `state.elements` → silent no-op (nothing to delete; no arrow cleanup either).

| Scenario | Result |
|---|---|
| Unknown `id` | No-op, state returned as-is |
| Element has associated arrows | All arrows referencing that element are removed |
| Element has no arrows | Only the element is removed |

---

### ArrowCreated

**Payload:** full `Arrow` object (id, fromElementId, toElementId)

**Behavior:** Upserts the arrow into `state.arrows` keyed by `arrow.id`.

- If `fromElementId` or `toElementId` does not exist in `state.elements` → silent no-op.
- If an arrow with the same `id` already exists, it is overwritten (last-write-wins).
- `elements` is unchanged.

| Scenario | Result |
|---|---|
| `fromElementId` not in elements | No-op, state returned as-is |
| `toElementId` not in elements | No-op, state returned as-is |
| Duplicate arrow `id` (both elements exist) | Overwrites existing arrow |
| Self-referencing arrow (`from === to`, element exists) | Accepted as-is |

---

### ArrowDeleted

**Payload:** `{ id: string }`

**Behavior:** Removes the arrow from `state.arrows`.

- If `id` does not exist in `state.arrows` → silent no-op.
- `elements` is unchanged.

| Scenario | Result |
|---|---|
| Unknown arrow `id` | No-op, state returned as-is |

---

## General Invariants

- **Pure function:** `applyEvent` must not mutate `state` or `event`. Returns a new object.
- **Unknown event type:** Return state unchanged.
- **No side effects:** No I/O, no logging, no event emission.
- **userId / timestamp:** Carried on the event but do not affect transformation logic.
- **No input validation:** Coordinates, dimensions, and type values are not validated.

---

## Out of Scope (MVP)

- Validation of coordinates, dimensions, or element type values
- Referential integrity enforcement beyond arrow cleanup on element delete
