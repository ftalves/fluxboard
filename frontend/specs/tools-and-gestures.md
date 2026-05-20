# Spec: Tools and Gestures

This spec defines the user-input layer: which tool is active in the toolbar, what pointer/keyboard gestures each tool understands, how those gestures produce `DiagramEvent`s, and how move/resize gestures are throttled to keep the wire from flooding.

The Konva rendering tree the gestures interact with lives in [`rendering.md`](rendering.md). The viewport conversions every gesture uses live in [`viewport.md`](viewport.md). The store that receives events lives in [`store.md`](store.md). The connection state that gates whether gestures fire at all lives in [`connection-lifecycle.md`](connection-lifecycle.md). This document is scoped to *user gesture → DiagramEvent*.

---

## Tool palette

Five tools. The toolbar is a floating component in the chrome (top-center, per [`PLAN.md`](PLAN.md) §11):

| Tool | Icon (placeholder) | Cursor | Primary gesture |
|---|---|---|---|
| `select` | ↖ | default | Click element → select. Drag → move. Transformer handles → resize. |
| `rectangle` | ▭ | crosshair | Click + drag to create. |
| `circle` | ◯ | crosshair | Click + drag to create. |
| `text` | T | text | Click to place + enter edit mode. |
| `arrow` | → | crosshair | Click source → click target. |

Switching tools cancels any in-progress gesture (an unfinished rectangle drag, a partially-placed arrow). Selection is preserved across tool changes; see [`store.md`](store.md) §"Selection vs. tool".

### State location

The active tool is **component-local React state**, not in the Zustand store. It is a UI-ephemeral concern; refreshing the page resets to `select`. The toolbar owns the state and provides it to the canvas via a small `ToolContext`.

```ts
type Tool = "select" | "rectangle" | "circle" | "text" | "arrow";
```

Tool transitions are unrestricted — any tool can be selected at any time except during a text-edit (typing into the textarea consumes keystrokes).

### Keyboard shortcuts

| Key | Effect |
|---|---|
| `V` | Switch to `select`. |
| `R` | Switch to `rectangle`. |
| `O` | Switch to `circle`. |
| `T` | Switch to `text`. |
| `A` | Switch to `arrow`. |
| `Escape` | Cancel in-progress gesture (drag, arrow source-pick, text-edit). Returns to neutral state in the current tool. Does **not** switch tools. |
| `Delete` / `Backspace` | Delete the selected element or arrow (if any). Only when no `<textarea>` has focus. |

Letter shortcuts are case-insensitive (matching Excalidraw). They are ignored while a text-edit overlay is active — the keystroke goes into the textarea instead.

---

## Gesture gating

All gestures consult the connection status (see [`connection-lifecycle.md`](connection-lifecycle.md)). When `status.kind !== "connected"`:

- The toolbar buttons appear disabled (CSS `pointer-events: none` + greyed style).
- Letter shortcuts still switch the tool (it's harmless), but `Delete` / `Backspace` and any pointer event on the stage are ignored.
- An in-progress gesture (e.g. mid-drag when the connection dropped) is **cancelled immediately**: the ghost preview is cleared, the rubber-band line removed, no event is emitted. The user must redo the action after reconnect.

When `status.kind === "connected"`, all gestures fire normally.

---

## Select tool

Default tool. Cursor is the standard arrow.

### Click on an element

Sets `selection: { kind: "element", id }`. Konva resolves the click target by the shape's `id` (rendering ensures every domain element's Konva node carries its domain id).

The Transformer attaches to the selected node and the selection ring appears (see [`rendering.md`](rendering.md) §"Selection overlay").

### Click on an arrow

Sets `selection: { kind: "arrow", id }`. The arrow re-renders with the selection stroke.

### Click on empty canvas

Sets `selection: { kind: "none" }`. The Transformer detaches.

### Drag an element (move)

Tracked entirely by the tool layer; Konva's `draggable` prop is **not** used (it bypasses our throttling). The tool listens to `mousedown` on the element, then `mousemove` / `mouseup` on the stage.

Throttle: 20 Hz. Per [`PLAN.md`](PLAN.md) §7.

```ts
const MOVE_THROTTLE_MS = 50;  // ~20 emits/sec
```

