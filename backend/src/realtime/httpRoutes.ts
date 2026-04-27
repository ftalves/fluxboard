import { RoomRegistry } from '@/realtime/rooms/roomRegistry';

/**
 * Pre-buffered HTTP request shape — the value the route sees after the
 * HTTP server's request body has been streamed and concatenated.
 *
 * Header keys are lowercase (matching Node's `IncomingMessage.headers`).
 */
export type HttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
};

/**
 * Route response. The wrapper (in `server.ts`) writes status, headers,
 * and body to the underlying `ServerResponse`.
 */
export type HttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

export type HttpRouteDeps = {
  registry: RoomRegistry;
  // Defaults to 1 MB. Larger bodies return 413 payload_too_large.
  maxBodyBytes?: number;
};

/**
 * Routes a single HTTP request. Currently handles only `POST /rooms`;
 * every other method/path returns 405 / 404 respectively.
 *
 * Response codes (per [`wire-protocol.md`](backend/specs/wire-protocol.md)):
 *  - 201 — room created; body `{ roomId }`.
 *  - 400 bad_json — body is unparseable JSON or top-level shape is wrong.
 *  - 400 invalid_seed — seed validation failed; body includes `detail`.
 *  - 404 not_found — path is not `/rooms`.
 *  - 405 method_not_allowed — method on `/rooms` is not POST.
 *  - 413 payload_too_large — body exceeded `maxBodyBytes`.
 *  - 415 unsupported_media_type — `Content-Type` missing or not `application/json`.
 */
export function handleHttpRequest(_req: HttpRequest, _deps: HttpRouteDeps): HttpResponse {
  throw new Error('handleHttpRequest: not yet implemented');
}
