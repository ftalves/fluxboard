import { handleHttpRequest, HttpRequest, HttpResponse } from '@/realtime/httpRoutes';
import { RoomRegistry } from '@/realtime/rooms/roomRegistry';

// ─── Fakes / fixtures ────────────────────────────────────────────────────────

const makeFakeRegistry = (overrides: { createRoom?: jest.Mock } = {}): RoomRegistry => {
  const createRoom = overrides.createRoom ?? jest.fn().mockReturnValue({ id: 'room-abc' });
  return {
    createRoom,
    getRoom: jest.fn(),
    destroyRoom: jest.fn(),
    size: jest.fn(),
    forEachRoom: jest.fn(),
  } as unknown as RoomRegistry;
};

const validSeedBody = JSON.stringify({ seed: { elements: {}, arrows: {} } });

const validRequest = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'POST',
  url: '/rooms',
  headers: { 'content-type': 'application/json' },
  body: validSeedBody,
  ...overrides,
});

const parseBody = (res: HttpResponse): unknown => {
  if (!res.body) return undefined;
  return JSON.parse(res.body);
};

const contentType = (res: HttpResponse): string | undefined =>
  res.headers?.['content-type'] ?? res.headers?.['Content-Type'];

// ─── Method dispatch ─────────────────────────────────────────────────────────

describe('handleHttpRequest: method dispatch', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])(
    'returns 405 method_not_allowed for %s /rooms',
    (method) => {
      const registry = makeFakeRegistry();
      const res = handleHttpRequest(validRequest({ method }), { registry });
      expect(res.status).toBe(405);
      expect(parseBody(res)).toMatchObject({ error: 'method_not_allowed' });
    },
  );

  it('does not call registry.createRoom for non-POST methods', () => {
    const createRoom = jest.fn();
    const registry = makeFakeRegistry({ createRoom });
    handleHttpRequest(validRequest({ method: 'GET' }), { registry });
    expect(createRoom).not.toHaveBeenCalled();
  });
});

// ─── Path dispatch ───────────────────────────────────────────────────────────

describe('handleHttpRequest: path dispatch', () => {
  it.each(['/', '/foo', '/rooms/123', '/healthz', '/api/rooms'])(
    'returns 404 not_found for unknown path %s',
    (url) => {
      const registry = makeFakeRegistry();
      const res = handleHttpRequest(validRequest({ url }), { registry });
      expect(res.status).toBe(404);
      expect(parseBody(res)).toMatchObject({ error: 'not_found' });
    },
  );
});

// ─── Content-Type validation ─────────────────────────────────────────────────

describe('handleHttpRequest: Content-Type validation', () => {
  it('returns 415 when Content-Type header is absent', () => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(validRequest({ headers: {} }), { registry });
    expect(res.status).toBe(415);
    expect(parseBody(res)).toMatchObject({ error: 'unsupported_media_type' });
  });

  it.each(['text/plain', 'application/xml', 'application/octet-stream'])(
    'returns 415 when Content-Type is %s',
    (ct) => {
      const registry = makeFakeRegistry();
      const res = handleHttpRequest(validRequest({ headers: { 'content-type': ct } }), {
        registry,
      });
      expect(res.status).toBe(415);
    },
  );

  it('accepts application/json with a charset parameter', () => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(
      validRequest({ headers: { 'content-type': 'application/json; charset=utf-8' } }),
      { registry },
    );
    expect(res.status).toBe(201);
  });
});

// ─── Body parsing ────────────────────────────────────────────────────────────

describe('handleHttpRequest: body parsing', () => {
  it.each([
    ['empty string', ''],
    ['plain text', 'hello'],
    ['unclosed object', '{'],
  ])('returns 400 bad_json for unparseable body (%s)', (_, body) => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(validRequest({ body }), { registry });
    expect(res.status).toBe(400);
    expect(parseBody(res)).toMatchObject({ error: 'bad_json' });
  });

  it.each([
    ['number', '42'],
    ['array', '[1, 2]'],
    ['null', 'null'],
    ['string', '"hello"'],
  ])('returns 400 bad_json when top-level body is %s (not an object)', (_, body) => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(validRequest({ body }), { registry });
    expect(res.status).toBe(400);
    expect(parseBody(res)).toMatchObject({ error: 'bad_json' });
  });

  it('returns 400 bad_json when seed field is missing from the body', () => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(validRequest({ body: JSON.stringify({}) }), { registry });
    expect(res.status).toBe(400);
    expect(parseBody(res)).toMatchObject({ error: 'bad_json' });
  });
});

