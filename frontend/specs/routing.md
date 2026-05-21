# Spec: Routing

This spec defines how the frontend maps a browser URL to one of three application views: a room being joined, the auto-create handshake on the home path, or a terminal error page. It is the authoritative source for the route table, the `POST /rooms` call shape, and the navigation primitives used by the rest of the app.

It does **not** cover the WebSocket connection itself — that lives in [`wire-client.md`](wire-client.md) and [`connection-lifecycle.md`](connection-lifecycle.md). It does not cover what the whiteboard renders after the connection is established — that is [`rendering.md`](rendering.md) and [`tools-and-gestures.md`](tools-and-gestures.md). This document is scoped to *URL → which view, and what side effects fire on the boundary between them*.

---

## Route table

| Path | View | Behavior |
|---|---|---|
| `/` | `<HomeView>` | Calls `POST /rooms` with an empty seed, then **replaces** the URL with `/r/:roomId` (no extra history entry). While the request is in flight, renders a minimal loading state. On HTTP failure, renders the error view (see *Error view*). |
| `/r/:roomId` | `<RoomView>` | Opens a WebSocket to the room and renders the whiteboard. The `:roomId` segment is passed to the WS client. |
| anything else | `<NotFoundView>` | A specialization of the error view with `kind: "not_found"`. |

`:roomId` is taken verbatim from the URL. The frontend does not validate its format — that is the backend's job at the WebSocket upgrade. If the id is malformed or the room does not exist, the backend rejects the upgrade and `connection-lifecycle.md` transitions to a terminal error state that surfaces the same error view.

---

## Router implementation

No router library. The frontend hosts a ~30-line custom router built directly on the History API.

### Public API

```ts
type Route =
  | { kind: "home" }
  | { kind: "room"; roomId: string }
  | { kind: "not_found" };

function useRoute(): Route;
function navigateReplace(path: string): void;  // history.replaceState + dispatch
function navigatePush(path: string):    void;  // history.pushState    + dispatch
```

- `useRoute` is a React hook that returns the current `Route`. It subscribes to a `popstate` listener and a custom in-app `route-change` event so that calls to `navigatePush` / `navigateReplace` re-render subscribed components without a real navigation.
- `navigateReplace` is used for the auto-create redirect from `/` to `/r/:roomId`. Replacement (not push) ensures the user's back button does not return to `/`, which would re-create yet another empty room.
- `navigatePush` is used by the error view's "Create new board" button — that action *should* leave a history entry so back navigation works as expected.

### Path parsing

```ts
function parse(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (match) return { kind: "room", roomId: match[1] };
  return { kind: "not_found" };
}
```

- Trailing slash after `/r/:roomId` is tolerated; everything else after `:roomId` is `not_found`.
- The `:roomId` capture is opaque. Any non-`/` characters are accepted; the backend enforces format on upgrade.

### Mount point

The router renders inside `<App>`:

```tsx
function App() {
  const route = useRoute();
  switch (route.kind) {
    case "home":      return <HomeView />;
    case "room":      return <RoomView roomId={route.roomId} />;
    case "not_found": return <NotFoundView />;
  }
}
```

No nested routing; no layout component. The three views are siblings.

---

## `<HomeView>` — auto-create flow

### Sequence

1. On mount, fire `POST /rooms` with body `{ "seed": { "elements": {}, "arrows": {} } }`. Use the URL resolution rules in [`wire-client.md`](wire-client.md) §"Backend URL resolution".
2. While the request is in flight, render a spinner. No toolbar, no canvas chrome.
3. On `201` with `{ roomId }`, call `navigateReplace(\`/r/${roomId}\`)`.
4. On any failure, transition to the error view with the matching `kind` (see *Error view → kinds*).

