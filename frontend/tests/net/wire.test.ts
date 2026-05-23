import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { DiagramEvent, Element } from '@fluxboard/domain';

import { backendOrigin, connect, createRoom, roomsUrl, wsOrigin, wsUrl } from '../../src/net/wire';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const i = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!i) throw new Error('no FakeWebSocket instance');
    return i;
  }
  url: string;
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '', wasClean: true });
  }
  triggerOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  triggerMessage(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  triggerClose(code: number, reason = '', wasClean = false): void {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean });
  }
}

const baseCallbacks = () => ({
  onSync: vi.fn(),
  onPeerEvent: vi.fn(),
  onAck: vi.fn(),
  onError: vi.fn(),
  onRoomDestroyed: vi.fn(),
  onClose: vi.fn(),
  onOpen: vi.fn(),
});

const elem: Element = { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 };

const evt = (id: string): DiagramEvent => ({
  id,
  type: 'ElementCreated',
  timestamp: 0,
  userId: 'u',
  payload: elem,
});

describe('URL resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('backendOrigin uses VITE_BACKEND_URL when set', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://api.example.com');
    expect(backendOrigin()).toBe('http://api.example.com');
  });

  test('backendOrigin strips trailing slashes', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://api.example.com///');
    expect(backendOrigin()).toBe('http://api.example.com');
  });

  test('backendOrigin falls back to window.location.origin when env empty', () => {
    vi.stubEnv('VITE_BACKEND_URL', '');
    expect(backendOrigin()).toBe(window.location.origin);
  });

  test('wsOrigin maps http to ws', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://x:1');
    expect(wsOrigin()).toBe('ws://x:1');
  });

  test('wsOrigin maps https to wss', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://x');
    expect(wsOrigin()).toBe('wss://x');
  });

  test('roomsUrl appends /rooms to backendOrigin', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    expect(roomsUrl()).toBe('http://h/rooms');
  });

  test('wsUrl appends /ws/<roomId>', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    expect(wsUrl('abc123')).toBe('ws://h/ws/abc123');
  });

  test('wsUrl encodes unusual room id characters', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    expect(wsUrl('a/b')).toBe('ws://h/ws/a%2Fb');
  });
});

describe('createRoom', () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  test('201 returns { roomId } parsed from body', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ roomId: 'abc12345' }),
    } as unknown as Response);
    expect(await createRoom()).toEqual({ roomId: 'abc12345' });
  });

  test('sends POST to /rooms with empty seed and JSON Content-Type', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ roomId: 'x' }),
    } as unknown as Response);
    await createRoom();
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('http://h/rooms');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ seed: { elements: {}, arrows: {} } });
  });

  test('400 throws create_failed with status and detail', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 400,
      json: async () => ({ error: 'invalid_seed', detail: 'bad' }),
    } as unknown as Response);
    await expect(createRoom()).rejects.toMatchObject({
      kind: 'create_failed',
      status: 400,
      detail: 'bad',
    });
  });

  test('413 throws create_failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 413,
      json: async () => ({}),
    } as unknown as Response);
    await expect(createRoom()).rejects.toMatchObject({ kind: 'create_failed', status: 413 });
  });

  test('415 throws create_failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 415,
      json: async () => ({}),
    } as unknown as Response);
    await expect(createRoom()).rejects.toMatchObject({ kind: 'create_failed', status: 415 });
  });

  test('5xx throws create_failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    await expect(createRoom()).rejects.toMatchObject({ kind: 'create_failed', status: 503 });
  });

  test('network failure throws kind: network', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(createRoom()).rejects.toMatchObject({ kind: 'network' });
  });

  test('passes signal through to fetch', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 201,
      json: async () => ({ roomId: 'x' }),
    } as unknown as Response);
    const controller = new AbortController();
    await createRoom({ signal: controller.signal });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  test('201 with malformed body (json throws) yields create_failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 201,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);
    await expect(createRoom()).rejects.toMatchObject({ kind: 'create_failed', status: 201 });
  });

  test('201 with missing roomId yields create_failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 201,
      json: async () => ({}),
    } as unknown as Response);
    await expect(createRoom()).rejects.toMatchObject({ kind: 'create_failed', status: 201 });
  });
});

describe('connect — open + join handshake', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('opens WebSocket at wsUrl(roomId)', () => {
    connect('room1', 'user1', baseCallbacks());
    expect(FakeWebSocket.last().url).toBe('ws://h/ws/room1');
  });

  test('on open sends {type:"join", userId} and fires onOpen', () => {
    const cb = baseCallbacks();
    connect('room1', 'user1', cb);
    FakeWebSocket.last().triggerOpen();
    expect(JSON.parse(FakeWebSocket.last().sent[0]!)).toEqual({ type: 'join', userId: 'user1' });
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('connect — outbound buffering before sync', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('events sent before sync are buffered, drained on sync in order', () => {
    const cb = baseCallbacks();
    const h = connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    h.send(evt('e1'));
    h.send(evt('e2'));
    expect(FakeWebSocket.last().sent).toHaveLength(1); // only join

    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'room',
      state: { elements: {}, arrows: {} },
    });
    const sent = FakeWebSocket.last().sent;
    expect(sent).toHaveLength(3);
    expect(JSON.parse(sent[1]!)).toEqual({ type: 'event', event: evt('e1') });
    expect(JSON.parse(sent[2]!)).toEqual({ type: 'event', event: evt('e2') });
  });

  test('events sent after sync go direct', () => {
    const cb = baseCallbacks();
    const h = connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'room',
      state: { elements: {}, arrows: {} },
    });
    h.send(evt('e1'));
    const sent = FakeWebSocket.last().sent;
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1]!)).toEqual({ type: 'event', event: evt('e1') });
  });

  test('buffer overflow drops oldest and console.warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    const h = connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    for (let i = 0; i < 65; i++) h.send(evt(`e${i}`));
    expect(warnSpy).toHaveBeenCalled();

    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'room',
      state: { elements: {}, arrows: {} },
    });
    const drained = FakeWebSocket.last().sent.slice(1);
    expect(drained).toHaveLength(64);
    expect(JSON.parse(drained[0]!).event.id).toBe('e1');
    expect(JSON.parse(drained[63]!).event.id).toBe('e64');
    warnSpy.mockRestore();
  });
});

