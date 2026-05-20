# Spec: Rendering

This spec defines how the diagram is drawn on the Konva canvas: the `<Stage>` / `<Layer>` tree, shape components for each domain element type, arrow geometry (edge-to-edge bbox intersect), selection overlays, hover highlights during arrow creation, the ghost preview during shape creation, and the visual constants that govern stroke/fill/font.

Tool gestures that decide *when* to render a ghost or a hover target live in [`tools-and-gestures.md`](tools-and-gestures.md). The viewport transform that controls *where* on screen the rendered world ends up lives in [`viewport.md`](viewport.md). The store that supplies the domain state lives in [`store.md`](store.md). This document is scoped to *what the canvas shows for a given store + viewport*.

---

## Konva tree

A single Konva `<Stage>` lives inside a fullscreen `<div>` in `<RoomView>`. It carries three layers, top to bottom in z-order (last rendered = top):

```
<Stage scaleX={viewport.scale} scaleY={viewport.scale} x={viewport.offset.x} y={viewport.offset.y}>
  <Layer name="shapes">     // elements + arrows + selection rings
  <Layer name="overlay">    // ghost preview, arrow-creation hover line, hover target highlight
  <Layer name="ui">         // <Transformer> handles
</Stage>
```

| Layer | Contents | Re-render trigger |
|---|---|---|
| `shapes` | Every element (`<Rect>`, `<Circle>`, `<KonvaText>`) and every arrow (`<Arrow>`), plus the inline selection outline on the currently-selected shape. | Domain state changes (store `diagram`) or selection changes. |
| `overlay` | Local-only transient drawings: the ghost shape under construction, the rubber-band line from source to cursor during arrow creation, and the dashed outline on a hover target. | Tool-local React state (drag-in-progress geometry, hover element id). |
| `ui` | The Konva `<Transformer>` attached to the currently-selected element. | Selection changes. |

Three layers (not one) so Konva can cache the `shapes` layer when only overlays move (e.g. during arrow drag the source-to-cursor line moves every frame; the shapes underneath do not). Konva's layer caching is opt-in and not enabled in MVP; the three-layer split is the prerequisite that lets us enable it later if perf demands.

---

## Shape components

Each domain element type maps to a single React component. All take an `Element` and emit Konva nodes.

### `<RectangleShape element={...} />`

```tsx
<Rect
  id={element.id}
  x={element.x}
  y={element.y}
  width={element.width}
  height={element.height}
  fill={STYLE.fill}
  stroke={STYLE.stroke}
  strokeWidth={STYLE.strokeWidth / vp.scale}
  draggable={false}      // drag is owned by the tool layer, not Konva
  listening={true}
/>
```

`strokeWidth` is divided by `vp.scale` so the on-screen stroke is constant width regardless of zoom. The viewport hook is read once per render of the canvas root and threaded down to each shape.

### `<CircleShape element={...} />`

Domain `width` and `height` define a bounding box. The rendered circle is an ellipse if `width !== height`, otherwise a true circle. Konva exposes both; using `<Ellipse>` consistently keeps the code simpler:

```tsx
<Ellipse
  id={element.id}
  x={element.x + element.width / 2}     // Konva ellipse is anchored at center
  y={element.y + element.height / 2}
  radiusX={element.width / 2}
  radiusY={element.height / 2}
  fill={STYLE.fill}
  stroke={STYLE.stroke}
  strokeWidth={STYLE.strokeWidth / vp.scale}
  listening={true}
/>
```

The domain represents both bounding box (top-left + size) and the rendering converts. This keeps the wire payloads uniform across element types.

### `<TextShape element={...} />`

```tsx
<KonvaText
  id={element.id}
  x={element.x}
  y={element.y}
  width={element.width}
  height={element.height}
  text={element.text ?? ""}
  fontSize={STYLE.fontSize}
  fontFamily={STYLE.fontFamily}
  fill={STYLE.textFill}
  listening={true}
  visible={textEditingElementId !== element.id}  // hide while overlay textarea covers it
/>
```

While the element is in edit mode (see [`tools-and-gestures.md`](tools-and-gestures.md) §"Text editing"), the Konva text is hidden — the HTML `<textarea>` overlay renders the live text instead. On blur, the overlay tears down and the Konva text reappears with the committed string.

Text does not wrap by default in MVP (`wrap: "none"`); long strings clip at the bbox right edge. This is consistent with the no-styling-fields tradeoff: the user has no way to set wrapping behavior, so we pick a single default.