**Algorithm:**

```ts
let dragStartScreen: { x: number; y: number };
let dragStartElementPos: { x: number; y: number };
let lastEmittedAt = 0;

function onMouseDown(e) {
  if (tool !== "select") return;
  const id = e.target.id();
  if (!id) return;  // click on empty
  if (selection.kind !== "element" || selection.id !== id) setSelection({ kind: "element", id });
  dragStartScreen     = stage.getPointerPosition();
  dragStartElementPos = { x: element.x, y: element.y };
  // start tracking
}

function onMouseMove(e) {
  if (!dragging) return;
  const cur     = stage.getPointerPosition();
  const dx      = (cur.x - dragStartScreen.x) / vp.scale;
  const dy      = (cur.y - dragStartScreen.y) / vp.scale;
  const nextX   = dragStartElementPos.x + dx;
  const nextY   = dragStartElementPos.y + dy;
  // Update local Konva node position for instant feedback (writes to ref, not store)
  konvaNode.position({ x: nextX, y: nextY });
  konvaNode.getLayer().batchDraw();

  const now = Date.now();
  if (now - lastEmittedAt >= MOVE_THROTTLE_MS) {
    submitEvent({ type: "ElementMoved", id: crypto.randomUUID(), payload: { id, x: nextX, y: nextY } });
    lastEmittedAt = now;
  }
}

function onMouseUp(e) {
  if (!dragging) return;
  const cur   = stage.getPointerPosition();
  const dx    = (cur.x - dragStartScreen.x) / vp.scale;
  const dy    = (cur.y - dragStartScreen.y) / vp.scale;
  const finalX = dragStartElementPos.x + dx;
  const finalY = dragStartElementPos.y + dy;
  // Final event with terminal position
  submitEvent({ type: "ElementMoved", id: crypto.randomUUID(), payload: { id, x: finalX, y: finalY } });
  dragging = false;
}
```

Key points:

- The Konva node's `position()` is updated imperatively during drag for smooth visual feedback. The store is updated only at throttled intervals.
- Each throttled emit is a **separate event** with a new `id` — not the same event resent. The server applies them sequentially; last-write-wins on coordinates.
- On `mouseup`, a final event guarantees the terminal position is in flight even if the last throttled emit was milliseconds ago.
- The store's optimistic `applyEvent` will update its own copy of `element.x/y` after `submitEvent`. The local Konva node's position (set imperatively) may temporarily diverge from the store; the next React reconcile re-syncs from the store. In practice, the divergence is below one frame.

### Resize via Transformer

The Konva `<Transformer>` (rendered in [`rendering.md`](rendering.md) §"Transformer") fires `transform` events as the user drags a handle. The tool layer listens:

```ts
function onTransform(e) {
  const node = e.target;
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const newWidth  = node.width()  * scaleX;
  const newHeight = node.height() * scaleY;
  // Reset scale, persist as width/height (Konva convention: transform via scale, but our domain uses width/height)
  node.scaleX(1);
  node.scaleY(1);
  node.width(newWidth);
  node.height(newHeight);

  const now = Date.now();
  if (now - lastEmittedAt >= MOVE_THROTTLE_MS) {
    submitEvent({ type: "ElementResized", id: crypto.randomUUID(), payload: { id: node.id(), width: newWidth, height: newHeight } });
    lastEmittedAt = now;
  }
}

function onTransformEnd(e) {
  const node = e.target;
  submitEvent({ type: "ElementResized", id: crypto.randomUUID(), payload: { id: node.id(), width: node.width(), height: node.height() } });
}
```

For corner handles, both width and height change. For edge handles, only one dimension. Konva computes both; the emitted event always carries width *and* height (the payload schema requires both). Negative widths (drag past the opposite edge) are not allowed — Konva's transformer prevents flip by default.

The transformer also moves the element when corner/edge handles drag past the opposite anchor — this also fires an `ElementMoved` from the same gesture. The tool layer handles both event types in the same throttle/final pattern.

### Drag interaction with selection

Clicking and dragging on an unselected element should *select and then drag*. The `mousedown` handler runs the selection update synchronously before the drag starts; there is no "click to select, then click again to drag" two-step.

