import { Readable } from 'node:stream';
import type http from 'node:http';
import type net from 'node:net';
import {
  readBody,
  writeHttpResponse,
  createRequestHandler,
  createUpgradeHandler,
  WsServer,
  WsSocket,
} from '@/server';
import type { HttpRequest, HttpResponse } from '@/realtime/httpRoutes';
import type { RoomRegistry } from '@/realtime/rooms/roomRegistry';
import type { EventBus } from '@/event-bus/bus';
import type { Config } from '@/config';

// Mock handleHttpRequest and handleConnection so server tests don't depend on
// their implementations — server.ts is only tested for its Node-specific glue.
jest.mock('@/realtime/httpRoutes', () => ({
  handleHttpRequest: jest.fn(),
}));
jest.mock('@/realtime/connection', () => ({
  handleConnection: jest.fn(),
}));

import { handleHttpRequest } from '@/realtime/httpRoutes';
import { handleConnection } from '@/realtime/connection';

const mockHandleHttpRequest = handleHttpRequest as jest.MockedFunction<typeof handleHttpRequest>;
const mockHandleConnection = handleConnection as jest.MockedFunction<typeof handleConnection>;

// ─── Fakes / fixtures ─────────────────────────────────────────────────────────

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  PORT: 8080,
  GRACE_PERIOD_MS: 30_000,
  ROOM_ID_LENGTH: 8,
  JOIN_TIMEOUT_MS: 5_000,
  WS_HEARTBEAT_MS: 30_000,
  MAX_SEED_BYTES: 1_048_576,
  MAX_WS_MESSAGE_BYTES: 262_144,
  ...overrides,
});

const makeFakeRegistry = (): RoomRegistry =>
  ({
    createRoom: jest.fn(),
    getRoom: jest.fn(),
    destroyRoom: jest.fn(),
    size: jest.fn(),
    forEachRoom: jest.fn(),
  }) as unknown as RoomRegistry;

const makeFakeBus = (): EventBus =>
  ({
    publish: jest.fn(),
    subscribe: jest.fn(),
    close: jest.fn(),
  }) as unknown as EventBus;

/** Builds a Readable that emits `chunks` and then ends. */
const makeReadable = (chunks: string[]): Readable => {
  const r = new Readable({ read() {} });
  setImmediate(() => {
    chunks.forEach((c) => r.push(c));
    r.push(null);
  });
  return r;
};

/**
 * Builds a minimal IncomingMessage-shaped object for request handler tests.
 * Casts through unknown — IncomingMessage is a Readable, so the Readable
 * body streaming works; the extra properties satisfy the handler's shape check.
 */
const makeRequest = (
  chunks: string[],
  overrides: { method?: string; url?: string; headers?: Record<string, string> } = {},
): http.IncomingMessage =>
  Object.assign(makeReadable(chunks), {
    method: 'POST',
    url: '/rooms',
    headers: { 'content-type': 'application/json' },
    ...overrides,
  }) as unknown as http.IncomingMessage;

/** Fake http.ServerResponse — captures writes for assertion. */
const makeFakeResponse = () => ({
  writeHead: jest.fn(),
  write: jest.fn(),
  end: jest.fn(),
  setHeader: jest.fn(),
});

type FakeResponse = ReturnType<typeof makeFakeResponse>;

const makeFakeWss = (): WsServer & { handleUpgrade: jest.Mock } => ({
  handleUpgrade: jest.fn(),
});

const makeFakeSocket = (): net.Socket & { write: jest.Mock; destroy: jest.Mock } =>
  ({
    write: jest.fn(),
    destroy: jest.fn(),
  }) as unknown as net.Socket & { write: jest.Mock; destroy: jest.Mock };

beforeEach(() => {
  mockHandleHttpRequest.mockReset();
  mockHandleConnection.mockReset();
});

// ─── readBody ─────────────────────────────────────────────────────────────────

describe('readBody: successful streaming', () => {
  it('resolves with the concatenated body string', async () => {
    const req = makeReadable(['hello', ' ', 'world']) as unknown as http.IncomingMessage;
    const body = await readBody(req, 1024);
    expect(body).toBe('hello world');
  });

  it('resolves with an empty string for a zero-byte body', async () => {
    const req = makeReadable([]) as unknown as http.IncomingMessage;
    const body = await readBody(req, 1024);
    expect(body).toBe('');
  });

  it('accepts a body exactly at the limit (byte count equals maxBytes)', async () => {
    const payload = 'a'.repeat(100);
    const req = makeReadable([payload]) as unknown as http.IncomingMessage;
    const body = await readBody(req, 100);
    expect(body).toBe(payload);
  });
});