### Request

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/rooms` (resolved against the backend base URL) |
| Headers | `Content-Type: application/json` |
| Body | `{"seed":{"elements":{},"arrows":{}}}` |

The empty seed is always well-formed (`backend/specs/wire-protocol.md` *Seed validation* rules 1–7 trivially pass for an empty object). The backend returns `201`.

### Response handling

| Status | Action |
|---|---|
| `201` | Parse JSON, extract `roomId`, `navigateReplace`. |
| `4xx` other than 413 | Error view, `kind: "create_failed"`, message from response body if available. |
| `413` | Error view, `kind: "create_failed"`. (Empty seed should never trigger this; if it does, surface as a generic failure.) |
| `5xx` | Error view, `kind: "create_failed"`. |
| Network failure / fetch reject | Error view, `kind: "network"`. |

The error view's "Create new board" button retries by calling `navigatePush("/")` — same flow, fresh request.

### Idempotency

`POST /rooms` is **not** idempotent. Calling it twice creates two rooms.

The home view guards against duplicate fires under React 18 StrictMode (which double-invokes effects in development) with a module-scoped `inFlight: AbortController | null` ref:

- On mount, if `inFlight` is non-null, abort it before issuing the new request. The aborted request's response is discarded.
- On unmount, abort `inFlight` and clear it.
- The replace navigation on success runs *before* the cleanup, so the home view unmounts immediately after a successful create and never has a chance to fire a second request in production.

This avoids leaking an extra empty room per page load in development. In production (StrictMode-free build), the effect fires once and the guard is a no-op.

---

## `<RoomView>` — join flow

### Sequence

1. Read `roomId` from the route.
2. Mount the connection-lifecycle controller from [`connection-lifecycle.md`](connection-lifecycle.md), which:
   - Mints/reads the `userId` from `localStorage` (see [`store.md`](store.md) §"Identity").
   - Opens the WebSocket.
   - Sends `{ type: "join", userId }`.
   - Receives `sync` and hydrates the store.
3. Render the whiteboard shell (toolbar, canvas, chrome — see [`rendering.md`](rendering.md)).

The view does not unmount on transient disconnects; the connection lifecycle manages reconnection internally and the room view stays mounted. The view *does* unmount when the user navigates to the error route after a terminal close.

### Bad `:roomId`

The frontend does no upfront validation. The WebSocket upgrade either succeeds (room exists) or fails (HTTP 404 from the upgrade). On failure, the connection lifecycle controller transitions to `disconnected_terminal` with reason `room_not_found`, and the room view's render branch swaps to the error view with `kind: "not_found"`. See [`connection-lifecycle.md`](connection-lifecycle.md) §"Terminal triggers".

This is logically the same as visiting an unrecognized path: a room id that doesn't exist on the server is, from the user's perspective, a not-found. The two paths converge on the same error view.

---

## `<NotFoundView>` / error view

A single component renders all error states. Its props:

```ts
type ErrorViewKind =
  | "not_found"        // unrecognized path, or room missing on the server
  | "room_destroyed"   // server tore the room down while we were connected
  | "create_failed"    // POST /rooms returned a non-201
  | "network"          // fetch rejected (offline, DNS, etc.)
  | "server_shutdown"; // server sent room_destroyed with reason "shutdown"
```

The view renders a heading appropriate to the `kind`, a single-sentence message, and one primary CTA: **"Create new board"**. The button calls `navigatePush("/")`, which mounts a fresh `<HomeView>` and runs the auto-create flow again.

No retry-the-same-room button. A destroyed room is not coming back, and a not-found room id was never real. The CTA always creates fresh.

### Kind → text

| Kind | Heading | Message |
|---|---|---|
| `not_found` | "Board not found" | "This board no longer exists or never did. Create a new one to start over." |
| `room_destroyed` | "Board ended" | "The collaboration session is over. Create a new board to keep going." |
| `create_failed` | "Couldn't create a board" | "Something went wrong on the server. Try again." |
| `network` | "Offline" | "You're not connected to the server. Check your connection and try again." |
| `server_shutdown` | "Server restarting" | "The server is shutting down for maintenance. Try again in a moment." |

Wording is final for MVP — copywriting iteration is out of scope.

---

## Navigation and side effects

| Trigger | Method | Why |
|---|---|---|
| Home view auto-create succeeds | `navigateReplace("/r/:id")` | Don't leave `/` in history; back button from the room view should exit the app, not re-create another room. |
| Error view "Create new board" | `navigatePush("/")` | The error view is a real history entry; the user might want to go back to it after creating. |
| Browser back/forward | (native) | Caught by the `popstate` listener; the router re-derives `Route` and the matching view mounts. |
| Internal share-link copy | none | Copying the URL does not navigate; clipboard only. |

The router never calls `window.location.assign` or `.reload`. All transitions are SPA-internal.

---

## Invariants

- **Exactly one of `<HomeView>`, `<RoomView>`, `<NotFoundView>` is mounted at any time.** The switch in `<App>` is exhaustive over the `Route` union.
- **`<HomeView>` always navigates away from `/` before unmounting** — either via `navigateReplace` on success or via re-render to the error view on failure. The home view does not stay on `/` after its effect resolves.
- **`<RoomView>` is the only view that holds a WebSocket connection.** The home view does no WS work; the error view tears down any connection that was open when it mounted.
- **The router never reads `window.location` outside the bootstrap path.** All in-app navigation flows through `navigatePush` / `navigateReplace`, both of which update the in-memory `Route` and call `history.*State` in one step.

---

## Out of scope (MVP)

- A router library (react-router, wouter, tanstack-router). The custom router is sufficient for two routes and an error fallback. If routing complexity grows (nested layouts, route data loaders, transitions), a library may be reintroduced in a new spec.
- Deep-link parameters (e.g. `/r/:id?focus=elem-123`). Query strings and fragments are ignored.
- Room-naming or human-readable slugs. The 8-char URL-safe id from the backend is the only identifier.
- Authenticated routes, redirects to a login page.
- Server-rendered routing (SSR / SSG). The frontend is a pure SPA.
- Route-level code splitting. All three views ship in the initial bundle (the bundle is small enough that splitting is premature optimization).
- A "recently visited rooms" list. The frontend keeps no per-user room history.
