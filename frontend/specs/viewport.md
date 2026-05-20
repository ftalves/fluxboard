# Spec: Viewport

This spec defines the camera over the canvas: pan via middle-mouse drag, zoom via Ctrl+wheel anchored on the cursor, the coordinate system used by domain state versus screen state, and how the viewport interacts with the rendering layer.

The Konva `<Stage>` structure and shape rendering live in [`rendering.md`](rendering.md). Tool gestures (which use viewport conversions to land shapes in the right place) live in [`tools-and-gestures.md`](tools-and-gestures.md). This document is scoped to *where the camera is, how it moves, and how to convert between coordinate spaces*.

---

## Coordinate spaces

Two coordinate systems coexist:

| Space | Origin | Units | Used by |
|---|---|---|---|
| **World** | Diagram (0,0). Persistent across zoom and pan. | Logical pixels — `width: 100` means "100 units" regardless of zoom. | Domain state: every `Element.x/y/width/height` is in world space. Every `DiagramEvent` payload is in world space. |
| **Screen** | Top-left of the Konva stage container `<div>`. | CSS pixels at the current device pixel ratio. | Pointer events (`event.clientX/Y`), Konva `Stage` size, the HTML `<textarea>` overlay's position during text editing. |

Conversion is a single affine transform stored in the viewport slice:

```
screen = (world * scale) + offset
world  = (screen - offset) / scale
```

`scale` and `offset` are the viewport's state; everything else is derived.

---

## Viewport state

```ts
type Viewport = {
  scale: number;       // 0.1 .. 5.0; default 1.0
  offset: { x: number; y: number }; // screen-space translation; default (0, 0)
};
```

Stored in component-local React state at the top of the room view (or in a small Zustand slice if multiple non-canvas components need it — none in MVP). It is **not** in the main Zustand store; it is **not** in the domain layer. It is ephemeral.

| Concern | Decision |
|---|---|
| Persisted across page reload? | No. In-memory only. |
| Synced across peers? | No. Each user has their own camera. |
| Survives reconnect / `sync`? | Yes — the camera is unrelated to domain state. |
| Survives tool change? | Yes. |

Default after mount: `scale = 1.0`, `offset = (0, 0)`. The diagram's `(0, 0)` is the top-left of the canvas.

---

## Pan

**Gesture:** hold middle mouse button (mouse button index 1) and drag.

**Behavior:**

1. On `mousedown` with `event.button === 1`:
   - Record the initial pointer position in screen space.
   - Record the current `offset`.
   - Set a local `isPanning: true` flag (component-local; not in any store).
   - Call `event.preventDefault()` to suppress the browser's middle-click auto-scroll cursor.
2. On `mousemove` while `isPanning`:
   - Compute `delta = currentScreenPos - initialScreenPos`.
   - Set `offset = initialOffset + delta`.
3. On `mouseup` with `event.button === 1` OR on `mouseleave`:
   - Clear `isPanning`.

Pan is a pure offset update — `scale` is unchanged. The Konva `<Stage>` re-renders with the new offset on each mousemove; no per-shape work is needed.

### Edge: pointer leaves window

If the user drags the middle button out of the browser window and releases there, no `mouseup` is delivered. The fallback is a `mouseleave` on the container `<div>` that clears `isPanning`. The state diverges slightly from the user's intent (the pan stops early) but does not get stuck.

### Edge: middle-click on a shape

The middle-click pan handler is attached to the stage's container, not to individual Konva shapes. The handler runs regardless of what shape is under the cursor. Konva's per-shape pointer handlers run only on left-click (button `0`).

---

## Zoom

**Gesture:** hold `Ctrl` (or `Cmd` on macOS — `event.ctrlKey || event.metaKey`) and scroll the wheel.

**Behavior:**

1. On `wheel` with `event.ctrlKey || event.metaKey`:
   - Call `event.preventDefault()` to suppress the browser's page zoom.
   - Compute new scale: `nextScale = clamp(currentScale * factor, 0.1, 5.0)` where `factor = event.deltaY < 0 ? 1.1 : 1 / 1.1`.
   - Anchor the zoom on the cursor (see "Zoom anchor" below).
2. On `wheel` without modifier: **ignore**. Do not pan vertically; do not zoom. The page does not scroll either, because the room view fills the viewport and has no overflow.

### Zoom anchor

The cursor's world coordinate must stay fixed across the scale change. This is what makes pinch-zoom feel natural in Figma/Excalidraw.

Algorithm:

```ts
function zoomAt(screenPoint: { x: number; y: number }, nextScale: number, currentViewport: Viewport): Viewport {
  // World point under the cursor before the zoom.
  const worldBefore = {
    x: (screenPoint.x - currentViewport.offset.x) / currentViewport.scale,
    y: (screenPoint.y - currentViewport.offset.y) / currentViewport.scale,
  };

  // After applying the new scale, find the offset that keeps worldBefore mapped to screenPoint.
  return {
    scale: nextScale,
    offset: {
      x: screenPoint.x - worldBefore.x * nextScale,
      y: screenPoint.y - worldBefore.y * nextScale,
    },
  };
}
```

The wheel handler calls `setViewport(zoomAt(cursorScreen, clamp(currentScale * factor), currentViewport))`.

### Zoom bounds

- Minimum: `0.1` (shapes are 10% of their world size — very zoomed out).
- Maximum: `5.0` (shapes are 5× their world size — very zoomed in).

Clamping happens before `zoomAt` recomputes the offset, so at the limit the cursor anchor is still respected; further wheel events at the bound are no-ops.