Dragging on empty canvas with the Select tool does **nothing** — no marquee selection in MVP.

---

## Rectangle tool

Cursor: crosshair.

### Gesture

1. `mousedown` on the stage (or on a shape — clicking on existing shapes still creates a new rectangle; this is acceptable for MVP, matches Excalidraw):
   - Record start point in world coords via `screenToWorld(stage.getPointerPosition(), vp)`.
   - Set local `creating: { kind: "rect", start, current: start }`.
2. `mousemove`:
   - Update `current = screenToWorld(stage.getPointerPosition(), vp)`.
   - Compute ghost geometry: `x = min(start.x, current.x)`, `y = min(start.y, current.y)`, `width = abs(current.x - start.x)`, `height = abs(current.y - start.y)`.
   - Render the ghost on the `overlay` layer (see [`rendering.md`](rendering.md) §"Ghost preview").
3. `mouseup`:
   - If `width < MIN_SIZE` and `height < MIN_SIZE`: snap to default-size shape centered at `start`.
   - Otherwise use the ghost geometry as-is.
   - Generate id: `crypto.randomUUID()`.
   - Submit `ElementCreated`:
     ```ts
     submitEvent({
       type: "ElementCreated",
       id: crypto.randomUUID(),
       payload: { id: shapeId, type: "rectangle", x, y, width, height },
     });
     ```
   - Clear `creating`.
   - Optionally: set `selection: { kind: "element", id: shapeId }` so the new shape is selected. **Recommend yes** — matches Excalidraw, makes "create then move" a smooth chain.
   - Optionally: switch back to `select` tool. **Recommend no** for MVP — sticky tools let users draw many rectangles quickly.

```ts
const MIN_SIZE          = 10;   // world units
const DEFAULT_RECT_SIZE = { width: 100, height: 60 };
```

### Cancel

`Escape` during a drag clears `creating` without emitting. Switching tools mid-drag has the same effect.

---

## Circle tool

Identical to the Rectangle tool except the emitted `type` is `"circle"` and `DEFAULT_CIRCLE_SIZE = { width: 80, height: 80 }` (a perfect circle by default; the drag can produce an ellipse, which is fine — the domain models both as a bbox).

The ghost is rendered as an `<Ellipse>` on the overlay layer instead of a `<Rect>`.

---

## Text tool

Cursor: text I-beam.

### Gesture

1. `mousedown` on empty canvas:
   - Compute world position from cursor.
   - Generate id, submit `ElementCreated` with default text bbox:
     ```ts
     submitEvent({
       type: "ElementCreated",
       id: crypto.randomUUID(),
       payload: { id, type: "text", x: world.x, y: world.y, width: 100, height: 24, text: "" },
     });
     ```
   - Set selection to the new element.
   - Call `beginTextEdit(id)` on the store.
   - Render the `<textarea>` overlay (see "Text editing" below) and focus it.
2. `mousedown` on an existing element (regardless of type):
   - **Ignore.** The Text tool only places new text; double-click in Select tool is the way to edit existing text.

```ts
const DEFAULT_TEXT_SIZE = { width: 100, height: 24 };
```

The empty `text: ""` is fine — the domain accepts it. The placeholder is visible only while in edit mode (the `<textarea>` shows a faint "Type here…" placeholder); the rendered Konva text for an empty string is invisible, which is acceptable since it's about to be filled in.

---

## Text editing

Triggered three ways:
1. Text tool placing a new element (auto-enters edit mode).
2. Double-click any text element in Select tool.
3. `Enter` while a text element is selected in Select tool.

### Edit lifecycle

1. **Enter:** `beginTextEdit(id)` on the store. The Konva text node hides (per [`rendering.md`](rendering.md)). An HTML `<textarea>` overlay is rendered, positioned at the element's screen-space bbox via `worldToScreen`:

   ```tsx
   <textarea
     style={{
       position: "absolute",
       left: screenPos.x + "px",
       top:  screenPos.y + "px",
       width:  element.width  * vp.scale + "px",
       height: element.height * vp.scale + "px",
       fontFamily: STYLE.fontFamily,
       fontSize:   STYLE.fontSize * vp.scale + "px",
       color:      STYLE.textFill,
       background: "transparent",
       border:     `1px dashed ${STYLE.selectionStroke}`,
       outline:    "none",
       padding:    0,
       margin:     0,
       resize:     "none",
     }}
     value={localText}
     onChange={onChange}
     onBlur={onBlur}
     autoFocus
   />
   ```

   The `<textarea>` lives outside the Konva tree (rendered in the React tree above or below the stage container). It is the only HTML element that floats above the canvas during normal use.