describe('connect — inbound dispatch', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const peerEvent: DiagramEvent = {
    id: 'p1',
    type: 'ElementCreated',
    timestamp: 0,
    userId: 'peer',
    payload: elem,
  };

  test('sync dispatches onSync with roomId and state', () => {
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'room-x',
      state: { elements: { r1: elem }, arrows: {} },
    });
    expect(cb.onSync).toHaveBeenCalledTimes(1);
    expect(cb.onSync).toHaveBeenCalledWith({
      roomId: 'room-x',
      state: { elements: { r1: elem }, arrows: {} },
    });
  });

  test('event dispatches onPeerEvent with the inner event', () => {
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ type: 'event', event: peerEvent });
    expect(cb.onPeerEvent).toHaveBeenCalledWith(peerEvent);
  });

  test('ack dispatches onAck with eventId and status', () => {
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ type: 'ack', eventId: 'e1', status: 'applied' });
    expect(cb.onAck).toHaveBeenCalledWith('e1', 'applied');
  });

  test('error dispatches onError with code/message/eventId and console.warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'error',
      code: 'invalid_event',
      message: 'bad',
      eventId: 'e1',
    });
    expect(cb.onError).toHaveBeenCalledWith({
      code: 'invalid_event',
      message: 'bad',
      eventId: 'e1',
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('error frame without optional fields still dispatched with bare code', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ type: 'error', code: 'bad_json' });
    expect(cb.onError).toHaveBeenCalledWith({ code: 'bad_json' });
    warnSpy.mockRestore();
  });

  test('room_destroyed dispatches onRoomDestroyed with reason', () => {
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ type: 'room_destroyed', reason: 'shutdown' });
    expect(cb.onRoomDestroyed).toHaveBeenCalledWith('shutdown');
  });

  test('pong is ignored — no callback fires', () => {
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ type: 'pong' });
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(cb.onPeerEvent).not.toHaveBeenCalled();
    expect(cb.onAck).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onRoomDestroyed).not.toHaveBeenCalled();
  });

  test('unknown message type is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ type: 'whatever' });
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('non-string frame data is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().onmessage?.({ data: new ArrayBuffer(4) });
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('bad JSON is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage('not json');
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('non-object root is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage('42');
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('missing type field is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({ foo: 'bar' });
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('sync without state.elements is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'r',
      state: { arrows: {} },
    });
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('sync without state.arrows is logged and ignored', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'r',
      state: { elements: {} },
    });
    expect(cb.onSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('event frame with unknown DiagramEvent discriminant is dropped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'event',
      event: { id: 'x', type: 'BogusKind', timestamp: 0, userId: 'p', payload: {} },
    });
    expect(cb.onPeerEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('connect — close handling', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('close from server forwards code, reason, wasClean', () => {
    const cb = baseCallbacks();
    connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerClose(4404, 'Not Found', false);
    expect(cb.onClose).toHaveBeenCalledWith({ code: 4404, reason: 'Not Found', wasClean: false });
  });

  test('handle.close() initiates a 1000 normal close', () => {
    const cb = baseCallbacks();
    const h = connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    const closeSpy = vi.spyOn(FakeWebSocket.last(), 'close');
    h.close();
    expect(closeSpy).toHaveBeenCalledWith(1000);
  });

  test('handle.close(code) forwards a custom code', () => {
    const cb = baseCallbacks();
    const h = connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    const closeSpy = vi.spyOn(FakeWebSocket.last(), 'close');
    h.close(4400);
    expect(closeSpy).toHaveBeenCalledWith(4400);
  });
});

describe('connect — outbound event wrapping', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://h');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('handle.send post-sync wraps event in {type:"event", event}', () => {
    const cb = baseCallbacks();
    const h = connect('room', 'u', cb);
    FakeWebSocket.last().triggerOpen();
    FakeWebSocket.last().triggerMessage({
      type: 'sync',
      roomId: 'room',
      state: { elements: {}, arrows: {} },
    });
    const e: DiagramEvent = {
      id: 'e1',
      type: 'ElementCreated',
      timestamp: 7,
      userId: 'u',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
    };
    h.send(e);
    const sent = FakeWebSocket.last().sent;
    expect(JSON.parse(sent[sent.length - 1]!)).toEqual({ type: 'event', event: e });
  });
});