---

## Arrow rendering

Arrows are line segments between two element bounding boxes. The line endpoint on each side is the intersection of the center-to-center line with the bbox edge — not the bbox center itself, which would draw the line over the shape.

### Geometry

```ts
function arrowEndpoints(from: Element, to: Element): { x1: number; y1: number; x2: number; y2: number } {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter   = { x: to.x   + to.width   / 2, y: to.y   + to.height   / 2 };
  return {
    x1: intersectBbox(fromCenter, toCenter, from).x,
    y1: intersectBbox(fromCenter, toCenter, from).y,
    x2: intersectBbox(toCenter, fromCenter, to).x,
    y2: intersectBbox(toCenter, fromCenter, to).y,
  };
}

function intersectBbox(
  inside: { x: number; y: number },
  outside: { x: number; y: number },
  box: Element,
): { x: number; y: number } {
  // Clip the segment (inside → outside) to the box's edges. Returns where it exits the box.
  // Standard Liang-Barsky or parametric clipping; for axis-aligned bboxes, the math is:
  const dx = outside.x - inside.x;
  const dy = outside.y - inside.y;
  if (dx === 0 && dy === 0) return inside;

  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const cx    = box.x + halfW;
  const cy    = box.y + halfH;

  // Parameter t along the segment from center to outside; the bbox is reached when |dx*t| === halfW OR |dy*t| === halfH.
  const tx = halfW / Math.abs(dx || 1e-9);
  const ty = halfH / Math.abs(dy || 1e-9);
  const t  = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}
```

The math assumes axis-aligned bounding boxes. Both rectangles and ellipses are clipped against their bbox, not their visual outline — a line into a circle terminates at the bounding-square edge, slightly *outside* the circle's curve. Acceptable for MVP; matches Excalidraw's behavior.

### Konva node

```tsx
<KonvaArrow
  id={arrow.id}
  points={[x1, y1, x2, y2]}
  stroke={STYLE.stroke}
  strokeWidth={STYLE.strokeWidth / vp.scale}
  fill={STYLE.stroke}                  // arrowhead fill matches stroke
  pointerLength={10 / vp.scale}
  pointerWidth={10  / vp.scale}
  pointerAtBeginning={false}           // target end only
  hitStrokeWidth={20 / vp.scale}       // padded click area
  listening={true}
/>
```

- `pointerAtBeginning: false` means only the target end has an arrowhead. The source end is a plain line endpoint.
- `hitStrokeWidth` makes the clickable area ~20 screen-pixels wide regardless of zoom, so thin 2-px arrows are still easy to select. Konva renders this as an invisible hit region; the visible stroke remains 2 px.
- The `points` array is re-derived each render from the current element coords. If a peer moves a connected element, the arrow follows automatically because `diagram.elements[id]` changed and React re-rendered the arrow.

### When an endpoint is missing

If `arrow.fromElementId` or `arrow.toElementId` is not in `diagram.elements`, the arrow is skipped (not rendered). This should never happen — `applyEvent`'s `ElementDeleted` handler removes arrows referencing the deleted element. The skip is defensive against transient inconsistency during peer apply.

---

## Selection overlay

When `selection.kind === "element"` or `"arrow"` and the entity exists, a visual ring is drawn around it on the `shapes` layer.

### Element selection

A second Konva node mirrors the selected element's geometry with no fill and a blue stroke:

```tsx
<Rect
  x={element.x}
  y={element.y}
  width={element.width}
  height={element.height}
  fill="transparent"
  stroke={STYLE.selectionStroke}
  strokeWidth={STYLE.selectionStrokeWidth / vp.scale}
  dash={STYLE.selectionDash}
  listening={false}                    // ring does not steal hit events
/>
```

For circles, the same overlay is rendered as an `<Ellipse>` mirroring the shape's bbox. The blue dashed outline appears around the shape's bounding rectangle in both cases.

For text, the same rectangle outline.

### Arrow selection

The arrow itself re-renders with `stroke={STYLE.selectionStroke}` and an extra-thick `strokeWidth`. No separate overlay. (A blue line over a black line at the same coords would not align cleanly at corners.)

### Transformer

The Konva `<Transformer>` is rendered on the `ui` layer and attached to the selected node when `selection.kind === "element"`. The transformer adds 8 drag handles (4 corners + 4 mid-edges) and a rotation handle.