2. **Typing:**
   - Updates a local `localText` state in the overlay component (not the store; not the Konva node).
   - Schedules a debounced emit:
     ```ts
     const DEBOUNCE_MS = 300;
     ```
     After 300 ms of no typing, fire:
     ```ts
     submitEvent({
       type: "ElementTextUpdated",
       id: crypto.randomUUID(),
       payload: { id: elementId, text: localText },
     });
     ```
   - Each debounce-fire is a separate event with a new id.

3. **Blur / commit:**
   - Triggered by: clicking outside the textarea, pressing `Escape`, switching tools, or selecting another element.
   - Flushes the debounced emit immediately (if there is pending text not yet sent, fire one final `ElementTextUpdated`).
   - Calls `endTextEdit()` on the store. The Konva text node reappears with the committed string.

### Concurrent peer edit

If a peer's `ElementTextUpdated` arrives for the in-edit element, the store suppresses the apply (see [`store.md`](store.md) §"applyPeerEvent"). The local textarea is unaffected. On blur, the local commit overwrites the peer's change — last-write-wins.

This is documented as a deliberate tradeoff in [`PLAN.md`](PLAN.md): no cursor sync, no CRDT, no operational transform.

### Empty text on blur

If the user opens an edit on a newly placed text element and blurs with no text typed, the element survives with `text: ""`. No auto-delete. The user can delete it via `Delete` if they want.

This is a small UX quirk (empty text elements are invisible) but the alternative — auto-deleting — risks losing intent if the user briefly switched focus.

---

## Arrow tool

Cursor: crosshair.

### Gesture

Two-click sequence with hover preview between.

1. **Click source:**
   - `mousedown` on an element: record `sourceId`. Set local `creating: { kind: "arrow", sourceId }`.
   - `mousedown` on empty canvas: no-op.
2. **Hover (after source picked):**
   - On every `mousemove`, update the rubber-band line from source center to cursor (see [`rendering.md`](rendering.md) §"Arrow rubber-band").
   - If cursor is over an element: highlight it as a candidate target. If the candidate is the source itself, render the highlight in red (rejection signal); otherwise blue dashed.
3. **Click target:**
   - `mousedown` on an element other than the source: emit `ArrowCreated`:
     ```ts
     submitEvent({
       type: "ArrowCreated",
       id: crypto.randomUUID(),
       payload: { id: crypto.randomUUID(), fromElementId: sourceId, toElementId: targetId },
     });
     ```
     Clear `creating`.
   - `mousedown` on the same element (self-arrow): **rejected locally**. Show a brief red flash on the element (or just refuse with no feedback in MVP). The user must click a different target or `Escape`.
   - `mousedown` on empty canvas: cancel — clear `creating`, no event.
4. **Cancel:**
   - `Escape` clears `creating`.
   - Switching tools clears `creating`.

### Generated arrow id

The frontend generates the arrow id (UUID v4). The backend's seed validation rejects self-referencing arrows; the runtime `applyEvent` likewise rejects them. Local self-arrow rejection (step 3) avoids the round-trip and the ack-rejected rollback.

### Sticky tool

After successfully creating an arrow, the Arrow tool stays active. The user can immediately create another. Matches Excalidraw.

---

## Delete

Single keyboard handler at the room view level (not per-tool):

```ts
function onKeyDown(e) {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  if (document.activeElement?.tagName === "TEXTAREA") return;   // ignore while editing text
  const sel = useStore.getState().selection;
  if (sel.kind === "element") {
    submitEvent({
      type: "ElementDeleted",
      id: crypto.randomUUID(),
      payload: { id: sel.id },
    });
    setSelection({ kind: "none" });
  } else if (sel.kind === "arrow") {
    submitEvent({
      type: "ArrowDeleted",
      id: crypto.randomUUID(),
      payload: { id: sel.id },
    });
    setSelection({ kind: "none" });
  }
}
```