describe('readBody: size cap', () => {
  it('rejects when body exceeds maxBytes', async () => {
    const payload = 'a'.repeat(101);
    const req = makeReadable([payload]) as unknown as http.IncomingMessage;
    await expect(readBody(req, 100)).rejects.toBeDefined();
  });

  it('rejects even when overflow arrives in a later chunk', async () => {
    // First chunk fits; second chunk tips over the limit.
    const req = makeReadable(['a'.repeat(50), 'b'.repeat(60)]) as unknown as http.IncomingMessage;
    await expect(readBody(req, 100)).rejects.toBeDefined();
  });
});

// ─── writeHttpResponse ────────────────────────────────────────────────────────

describe('writeHttpResponse', () => {
  it('writes the status code', () => {
    const res = makeFakeResponse();
    writeHttpResponse(res as unknown as http.ServerResponse, { status: 201, body: '' });
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
  });

  it('writes response headers', () => {
    const res = makeFakeResponse();
    writeHttpResponse(res as unknown as http.ServerResponse, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const [, headers] = res.writeHead.mock.calls[0];
    expect(headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('writes the body string and ends the response', () => {
    const res = makeFakeResponse();
    writeHttpResponse(res as unknown as http.ServerResponse, {
      status: 201,
      body: '{"roomId":"abc"}',
    });
    // Some implementations call res.end(body), others res.write(body) + res.end().
    const allWritten = [
      ...res.write.mock.calls.map((c: unknown[]) => c[0]),
      ...res.end.mock.calls.map((c: unknown[]) => c[0]),
    ]
      .filter(Boolean)
      .join('');
    expect(allWritten).toContain('abc');
  });

  it('calls res.end even when body is absent', () => {
    const res = makeFakeResponse();
    writeHttpResponse(res as unknown as http.ServerResponse, { status: 404 });
    expect(res.end).toHaveBeenCalled();
  });
});

// ─── createRequestHandler ─────────────────────────────────────────────────────

describe('createRequestHandler: body streaming integration', () => {
  it('passes the streamed body string to handleHttpRequest', async () => {
    const registry = makeFakeRegistry();
    const cfg = makeConfig({ MAX_SEED_BYTES: 1_048_576 });
    mockHandleHttpRequest.mockReturnValue({ status: 201, body: '{"roomId":"r"}' });

    const handler = createRequestHandler({ registry, config: cfg });
    const req = makeRequest([JSON.stringify({ seed: { elements: {}, arrows: {} } })]);
    const res = makeFakeResponse();
    await handler(req, res as unknown as http.ServerResponse);

    const [calledReq] = mockHandleHttpRequest.mock.calls[0] as [HttpRequest, unknown];
    expect(typeof calledReq.body).toBe('string');
  });

  it('returns 413 without calling handleHttpRequest when body exceeds MAX_SEED_BYTES', async () => {
    const registry = makeFakeRegistry();
    const cfg = makeConfig({ MAX_SEED_BYTES: 10 });

    const handler = createRequestHandler({ registry, config: cfg });
    const req = makeRequest(['a'.repeat(11)], { headers: {} });
    const res = makeFakeResponse();
    await handler(req, res as unknown as http.ServerResponse);

    // 413 must be written
    expect(res.writeHead).toHaveBeenCalledWith(413, expect.anything());
    // handleHttpRequest must NOT have been called
    expect(mockHandleHttpRequest).not.toHaveBeenCalled();
  });

  it('forwards method, url, and headers from IncomingMessage', async () => {
    const registry = makeFakeRegistry();
    const cfg = makeConfig();
    mockHandleHttpRequest.mockReturnValue({ status: 201, body: '{"roomId":"r"}' });

    const handler = createRequestHandler({ registry, config: cfg });
    const req = makeRequest(['{}'], { headers: { 'content-type': 'application/json' } });
    await handler(req, makeFakeResponse() as unknown as http.ServerResponse);

    const [calledReq] = mockHandleHttpRequest.mock.calls[0] as [HttpRequest, unknown];
    expect(calledReq.method).toBe('POST');
    expect(calledReq.url).toBe('/rooms');
    expect(calledReq.headers['content-type']).toBe('application/json');
  });

  it('writes the HttpResponse returned by handleHttpRequest', async () => {
    const registry = makeFakeRegistry();
    const cfg = makeConfig();
    mockHandleHttpRequest.mockReturnValue({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"roomId":"xyz"}',
    } satisfies HttpResponse);

    const handler = createRequestHandler({ registry, config: cfg });
    const req = makeRequest(['{}'], { headers: {} });
    const res = makeFakeResponse();
    await handler(req, res as unknown as http.ServerResponse);

    expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
  });
});

// ─── createUpgradeHandler ────────────────────────────────────────────────────

describe('createUpgradeHandler: roomId parsing', () => {
  it('returns 404 for a URL that does not match /ws/:roomId', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    const bus = makeFakeBus();

    const handler = createUpgradeHandler({ wss, registry, bus, config: makeConfig() });
    const req = { url: '/not-ws/whatever', headers: {} } as unknown as http.IncomingMessage;
    const socket = makeFakeSocket();

    handler(req, socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(socket.destroy).toHaveBeenCalled();
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });

  it('returns 404 when /ws/ is given with no roomId segment', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    const bus = makeFakeBus();

    const handler = createUpgradeHandler({ wss, registry, bus, config: makeConfig() });
    const req = { url: '/ws/', headers: {} } as unknown as http.IncomingMessage;
    const socket = makeFakeSocket();

    handler(req, socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(socket.destroy).toHaveBeenCalled();
  });
});

describe('createUpgradeHandler: room lookup', () => {
  it('returns 404 to the raw socket when the room does not exist', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue(undefined);
    const bus = makeFakeBus();

    const handler = createUpgradeHandler({ wss, registry, bus, config: makeConfig() });
    const req = { url: '/ws/abc123', headers: {} } as unknown as http.IncomingMessage;
    const socket = makeFakeSocket();

    handler(req, socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(socket.destroy).toHaveBeenCalled();
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });

  it('looks up the roomId parsed from the URL', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue(undefined);
    const bus = makeFakeBus();

    const handler = createUpgradeHandler({ wss, registry, bus, config: makeConfig() });
    const req = { url: '/ws/myRoom', headers: {} } as unknown as http.IncomingMessage;
    handler(req, makeFakeSocket(), Buffer.alloc(0));

    expect(registry.getRoom).toHaveBeenCalledWith('myRoom');
  });

  it('calls wss.handleUpgrade when the room exists', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    const fakeRoom = { id: 'room1' };
    (registry.getRoom as jest.Mock).mockReturnValue(fakeRoom);
    const bus = makeFakeBus();

    const handler = createUpgradeHandler({ wss, registry, bus, config: makeConfig() });
    const req = { url: '/ws/room1', headers: {} } as unknown as http.IncomingMessage;
    const socket = makeFakeSocket();

    handler(req, socket, Buffer.alloc(0));

    expect(wss.handleUpgrade).toHaveBeenCalledWith(req, socket, expect.any(Buffer), expect.any(Function));
  });

  it('calls handleConnection after a successful upgrade', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    const fakeRoom = { id: 'room1' };
    (registry.getRoom as jest.Mock).mockReturnValue(fakeRoom);
    const bus = makeFakeBus();

    // Simulate wss.handleUpgrade calling back immediately with a fake ws socket.
    const fakeWsSocket: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    wss.handleUpgrade.mockImplementation((_req, _sock, _head, cb) => cb(fakeWsSocket));

    const handler = createUpgradeHandler({ wss, registry, bus, config: makeConfig() });
    const req = { url: '/ws/room1', headers: {} } as unknown as http.IncomingMessage;
    handler(req, makeFakeSocket(), Buffer.alloc(0));

    expect(mockHandleConnection).toHaveBeenCalledTimes(1);
    // Called with a SocketHandle adapter and a ConnectionContext containing the room.
    const [, ctx] = mockHandleConnection.mock.calls[0] as [unknown, { room: unknown }];
    expect(ctx.room).toBe(fakeRoom);
  });

  it('passes config.joinTimeoutMs and config.wsHeartbeatMs in the ConnectionContext', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue({ id: 'r' });
    const bus = makeFakeBus();
    const cfg = makeConfig({ JOIN_TIMEOUT_MS: 3_000, WS_HEARTBEAT_MS: 15_000 });

    const fakeWsSocket: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    wss.handleUpgrade.mockImplementation((_req, _sock, _head, cb) => cb(fakeWsSocket));

    const handler = createUpgradeHandler({ wss, registry, bus, config: cfg });
    handler(
      { url: '/ws/r', headers: {} } as unknown as http.IncomingMessage,
      makeFakeSocket(),
      Buffer.alloc(0),
    );

    const [, ctx] = mockHandleConnection.mock.calls[0] as [
      unknown,
      { config: { joinTimeoutMs: number; wsHeartbeatMs: number } },
    ];
    expect(ctx.config.joinTimeoutMs).toBe(3_000);
    expect(ctx.config.wsHeartbeatMs).toBe(15_000);
  });
});