```tsx
<Transformer
  nodes={selectedNode ? [selectedNode] : []}
  rotateEnabled={false}                 // rotation not in domain
  flipEnabled={false}
  anchorSize={STYLE.transformerAnchorSize / vp.scale}
  anchorStroke={STYLE.selectionStroke}
  anchorFill="white"
  borderEnabled={false}                 // the selection ring already provides a border
  ignoreStroke={true}                   // ignore the element's stroke when computing bounds
/>
```

The transformer fires `transform` / `transformend` events that the tool layer (see [`tools-and-gestures.md`](tools-and-gestures.md)) translates into `ElementResized` events. Arrow selection has no transformer (arrows have no width/height in the domain).

---

## Hover target highlight (arrow creation)

When the Arrow tool is active and a source has been selected (see [`tools-and-gestures.md`](tools-and-gestures.md) §"Arrow tool"), every element under the cursor is highlighted as a candidate target. The highlight is a thicker dashed blue outline overlaid on the `overlay` layer, similar to the selection ring but distinct:

```tsx
<Rect
  x={hoveredElement.x}
  y={hoveredElement.y}
  width={hoveredElement.width}
  height={hoveredElement.height}
  fill="transparent"
  stroke={STYLE.hoverTargetStroke}
  strokeWidth={STYLE.hoverTargetStrokeWidth / vp.scale}
  dash={STYLE.hoverTargetDash}
  listening={false}
/>
```

The source element receives a different visual marker (a solid blue outline) so the user can see which element is the anchor.

If the hovered element is the same as the source (self-arrow), the highlight is **red dashed** instead of blue, indicating the click would be rejected.

---

## Ghost preview (shape creation)

When the Rectangle or Circle tool is active and the user is dragging from the initial click point, a local-only "ghost" of the shape-being-created renders on the `overlay` layer. It is not in the store; it is component-local state.

```tsx
<Rect             // or <Ellipse> for the Circle tool
  x={ghost.x}
  y={ghost.y}
  width={ghost.width}
  height={ghost.height}
  fill="transparent"
  stroke={STYLE.ghostStroke}
  strokeWidth={STYLE.ghostStrokeWidth / vp.scale}
  dash={STYLE.ghostDash}
  listening={false}
/>
```

On mouseup, the tool layer:
1. Removes the ghost (clears the local state).
2. Calls `submitEvent(ElementCreated, { id: newId, ...ghostGeometry })`.
3. The store applies optimistically, the shape appears on the `shapes` layer.

There is no visual "swap" — the ghost disappears in the same frame the real shape appears with the same geometry.

### Arrow rubber-band

When the Arrow tool has a source selected, the overlay layer also renders a single `<Line>` from the source's center to the current cursor position (in world coords):

```tsx
<Line
  points={[sourceCenter.x, sourceCenter.y, cursorWorld.x, cursorWorld.y]}
  stroke={STYLE.ghostStroke}
  strokeWidth={STYLE.ghostStrokeWidth / vp.scale}
  dash={STYLE.ghostDash}
  listening={false}
/>
```

On target click, the line is replaced by a real `<KonvaArrow>` after the `ArrowCreated` event applies.

---

## Visual constants

All in `frontend/src/canvas/style.ts`:

```ts
export const STYLE = {
  // shapes
  fill: "transparent",
  stroke: "#111111",
  strokeWidth: 2,

  // text
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 16,
  textFill: "#111111",

  // selection
  selectionStroke: "#3b82f6",
  selectionStrokeWidth: 2,
  selectionDash: [] as number[],          // solid
  transformerAnchorSize: 8,

  // hover target (during arrow creation)
  hoverTargetStroke: "#3b82f6",
  hoverTargetStrokeWidth: 3,
  hoverTargetDash: [6, 4],

  // self-arrow rejection
  hoverTargetRejectStroke: "#dc2626",
  hoverTargetRejectDash:   [6, 4],

  // ghost (creation in progress)
  ghostStroke: "#3b82f6",
  ghostStrokeWidth: 2,
  ghostDash: [8, 4],
} as const;
```

Each constant is referenced by name everywhere in the rendering layer; no shape component hard-codes color or stroke width. This is the single seam to swap visual identity later without touching shape code.

There is no per-element styling field in the domain. Every rectangle looks identical. Every circle looks identical. Every text element uses the same font.

---

## Render data flow

For a single frame:

```
Store (diagram, selection, textEditingElementId)
    │
    ▼
RoomView reads from store via selectors
    │
    ▼
<Stage> with viewport transform applied
    │
    ├─▶ <ShapesLayer>
    │       ├─▶ for each element: <RectangleShape|CircleShape|TextShape>
    │       ├─▶ for each arrow:   <ArrowShape>
    │       └─▶ if selection: <SelectionOverlay>
    │
    ├─▶ <OverlayLayer>
    │       ├─▶ ghost preview from tool-local state (if creating)
    │       ├─▶ rubber-band line from tool-local state (if arrow source selected)
    │       └─▶ hover target highlight from tool-local state (if arrow target hovered)
    │
    └─▶ <UILayer>
            └─▶ <Transformer> attached to selected element node (if any)
```

The store is the only React-Konva read; tool-local state is plain React state in the tool components. The `viewport` slice is read at the top and threaded down via prop or a small `ViewportContext`.

### Re-render granularity

- Domain change (e.g. a peer move) re-renders the affected shape and any connected arrows. React-Konva uses node refs and reconciles based on `id`; only changed nodes re-render in Konva terms.
- Selection change re-renders the previously selected and the newly selected shapes (to add/remove the ring), plus the transformer.
- Viewport change re-renders every shape (because each shape's stroke width depends on `vp.scale`) but Konva's transform is cheap; the actual cost is mostly the stroke recompute.

There is no virtualization (only render visible elements) in MVP. The expected MVP scale (~tens of shapes) does not justify it.

---

## Pointer hit-testing

Konva does hit-testing per shape based on its rendered geometry and its `listening` prop. The frontend relies on this for:

| Event | Resolved by Konva to |
|---|---|
| `click` / `mousedown` on a rectangle, circle, or text | The shape's `id` |
| `click` on an arrow | The arrow's `id`, within the `hitStrokeWidth` padded region |
| `click` on empty canvas | The stage itself (no shape) |
| `dblclick` on text | The text element's `id` |
| `mousemove` over a candidate arrow target | The element's `id` for the hover highlight |

Overlay and UI layers have `listening={false}` on individual nodes where appropriate so that decorative outlines do not intercept clicks for the underlying shape.

---

## Empty state

When the diagram has zero elements, the canvas renders a single centered hint text on the `shapes` layer (or via an absolute-positioned HTML div over the stage):

```
Pick a tool to start drawing
```

This is purely a UX touch; no special spec contract. The hint vanishes as soon as the first element is created. Implementation may use either a Konva text node centered in world space (which would drift with pan/zoom — bad) or an HTML overlay anchored to screen-center (better; matches the toolbar's behavior).

Recommend HTML overlay so the hint stays put when the user pans.

---

## Invariants

- **The Konva tree is a pure function of `(diagram, selection, textEditingElementId, viewport, tool-local state)`.** Same inputs → same DOM.
- **Domain coordinates are in world space; Konva's transform converts.** Individual shape components never see screen coordinates.
- **Every stroke that should be visually constant under zoom is divided by `vp.scale`.** No "magic 2" anywhere — refer to `STYLE.*` constants.
- **The `shapes` layer carries no transient state.** Ghost previews and rubber bands live on `overlay`. This keeps the `shapes` layer cache-friendly if caching is enabled later.
- **Arrows reference only existing elements at render time.** Defensive skip in render code; the domain invariant in `applyEvent` guarantees this is correct.
- **No shape component imports the store directly.** They receive `Element` / `Arrow` as props; the parent canvas component reads from the store.

---

## Out of scope (MVP)

- Per-element styling (fill, stroke color, stroke width, font family/size, text alignment, dash patterns). All shapes look identical.
- Shape rotation. The domain has no rotation field; the transformer disables the rotation handle.
- Flipping (mirroring across an axis).
- Layer ordering / z-index control in the diagram. Render order is dictionary iteration order of `diagram.elements`, which is insertion order in modern JS engines.
- Connector routing (path-finding, orthogonal arrows). Arrows are straight lines.
- Custom arrowhead shapes (open arrow, diamond, none-on-target). Only the default Konva arrowhead at the target end.
- Selection marquee (drag-rectangle to multi-select). Multi-select is out of scope per [`PLAN.md`](PLAN.md).
- Snap-to-grid, snap-to-shape, alignment guides.
- Group/ungroup. No grouping primitive in the domain.
- Export to PNG/SVG.
- Layer caching (`Konva.Layer.cache()`). Three-layer split makes it possible; not enabled in MVP.
- Animated transitions when a peer's `ElementMoved` shifts a shape. The change is instantaneous.
