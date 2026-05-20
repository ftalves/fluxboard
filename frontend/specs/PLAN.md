# Frontend Spec Plan

Working document. Captures decisions made during the grilling session before any spec doc is written. Authoritative once committed; resolved branches here drive the per-area specs listed at the bottom.

The frontend is a React + Vite single-page whiteboard that consumes the FluxBoard backend's HTTP + WebSocket API (see `backend/specs/wire-protocol.md`, `backend/specs/room-lifecycle.md`). Rendering uses `react-konva`. Domain types and `applyEvent` are shared with the backend via an npm workspace.

---

## Locked decisions

### 1. Entry flow / routing
- `/` → frontend calls `POST /rooms` with an empty seed (`{ elements: {}, arrows: {} }`), receives `{ roomId }`, redirects to `/r/:roomId`.
- `/r/:roomId` → opens WebSocket to `ws://host/ws/:roomId` and renders the whiteboard.
- WS upgrade returns `404` (room missing) OR a `room_destroyed` message arrives → show a dedicated error page with a "Create new board" button. No silent redirect.

### 2. Identity (`userId`)
- UUID v4 generated on first visit, persisted in `localStorage` under key `fluxboard.userId`.
- Stable across refresh and tabs within the same browser profile.

### 3. Canvas tech
- `react-konva`. Single `<Stage>` with one or more `<Layer>`s.
- Tradeoffs accepted: extra dep (~150 KB), HTML overlay needed for text editing, opaque to DOM inspection. In exchange: built-in hit-testing, `<Transformer>` for resize handles, `Stage.scale`/`position` for zoom/pan, padded hit area for arrows.

### 4. State management
- **Domain + connection state in Zustand.** Single store, selector subscriptions.
- **Ephemeral UI state in component-local React state.** Selected tool, in-flight drag coords, hover targets, ghost-preview geometry.
- Domain code (types + `applyEvent`) shared via npm workspaces — see §17.

### 5. Tool palette
Five tools in the toolbar:
- **Select** — click to select, drag to move, transformer handles to resize.
- **Rectangle** — click+drag to create.
- **Circle** — click+drag to create.
- **Text** — click to place + immediately enter edit mode.
- **Arrow** — click source element, then click target element.

No toolbar button for pan or zoom. No multi-select. Delete is keyboard-only.

### 6. Shape creation gestures
- **Rectangle / Circle:** click+drag, bbox = drag delta. Below a min-size floor (e.g. 10×10), snap to a default size. Local "ghost" preview shape during drag — not in store, not broadcast. On mouseup, commit to store and emit a single `ElementCreated`.
- **Text:** click-to-place at cursor, default bbox (~100×20), immediately enters edit mode with a focused `<textarea>` overlay.
- **Arrow:** click source element → hover-preview line follows cursor → click target element → emit `ArrowCreated`. `Escape` or click on empty canvas cancels. Self-arrow (source === target) rejected locally before emit.

### 7. Move + resize gestures
- During drag/resize: emit `ElementMoved` / `ElementResized` throttled to ~20 Hz with distinct `event.id`s. Fire-and-forget.
- On mouseup: emit one final event with the terminal position/size.
- `ack { status: "rejected" }` for a move/resize means the element was deleted by a peer → drop the element from the local store (rollback table — see §10).

### 8. Text editing
- **Enter edit mode:** double-click any text element OR press `Enter` while a text element is selected. Text-tool single-click on empty canvas places a new element and enters edit mode.
- **UI:** HTML `<textarea>` overlay positioned at the element's screen-space bbox, font/size matched to the Konva text style.
- **Emit cadence:** debounced 300ms during typing + one final emit on blur. Each emit is a fresh `ElementTextUpdated` with a new `event.id` (text events replace the full string, not patch).
- **Exit edit mode:** click outside, `Escape`, or tool change.
- **Concurrent edit:** while a text element is in local edit mode, incoming `ElementTextUpdated` events for that element are ignored until blur. Last-write-wins on blur is acceptable per backend tradeoff.

### 9. Connection lifecycle
States: `connecting` → `connected` → (`reconnecting` ↔ `connected`) → `disconnected_terminal` / `disconnected_shutdown`.

- Auto-reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s, max 5 attempts → terminal state.
- During `reconnecting`: canvas interaction disabled, banner shown. No event queueing.
- On reconnect: send `join`, receive `sync`, wholesale-replace local `DiagramState`, re-enable UI.
- Terminal triggers: `4404` at upgrade, `room_destroyed`, max retries exhausted, certain server errors (see §22).
- Terminal UI: error overlay with "Create new board" CTA (matches §1).