describe('createUpgradeHandler: SocketHandle adapter', () => {
  const setupWithFakeWs = (fakeWsSocket: WsSocket) => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue({ id: 'r' });
    wss.handleUpgrade.mockImplementation((_req, _sock, _head, cb) => cb(fakeWsSocket));

    const handler = createUpgradeHandler({ wss, registry, bus: makeFakeBus(), config: makeConfig() });
    handler(
      { url: '/ws/r', headers: {} } as unknown as http.IncomingMessage,
      makeFakeSocket(),
      Buffer.alloc(0),
    );

    const [socketHandle] = mockHandleConnection.mock.calls[0] as [
      {
        send: (d: string) => void;
        close: (code: number, reason?: string) => void;
        terminate: () => void;
        ping: () => void;
        onMessage: (h: (d: string) => void) => void;
        onPong: (h: () => void) => void;
        onClose: (h: () => void) => void;
      },
      unknown,
    ];
    return { socketHandle, fakeWsSocket };
  };

  it('handle.send(data) calls ws.send(data)', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const { socketHandle } = setupWithFakeWs(ws);
    socketHandle.send('hello');
    expect(ws.send).toHaveBeenCalledWith('hello');
  });

  it('handle.close(code, reason) calls ws.close(code, reason)', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const { socketHandle } = setupWithFakeWs(ws);
    socketHandle.close(1001, 'bye');
    expect(ws.close).toHaveBeenCalledWith(1001, 'bye');
  });

  it('handle.ping() calls ws.ping()', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const { socketHandle } = setupWithFakeWs(ws);
    socketHandle.ping();
    expect(ws.ping).toHaveBeenCalled();
  });

  it('handle.onMessage(handler) subscribes to ws "message" events', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const { socketHandle } = setupWithFakeWs(ws);
    const h = jest.fn();
    socketHandle.onMessage(h);
    expect(ws.on).toHaveBeenCalledWith('message', expect.any(Function));
  });
});