### Wheel direction

`deltaY < 0` (wheel rolled forward, typical "zoom in") multiplies scale by `1.1`. `deltaY > 0` divides by `1.1`. This matches macOS and Windows defaults; the frontend does not honor "natural scrolling" inversion settings.

`deltaX` is ignored. Horizontal wheel scrolling on trackpads might be common, but in MVP the only wheel binding is zoom-with-modifier; without the modifier, all wheel events are dropped.

---

## Conversion utilities

Centralized in `frontend/src/canvas/coords.ts`:

```ts
export function screenToWorld(screen: { x: number; y: number }, vp: Viewport): { x: number; y: number } {
  return {
    x: (screen.x - vp.offset.x) / vp.scale,
    y: (screen.y - vp.offset.y) / vp.scale,
  };
}

export function worldToScreen(world: { x: number; y: number }, vp: Viewport): { x: number; y: number } {
  return {
    x: world.x * vp.scale + vp.offset.x,
    y: world.y * vp.scale + vp.offset.y,
  };
}

export function stagePointerWorld(stage: Konva.Stage, vp: Viewport): { x: number; y: number } | null {
  const pos = stage.getPointerPosition();
  if (!pos) return null;
  return screenToWorld(pos, vp);
}
```

The third helper is a convenience for tool gesture handlers. Konva's `stage.getPointerPosition()` returns screen-space coordinates relative to the stage container's top-left, which is the same origin as our `screen` space; no extra adjustment needed.

### Where conversions happen

- **Tool gestures → domain events:** convert screen → world via `screenToWorld`. The emitted `DiagramEvent` payloads are world coordinates.
- **Domain state → Konva nodes:** rendered directly. The Konva `<Stage>` itself applies the `scale` and `offset` (`<Stage scaleX={scale} scaleY={scale} x={offset.x} y={offset.y}>`), so individual shapes use world coordinates for `x`/`y`/`width`/`height` and Konva does the transform.
- **HTML overlays (text edit, hover highlight):** convert world → screen via `worldToScreen` to position absolutely over the canvas.

The stage's built-in transform is what makes this cheap. Re-rendering after a pan is a single stage attribute change; Konva does not re-walk every shape.

---

## Resize and DPR

The Konva `<Stage>` matches the size of its container `<div>`. The container fills the room view (the canvas is fullscreen). On window resize:

1. The stage's `width` and `height` props update to match `container.clientWidth/clientHeight`.
2. `scale` and `offset` are **unchanged**. The world coordinate at screen-center may move, but the camera does not auto-adjust to "fit content" or similar.

Device pixel ratio (`window.devicePixelRatio`) is handled by Konva's internal `Stage.pixelRatio`. The frontend does not override this. Crisp rendering on retina displays is automatic; world coordinates remain pixel-DPR-independent.

---

## Reset

There is a zoom indicator in the chrome (per [`PLAN.md`](PLAN.md) §11) at the bottom-right that shows `Math.round(scale * 100)%`. Clicking it resets `scale = 1.0` and `offset = (0, 0)` — back to identity transform.

No keyboard shortcut for reset in MVP. The button is the only entry point.

---

## Interactions with rendering

The rendering layer (see [`rendering.md`](rendering.md)) reads `viewport.scale` for two non-transform purposes:

1. **Hit-stroke padding on arrows.** Arrows have a configured `hitStrokeWidth` that scales inversely with zoom so the click area stays a constant ~10px in screen space.
2. **Selection ring stroke width.** Similarly inverted so the ring is always ~2px on screen, regardless of zoom.
3. **Transformer handle size.** Konva's `<Transformer>` exposes an `ignoreStroke` and `anchorSize` prop; rendering passes `anchorSize: 8 / scale` so handles stay ~8px on screen.

These are read concerns; the viewport spec only defines `scale` itself. The compensations live in `rendering.md`.

---

## Invariants

- **`scale ∈ [0.1, 5.0]` at all times.** Clamping happens at the only mutation site (the zoom handler).
- **`offset` is unconstrained.** The user can pan arbitrarily far in any direction. No "bounding box" of the diagram is enforced; if the user pans to (1e9, 1e9), shapes simply leave the visible window.
- **Pan and zoom do not change domain state.** No `DiagramEvent` is emitted. No store mutation occurs (except the viewport slice itself).
- **A `sync` from the server does not reset the viewport.** The user's camera persists across reconnects.
- **Screen↔world conversions are pure functions of `(point, Viewport)`.** No global state, no Konva refs in the math.

---

## Out of scope (MVP)

- **Zoom-to-fit / fit-content.** No "press F to frame all elements" gesture. The reset button restores identity, not a fit.
- **Smooth animated transitions.** Zoom and pan jump on each event; no easing.
- **Pinch zoom on trackpads.** Browsers emit `wheel` events with `ctrlKey: true` for trackpad pinches on most platforms, which already routes through the Ctrl+wheel handler. If a particular trackpad does not, MVP does not have a separate code path.
- **Touch input** (single-finger pan, two-finger pinch, tap). Mobile is out of scope per [`PLAN.md`](PLAN.md).
- **Mini-map** or any secondary view of the viewport.
- **Persisting viewport across page reloads** (e.g. `localStorage.fluxboard.viewport[roomId]`).
- **Per-element follow** — "double-click an element to center it". Future feature; the math (`worldToScreen` + an animated `offset` update) is trivial when needed.
- **Snap-to-grid or rulers.** No grid renders in MVP; coordinates are continuous.