### 10. Optimistic apply + rollback
- Local store applies event optimistically via shared `applyEvent`.
- `pendingEvents: Map<eventId, DiagramEvent>` tracks unacked events.
- On `ack { status: "applied" | "duplicate" }` → drop from pending map.
- On `ack { status: "rejected" }` → rollback per table below, drop from pending map.

| Event type | Rollback action |
|---|---|
| `ElementCreated` | Remove the element locally. |
| `ElementMoved` | Remove the element locally (it was deleted server-side). |
| `ElementResized` | Remove the element locally. |
| `ElementTextUpdated` | Remove the element locally. |
| `ElementDeleted` | No-op (idempotent). |
| `ArrowCreated` | Remove the arrow locally. |
| `ArrowDeleted` | No-op (idempotent). |

- **Ack timeout:** if no `ack` arrives within 10s, force-close the socket and reconnect to pull a fresh `sync`. Defensive against silent drift.

### 11. Layout / chrome
- **Toolbar:** floating, top-center, 5 tools.
- **Room id + copy button:** top-left chip.
- **Connection status badge:** top-right (green / yellow / red dot + label).
- **Zoom indicator:** bottom-right, shows `100%`, click to reset to 100% (and center?).
- **Canvas:** fullscreen, edge-to-edge.
- No properties panel, layers panel, or shortcut help in MVP.

### 12. Undo / redo
Skipped in MVP. Listed as out-of-scope. Distributed undo across peers is non-trivial; deferred.

### 13. Pan / zoom
- **Pan:** hold middle mouse button + drag. Translates `Stage.position`.
- **Zoom:** `Ctrl + wheel`. Anchored on cursor position. Bounds 0.1× to 5×.
- **Plain wheel:** ignored (no scroll, no pan).
- **Coord system:** events carry world coords. Screen↔world conversion via `stage.getRelativePointerPosition()`. Domain state never knows about viewport.
- **Persistence:** in-memory, ephemeral. Refresh resets to identity transform.

### 14. Arrow rendering
- **Geometry:** edge-to-edge bbox intersect. Compute line from source-bbox-center to target-bbox-center, then clip to where it exits each bbox. Re-derived from element coords on every render — no extra domain state.
- **Renderer:** Konva `<Arrow>` shape with arrowhead at the target end only.
- **Hit area:** padded via Konva `hitStrokeWidth` so thin lines are clickable.
- **Selection:** click arrow → selects. `Del` / `Backspace` → emits `ArrowDeleted`.
- **Creation:** see §6.

### 15. Element delete with cascade
- `Del` / `Backspace` on a selected element emits a single `ElementDeleted` event.
- Local store applies the same cascade as the backend (remove element + all referencing arrows) via the shared `applyEvent` — no separate `ArrowDeleted` emits.
- Peer broadcasts of `ElementDeleted` apply identically.
- Selection clears automatically if the selected element or arrow is removed (locally or by peer).

### 16. Peer event merge
1. Receive `{ type: "event", event }` from server.
2. Apply via shared `applyEvent(state, event)`.
3. Replace store state.
4. If the deleted id matches the selection (directly or via arrow endpoint), clear selection.
5. **Exception:** if the event is `ElementTextUpdated` for an element currently in local edit mode, skip the apply (see §8).
6. For `ElementMoved` / `ElementResized` on an element being dragged locally: still apply. The next throttled local emit re-asserts the local position. Visual jitter under contention is accepted as informative LWW behavior.

### 17. Project structure & build
Workspace layout:

```
fluxboard/
  package.json              # "workspaces": ["packages/*", "backend", "frontend"]
  packages/
    domain/                 # promoted from backend/src/domain/
      src/
        types.ts
        applyEvent.ts
        index.ts
      package.json          # "name": "@fluxboard/domain"
      tsconfig.json
  backend/
    package.json            # depends on @fluxboard/domain
    src/...
  frontend/
    package.json            # depends on @fluxboard/domain
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      canvas/               # Konva stage, shape components, ghost preview
      tools/                # tool palette, tool state
      net/                  # WS client, reconnect, ack tracking
      store/                # Zustand store
      ui/                   # toolbar, conn badge, room id chip, error overlay
      hooks/
    tests/
    specs/                  # this directory
```

- Vite for the frontend build.
- TypeScript strict on both sides.
- Specs go in `frontend/specs/` mirroring `backend/specs/` per CLAUDE.md.

### 18. Backend URL config
- **Dev:** Vite proxy `/rooms` and `/ws` → `localhost:8080`. Frontend uses same-origin URLs everywhere. No CORS.
- **Prod:** `VITE_BACKEND_URL` env var, defaulting to `window.location.origin` if unset.
- WS URL derived from the HTTP origin: `http://` → `ws://`, `https://` → `wss://`.

