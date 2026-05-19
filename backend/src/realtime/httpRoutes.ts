import { RoomRegistry } from '@/realtime/rooms/roomRegistry';
import { validateSeed } from '@/realtime/seedValidator';

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

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

const jsonResponse = (status: number, body: object): HttpResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Routes a single HTTP request. Currently handles only `POST /rooms`;
 * every other method/path returns 405 / 404 respectively.
 */
export function handleHttpRequest(req: HttpRequest, deps: HttpRouteDeps): HttpResponse {
  if (req.url !== '/rooms') {
    return jsonResponse(404, { error: 'not_found' });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (Buffer.byteLength(req.body, 'utf8') > maxBodyBytes) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const ct = req.headers['content-type'];
  if (typeof ct !== 'string' || !ct.toLowerCase().startsWith('application/json')) {
    return jsonResponse(415, { error: 'unsupported_media_type' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return jsonResponse(400, { error: 'bad_json' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return jsonResponse(400, { error: 'bad_json' });
  }
  const seedRaw = (parsed as Record<string, unknown>).seed;
  if (seedRaw === undefined) {
    return jsonResponse(400, { error: 'bad_json' });
  }

  const result = validateSeed(seedRaw);
  if (!result.valid) {
    return jsonResponse(400, { error: 'invalid_seed', detail: result.detail });
  }

  const room = deps.registry.createRoom(result.seed);
  return jsonResponse(201, { roomId: room.id });
}