// ─── readBody: rejection shape & stream error ────────────────────────────────

describe('readBody: rejection details', () => {
  it('rejects with { tooLarge: true } when body exceeds maxBytes', async () => {
    const req = makeReadable(['a'.repeat(101)]) as unknown as http.IncomingMessage;
    await expect(readBody(req, 100)).rejects.toMatchObject({ tooLarge: true });
  });

  it("rejects when the underlying stream emits 'error'", async () => {
    const r = new Readable({ read() {} });
    // Defensive noop error listener: prevents Node from crashing if the
    // current readBody skeleton has not yet attached one. Real impl will
    // attach its own; both listeners fire harmlessly.
    r.on('error', () => {});
    const p = (async () =>
      readBody(r as unknown as http.IncomingMessage, 1024))();
    setImmediate(() => r.emit('error', new Error('stream broke')));
    await expect(p).rejects.toBeDefined();
  });
});

// ─── writeHttpResponse: optional headers ─────────────────────────────────────

describe('writeHttpResponse: optional headers', () => {
  it('writes status and ends even when headers field is absent', () => {
    const res = makeFakeResponse();
    writeHttpResponse(res as unknown as http.ServerResponse, { status: 204 });
    expect(res.writeHead).toHaveBeenCalled();
    const [status] = res.writeHead.mock.calls[0];
    expect(status).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });
});