- Element delete: server-side cascade removes any arrows referencing the element (see `backend/specs/apply-event.md`). The local `applyEvent` does the same on optimistic apply. One event, full cascade.
- Arrow delete: removes only the arrow.
- Selection clears explicitly. The store's auto-clear on cascade would also handle the arrow side, but explicit is clearer.

The handler is bound to `window.addEventListener("keydown", ...)` in the room view's `useEffect`. It is removed on unmount.

---

## Pan and zoom interaction with tools

Pan (middle-mouse drag) and zoom (Ctrl + wheel) are **always active**, regardless of the current tool. They are handled at the stage level by a separate set of listeners that:

- For pan: capture middle-button events and prevent them from reaching tool-specific handlers.
- For zoom: capture wheel events with the Ctrl modifier.

Tool gestures use left-button events (`button === 0`) exclusively. Right-button events (`button === 2`) are ignored to avoid conflicting with browser context menus; future right-click menus may be wired in a new spec.

If a pan starts mid-gesture (e.g. user is drawing a rectangle and middle-clicks), the pan takes over: the in-progress drag is paused (`creating` state retained, but mousemove updates are deferred to the pan). On middle-button release, the next left-button mousemove resumes the rectangle drag from the new pointer position. This is fine — the start point is in world coords, which the pan does not change.

---

## Throttling summary

| Gesture | Throttle | Final-on-release? |
|---|---|---|
| Move (Select drag) | 50 ms (~20 Hz) | Yes |
| Resize (Transformer) | 50 ms (~20 Hz) | Yes |
| Rectangle/Circle drag-create | none (no events fire mid-drag; ghost is local) | One `ElementCreated` on mouseup |
| Arrow rubber-band | none (no events fire; rubber-band is local) | One `ArrowCreated` on target click |
| Text edit | 300 ms debounce + flush on blur | Yes |

Throttle constants in `frontend/src/tools/constants.ts`:

```ts
export const MOVE_THROTTLE_MS = 50;
export const TEXT_DEBOUNCE_MS = 300;
export const MIN_SIZE         = 10;
export const DEFAULT_RECT_SIZE   = { width: 100, height: 60  };
export const DEFAULT_CIRCLE_SIZE = { width: 80,  height: 80  };
export const DEFAULT_TEXT_SIZE   = { width: 100, height: 24  };
```

---

## Invariants

- **One in-progress gesture at a time per tool.** A drag, an arrow source-pick, or a text edit. Tool changes cancel any active gesture cleanly.
- **No event is emitted while the connection is not `connected`.** All `submitEvent` calls from gesture handlers are gated.
- **Every throttled emit is a fresh event id.** Throttling is for rate-limiting wire traffic, not for replacing prior events. The server applies them sequentially.
- **The Konva node's imperative position during drag may temporarily diverge from the store.** The next React reconcile syncs them. The divergence is bounded by one render frame.
- **`crypto.randomUUID()` is the sole source of event and element ids.** No counters, no auto-incrementing.
- **`Delete` / `Backspace` is a no-op while a textarea has focus.** The keypress goes to the textarea instead. This is checked at handler-entry, not via `stopPropagation` on the textarea (browser focus is the source of truth).

---

## Out of scope (MVP)

- Multi-select: marquee, shift-click, group operations. Selection is single-kind in [`store.md`](store.md).
- Copy / cut / paste. No clipboard integration.
- Duplicate (`Cmd-D`). No.
- Group / ungroup. No grouping primitive.
- Z-order changes (bring forward, send back). Domain has no z-order.
- Snapping (to grid, to shapes, to alignment guides).
- Resize from any handle to maintain aspect ratio (`Shift` modifier). Both axes are independent.
- Constrain-to-axis when moving (`Shift`-drag).
- Arrow endpoint repositioning (drag a placed arrow's end to a new element). To change endpoints, delete + recreate.
- Curved or orthogonal arrow routing.
- Right-click context menus.
- Toolbar customization, custom shortcuts.
- Mobile / touch / pen input.
- Pressure-sensitive freehand drawing.
- Element rotation gestures.
- Tool that does not exist in domain (e.g. line, freehand, image upload).