// ─── Body size cap ───────────────────────────────────────────────────────────

describe('handleHttpRequest: body size cap', () => {
  it('returns 413 payload_too_large when body exceeds maxBodyBytes', () => {
    const registry = makeFakeRegistry();
    const body = 'a'.repeat(101);
    const res = handleHttpRequest(validRequest({ body }), {
      registry,
      maxBodyBytes: 100,
    });
    expect(res.status).toBe(413);
    expect(parseBody(res)).toMatchObject({ error: 'payload_too_large' });
  });

  it('does not call registry.createRoom when body exceeds the cap', () => {
    const createRoom = jest.fn();
    const registry = makeFakeRegistry({ createRoom });
    const body = 'a'.repeat(101);
    handleHttpRequest(validRequest({ body }), { registry, maxBodyBytes: 100 });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('uses 1 MB as the default cap when maxBodyBytes is omitted', () => {
    const registry = makeFakeRegistry();
    const body = 'a'.repeat(1024 * 1024 + 1);
    const res = handleHttpRequest(validRequest({ body }), { registry });
    expect(res.status).toBe(413);
  });
});

// ─── Seed validation delegation ──────────────────────────────────────────────

describe('handleHttpRequest: seed validation', () => {
  it('returns 400 invalid_seed when seed is malformed', () => {
    const registry = makeFakeRegistry();
    const body = JSON.stringify({ seed: 'not an object' });
    const res = handleHttpRequest(validRequest({ body }), { registry });
    expect(res.status).toBe(400);
    expect(parseBody(res)).toMatchObject({ error: 'invalid_seed' });
  });

  it('returns 400 invalid_seed when an arrow references a missing element', () => {
    const registry = makeFakeRegistry();
    const body = JSON.stringify({
      seed: {
        elements: {},
        arrows: {
          'a-1': { id: 'a-1', fromElementId: 'ghost', toElementId: 'ghost' },
        },
      },
    });
    const res = handleHttpRequest(validRequest({ body }), { registry });
    expect(res.status).toBe(400);
    expect(parseBody(res)).toMatchObject({ error: 'invalid_seed' });
  });

  it('includes a non-empty detail string on invalid_seed responses', () => {
    const registry = makeFakeRegistry();
    const body = JSON.stringify({ seed: null });
    const res = handleHttpRequest(validRequest({ body }), { registry });
    const parsed = parseBody(res) as { detail: string };
    expect(parsed.detail).toEqual(expect.any(String));
    expect(parsed.detail.length).toBeGreaterThan(0);
  });

  it('does NOT call registry.createRoom on invalid seed', () => {
    const createRoom = jest.fn();
    const registry = makeFakeRegistry({ createRoom });
    const body = JSON.stringify({ seed: 'bogus' });
    handleHttpRequest(validRequest({ body }), { registry });
    expect(createRoom).not.toHaveBeenCalled();
  });
});

// ─── Successful creation ─────────────────────────────────────────────────────

describe('handleHttpRequest: successful creation', () => {
  it('returns 201 with the new roomId', () => {
    const createRoom = jest.fn().mockReturnValue({ id: 'room-abc' });
    const registry = makeFakeRegistry({ createRoom });

    const res = handleHttpRequest(validRequest(), { registry });

    expect(res.status).toBe(201);
    expect(parseBody(res)).toEqual({ roomId: 'room-abc' });
  });

  it('calls registry.createRoom with the validated seed', () => {
    const createRoom = jest.fn().mockReturnValue({ id: 'room-abc' });
    const registry = makeFakeRegistry({ createRoom });
    const seed = { elements: {}, arrows: {} };

    handleHttpRequest(validRequest({ body: JSON.stringify({ seed }) }), { registry });

    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).toHaveBeenCalledWith(seed);
  });
});

// ─── Response content type ───────────────────────────────────────────────────

describe('handleHttpRequest: response Content-Type', () => {
  it('sets Content-Type: application/json on the success response', () => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(validRequest(), { registry });
    expect(contentType(res)).toBe('application/json');
  });

  it.each([
    ['405', { method: 'GET' as const }],
    ['404', { url: '/foo' }],
    ['415', { headers: {} as Record<string, string | undefined> }],
    ['400 bad_json', { body: 'not json' }],
    ['400 invalid_seed', { body: JSON.stringify({ seed: 'x' }) }],
  ])('sets Content-Type: application/json on the %s error response', (_, override) => {
    const registry = makeFakeRegistry();
    const res = handleHttpRequest(validRequest(override), { registry });
    expect(contentType(res)).toBe('application/json');
  });
});