### 19. Testing strategy
- **Domain (`packages/domain`):** existing backend tests move with the code. Vitest.
- **Frontend unit tests:** Zustand store transitions (optimistic apply, rollback, pending-event tracking), net layer (WS client with a fake socket, reconnect, ack timeout), pure helpers (screen↔world coords, bbox-intersect for arrows).
- **Frontend component tests:** React Testing Library — toolbar tool switching, error overlay rendering, end-to-end interaction flows against a mocked WS server.
- **No Konva canvas pixel testing.** UI tests assert store calls or DOM, not rendered canvas output.
- **E2E (Playwright):** out of scope for MVP.
- Vitest + React Testing Library + a hand-rolled `WebSocket` fake (no extra dep).
- One test file per spec doc (mirror backend convention).

### 20. Styling
- CSS Modules. Co-located `.module.css` per component. Zero runtime cost. Vite supports out of the box.
- No Tailwind, no CSS-in-JS.

### 21. Visual defaults
- All visual constants live in `frontend/src/canvas/style.ts` — domain has no styling fields, so every element looks identical in MVP.
- **Fill:** transparent / white.
- **Stroke:** black, 2px.
- **Selected stroke:** blue (~`#3b82f6`), 2px overlay.
- **Hover target (during arrow creation):** blue dashed outline.
- **Ghost preview (creation drag):** dashed stroke, no fill.
- **Text:** system sans-serif, 16px, black.

### 22. Server error handling

| `error.code` | Server closes? | Frontend action |
|---|---|---|
| `bad_json` | Yes (`1003`) | Terminal disconnect overlay. Indicates a client bug. Log to console. |
| `must_join_first` | Yes (`4400`) | Terminal. Client bug. |
| `already_joined` | Yes (`4400`) | Terminal. Client bug. |
| `invalid_join` | Yes (`4400`) | Terminal. Bad userId. Log + offer "Create new board". |
| `invalid_event` | No | Look up `eventId` in pending map, run §10 rollback for its type, log. Stay connected. |
| `unknown_message` | No | Log only. Client bug. |

Every `error` frame is logged to the browser console regardless of severity.

### 23. App-level `ping` / `pong`
- Not used in MVP. The browser auto-responds to WebSocket protocol-level pings, which is sufficient for transport-level liveness.
- May be added later if a latency UI is introduced.

---

## Spec documents to write

In recommended order:

| # | Doc | Covers |
|---|---|---|
| 1 | `workspace-and-build.md` | npm workspaces, `packages/domain` promotion, Vite config, env vars, Vitest setup, project layout (§17, §18, §19). |
| 2 | `routing.md` | `/` auto-create flow, `POST /rooms` call shape, `/r/:roomId` join, 404 error page (§1). |
| 3 | `wire-client.md` | WS connect/join, message encoding/decoding, server error code handling matrix (§22). |
| 4 | `connection-lifecycle.md` | Client connection states, reconnect with backoff, ack timeout, disconnect banner, terminal state (§9, §10 timeout). |
| 5 | `store.md` | Zustand state shape, identity (§2), optimistic apply via shared `applyEvent`, pending event tracking, per-event rollback table, peer event merge (§4, §10, §15, §16). |
| 6 | `viewport.md` | Pan, zoom, world↔screen coord conversion (§13). |
| 7 | `rendering.md` | Konva stage/layer structure, arrow bbox-intersect geometry, visual constants, hit areas, transformer handles (§14, §21). |
| 8 | `tools-and-gestures.md` | 5-tool palette, per-tool gestures (rect/circle drag-create with ghost, text place + edit overlay, arrow click-A→B, select move/resize throttled emits), keyboard delete (§5, §6, §7, §8, §15). |

---

## Execution plan

Confirmed approach: **B — write spec 1 then execute the workspace migration immediately**, before authoring the remaining specs. The migration is mechanical and unblocks `@fluxboard/domain` imports for both backend and frontend code.

Order:
1. Write `workspace-and-build.md`.
2. Execute the workspace migration: move `backend/src/domain/` to `packages/domain/`, add workspace root `package.json`, update backend imports, run backend tests to confirm green.
3. Bootstrap the frontend Vite + React + TypeScript skeleton.
4. Write remaining specs in the order above.
5. For each spec: write tests first (TDD per CLAUDE.md), then implement.

---

## Out of scope (MVP)

- Undo / redo.
- Multi-select / marquee selection.
- Per-element styling (color, stroke width, font family, etc.) — domain has no styling fields.
- Properties panel, layers panel.
- Authentication, account system, named users.
- Presence / cursors / awareness protocol.
- Reconnection token / session resumption protocol.
- Persistence of viewport (pan/zoom) across refresh.
- E2E browser tests (Playwright).
- Latency UI / app-level ping.
- Export (PNG/SVG).
- Mobile / touch input.
- Keyboard shortcuts beyond `Del`, `Backspace`, `Enter`, `Escape`.