// ─── SocketHandle adapter: remaining surface ─────────────────────────────────

describe('createUpgradeHandler: SocketHandle adapter (remaining surface)', () => {
  const drive = (ws: WsSocket) => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue({ id: 'r' });
    wss.handleUpgrade.mockImplementation((_req, _sock, _head, cb) => cb(ws));

    const handler = createUpgradeHandler({
      wss,
      registry,
      bus: makeFakeBus(),
      config: makeConfig(),
    });
    handler(
      { url: '/ws/r', headers: {} } as unknown as http.IncomingMessage,
      makeFakeSocket(),
      Buffer.alloc(0),
    );
    const [socketHandle] = mockHandleConnection.mock.calls[0] as [
      {
        terminate: () => void;
        onPong: (h: () => void) => void;
        onClose: (h: () => void) => void;
        onMessage: (h: (d: string) => void) => void;
      },
      unknown,
    ];
    return socketHandle;
  };

  it('handle.terminate() calls ws.terminate()', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const handle = drive(ws);
    handle.terminate();
    expect(ws.terminate).toHaveBeenCalled();
  });

  it('handle.onPong(handler) subscribes to ws "pong" events', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const handle = drive(ws);
    handle.onPong(jest.fn());
    expect(ws.on).toHaveBeenCalledWith('pong', expect.any(Function));
  });

  it('handle.onClose(handler) subscribes to ws "close" events', () => {
    const ws: WsSocket = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const handle = drive(ws);
    handle.onClose(jest.fn());
    expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('handle.onMessage handler receives a string when ws emits a Buffer', () => {
    let captured: ((data: Buffer | string) => void) | undefined;
    const onFn = jest.fn((event: string, listener: (data: Buffer | string) => void) => {
      if (event === 'message') captured = listener;
      return ws;
    });
    const ws: WsSocket = {
      on: onFn as unknown as WsSocket['on'],
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
    };
    const handle = drive(ws);
    const userHandler = jest.fn();
    handle.onMessage(userHandler);
    captured?.(Buffer.from('hello'));
    expect(userHandler).toHaveBeenCalledWith('hello');
    expect(typeof userHandler.mock.calls[0][0]).toBe('string');
  });
});

// ─── 404 exact wire bytes ─────────────────────────────────────────────────────

describe('createUpgradeHandler: 404 wire bytes', () => {
  it('writes exactly "HTTP/1.1 404 Not Found\\r\\n\\r\\n" on miss', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue(undefined);

    const handler = createUpgradeHandler({
      wss,
      registry,
      bus: makeFakeBus(),
      config: makeConfig(),
    });
    const socket = makeFakeSocket();
    handler(
      { url: '/ws/missing', headers: {} } as unknown as http.IncomingMessage,
      socket,
      Buffer.alloc(0),
    );
    expect(socket.write).toHaveBeenCalledWith('HTTP/1.1 404 Not Found\r\n\r\n');
  });
});

// ─── roomId URL parsing edges ────────────────────────────────────────────────

describe('createUpgradeHandler: roomId URL parsing edges', () => {
  it('parses roomId despite a trailing slash (/ws/abc/)', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue(undefined);

    const handler = createUpgradeHandler({
      wss,
      registry,
      bus: makeFakeBus(),
      config: makeConfig(),
    });
    handler(
      { url: '/ws/abc/', headers: {} } as unknown as http.IncomingMessage,
      makeFakeSocket(),
      Buffer.alloc(0),
    );
    expect(registry.getRoom).toHaveBeenCalledWith('abc');
  });

  it('strips query string when parsing roomId (/ws/abc?token=x)', () => {
    const wss = makeFakeWss();
    const registry = makeFakeRegistry();
    (registry.getRoom as jest.Mock).mockReturnValue(undefined);

    const handler = createUpgradeHandler({
      wss,
      registry,
      bus: makeFakeBus(),
      config: makeConfig(),
    });
    handler(
      { url: '/ws/abc?token=x', headers: {} } as unknown as http.IncomingMessage,
      makeFakeSocket(),
      Buffer.alloc(0),
    );
    expect(registry.getRoom).toHaveBeenCalledWith('abc');
  });
});
