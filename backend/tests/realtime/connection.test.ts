import { handleConnection, SocketHandle, ConnectionContext } from '@/realtime/connection';
import { Room, ClientHandle } from '@/realtime/rooms/room';
import { parseClientMessage, ParseResult } from '@/realtime/protocol/parse';
import { DiagramEvent } from '@/domain/types';

// Mock the parser so connection tests don't depend on parse.ts implementation.
jest.mock('@/realtime/protocol/parse', () => ({
  parseClientMessage: jest.fn(),
}));

const mockParse = parseClientMessage as jest.MockedFunction<typeof parseClientMessage>;

// ─── Fakes ───────────────────────────────────────────────────────────────────

type FakeSocket = SocketHandle & {
  send: jest.Mock;
  close: jest.Mock;
  terminate: jest.Mock;
  ping: jest.Mock;
  onMessage: jest.Mock;
  onPong: jest.Mock;
  onClose: jest.Mock;
  _emitMessage: (data: string) => void;
  _emitPong: () => void;
  _emitClose: () => void;
};

const makeFakeSocket = (): FakeSocket => {
  let messageHandler: ((data: string) => void) | null = null;
  let pongHandler: (() => void) | null = null;
  let closeHandler: (() => void) | null = null;
  return {
    send: jest.fn(),
    close: jest.fn(),
    terminate: jest.fn(),
    ping: jest.fn(),
    onMessage: jest.fn((h: (data: string) => void) => {
      messageHandler = h;
    }),
    onPong: jest.fn((h: () => void) => {
      pongHandler = h;
    }),
    onClose: jest.fn((h: () => void) => {
      closeHandler = h;
    }),
    _emitMessage: (data) => messageHandler?.(data),
    _emitPong: () => pongHandler?.(),
    _emitClose: () => closeHandler?.(),
  };
};

const makeFakeRoom = (): Room =>
  ({
    id: 'room-abc',
    createdAt: 1000,
    addClient: jest.fn(),
    removeClient: jest.fn(),
    applyAndBroadcast: jest.fn(),
    snapshot: jest.fn().mockReturnValue({ elements: {}, arrows: {} }),
    isEmpty: jest.fn(),
    disconnectAll: jest.fn(),
  }) as unknown as Room;

const makeContext = (room: Room): ConnectionContext => ({
  room,
  config: { joinTimeoutMs: 5_000, wsHeartbeatMs: 30_000 },
});

// Wraps the call so a throwing stub doesn't prevent test assertions.
const setup = (socket: SocketHandle, ctx: ConnectionContext): void => {
  try {
    handleConnection(socket, ctx);
  } catch {
    /* stub throws until implemented */
  }
};

const validEventMessage = (event?: Partial<DiagramEvent>): ParseResult => ({
  ok: true,
  message: {
    type: 'event',
    event: {
      id: 'evt-1',
      timestamp: 0,
      userId: 'client-claimed',
      type: 'ElementCreated',
      payload: {
        id: 'el-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      },
      ...event,
    } as DiagramEvent,
  },
});

const validPing: ParseResult = { ok: true, message: { type: 'ping' } };

const performJoin = (socket: FakeSocket, userId = 'user-1'): void => {
  mockParse.mockReturnValueOnce({ ok: true, message: { type: 'join', userId } });
  socket._emitMessage('raw-join');
};

const getAddedHandle = (room: Room): ClientHandle | undefined => {
  const addClient = room.addClient as jest.Mock;
  const call = addClient.mock.calls[0];
  return call ? (call[0] as ClientHandle) : undefined;
};

beforeEach(() => {
  mockParse.mockReset();
});

// ─── Setup: handler registration ─────────────────────────────────────────────

describe('handleConnection: setup', () => {
  it('registers an onMessage handler', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));
    expect(socket.onMessage).toHaveBeenCalledWith(expect.any(Function));
  });

  it('registers an onPong handler', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));
    expect(socket.onPong).toHaveBeenCalledWith(expect.any(Function));
  });

  it('registers an onClose handler', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));
    expect(socket.onClose).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ─── Join timeout ────────────────────────────────────────────────────────────

describe('handleConnection: join timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes with code 4408 if no join arrives within joinTimeoutMs', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    jest.advanceTimersByTime(4_999);
    expect(socket.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(socket.close).toHaveBeenCalledWith(4408, expect.any(String));
  });

  it('does not close if join arrives in time', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    jest.advanceTimersByTime(2_000);
    performJoin(socket);
    jest.advanceTimersByTime(60_000);

    expect(socket.close).not.toHaveBeenCalledWith(4408, expect.any(String));
  });
});

// ─── awaitingJoin: rejecting non-join messages ───────────────────────────────

describe('handleConnection: awaitingJoin → non-join messages', () => {
  it('replies must_join_first and closes 4400 when an event arrives before join', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));

    mockParse.mockReturnValueOnce(validEventMessage());
    socket._emitMessage('raw-event');

    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', code: 'must_join_first' }),
    );
    expect(socket.close).toHaveBeenCalledWith(4400, expect.any(String));
    expect(room.applyAndBroadcast).not.toHaveBeenCalled();
  });

  it('replies must_join_first and closes 4400 when a ping arrives before join', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    mockParse.mockReturnValueOnce(validPing);
    socket._emitMessage('raw-ping');

    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', code: 'must_join_first' }),
    );
    expect(socket.close).toHaveBeenCalledWith(4400, expect.any(String));
  });
});

// ─── awaitingJoin: parser errors ─────────────────────────────────────────────

describe('handleConnection: awaitingJoin → parser errors', () => {
  it('replies bad_json and closes 1003 when JSON is unparseable', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    mockParse.mockReturnValueOnce({
      ok: false,
      error: { code: 'bad_json', message: 'not json' },
    });
    socket._emitMessage('raw');

    const sent = (socket.send.mock.calls[0]?.[0] ?? '') as string;
    expect(JSON.parse(sent)).toMatchObject({ type: 'error', code: 'bad_json' });
    expect(socket.close).toHaveBeenCalledWith(1003, expect.any(String));
  });

  it('replies invalid_join and closes 4400 when the join payload is malformed', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    mockParse.mockReturnValueOnce({
      ok: false,
      error: { code: 'invalid_join', message: 'missing userId' },
    });
    socket._emitMessage('raw-bad-join');

    const sent = (socket.send.mock.calls[0]?.[0] ?? '') as string;
    expect(JSON.parse(sent)).toMatchObject({ type: 'error', code: 'invalid_join' });
    expect(socket.close).toHaveBeenCalledWith(4400, expect.any(String));
  });

  it('replies unknown_message but does NOT close on an unrecognized type', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    mockParse.mockReturnValueOnce({
      ok: false,
      error: { code: 'unknown_message', message: 'foo' },
    });
    socket._emitMessage('raw-foo');

    const sent = (socket.send.mock.calls[0]?.[0] ?? '') as string;
    expect(JSON.parse(sent)).toMatchObject({ type: 'error', code: 'unknown_message' });
    expect(socket.close).not.toHaveBeenCalled();
  });
});

// ─── Join success ────────────────────────────────────────────────────────────

describe('handleConnection: join success', () => {
  it('calls room.addClient with a ClientHandle carrying the joined userId', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket, 'alice');

    expect(room.addClient).toHaveBeenCalledTimes(1);
    const handle = getAddedHandle(room);
    expect(handle?.userId).toBe('alice');
  });

  it('the ClientHandle has a non-empty string connectionId', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);

    const handle = getAddedHandle(room);
    expect(typeof handle?.connectionId).toBe('string');
    expect(handle?.connectionId.length ?? 0).toBeGreaterThan(0);
  });

  it('sends a sync message immediately after join', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);

    const sent = socket.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const sync = sent.find((m) => m.type === 'sync');
    expect(sync).toBeDefined();
    expect(sync.roomId).toBe('room-abc');
    expect(sync.state).toEqual({ elements: {}, arrows: {} });
  });

  it('two distinct connections get distinct connectionIds', () => {
    const room = makeFakeRoom();

    const socket1 = makeFakeSocket();
    setup(socket1, makeContext(room));
    performJoin(socket1, 'alice');
    const id1 = getAddedHandle(room)?.connectionId;

    (room.addClient as jest.Mock).mockClear();

    const socket2 = makeFakeSocket();
    setup(socket2, makeContext(room));
    performJoin(socket2, 'bob');
    const id2 = getAddedHandle(room)?.connectionId;

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

// ─── joined: rejects second join ─────────────────────────────────────────────

describe('handleConnection: joined → second join', () => {
  it('replies already_joined and closes 4400 when a second join arrives', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);
    socket.close.mockClear();
    socket.send.mockClear();

    mockParse.mockReturnValueOnce({
      ok: true,
      message: { type: 'join', userId: 'user-2' },
    });
    socket._emitMessage('raw-rejoin');

    const sent = (socket.send.mock.calls[0]?.[0] ?? '') as string;
    expect(JSON.parse(sent)).toMatchObject({ type: 'error', code: 'already_joined' });
    expect(socket.close).toHaveBeenCalledWith(4400, expect.any(String));
  });
});

// ─── joined: ping ────────────────────────────────────────────────────────────

describe('handleConnection: joined → ping', () => {
  it('replies with a pong message (and nothing else)', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);
    socket.send.mockClear();

    mockParse.mockReturnValueOnce(validPing);
    socket._emitMessage('raw-ping');

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0] as string)).toEqual({ type: 'pong' });
  });
});

// ─── joined: event flow ──────────────────────────────────────────────────────

describe('handleConnection: joined → event flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-26T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-stamps event.timestamp with Date.now() before applyAndBroadcast', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket, 'user-1');

    mockParse.mockReturnValueOnce(validEventMessage({ timestamp: 0 }));
    socket._emitMessage('raw-event');

    const stampedEvent = (room.applyAndBroadcast as jest.Mock).mock.calls[0]?.[0] as DiagramEvent;
    expect(stampedEvent.timestamp).toBe(Date.now());
  });

  it('re-stamps event.userId with the connection-bound userId, ignoring client-claimed value', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket, 'connection-user');

    mockParse.mockReturnValueOnce(validEventMessage({ userId: 'spoofed-user' }));
    socket._emitMessage('raw-event');

    const stampedEvent = (room.applyAndBroadcast as jest.Mock).mock.calls[0]?.[0] as DiagramEvent;
    expect(stampedEvent.userId).toBe('connection-user');
  });

  it('preserves event.id, event.type, and event.payload', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);

    mockParse.mockReturnValueOnce(validEventMessage());
    socket._emitMessage('raw-event');

    const stampedEvent = (room.applyAndBroadcast as jest.Mock).mock.calls[0]?.[0] as DiagramEvent;
    expect(stampedEvent.id).toBe('evt-1');
    expect(stampedEvent.type).toBe('ElementCreated');
    expect((stampedEvent as { payload: unknown }).payload).toEqual({
      id: 'el-1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it('passes the connection-bound connectionId as the broadcast origin', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);
    const expectedConnectionId = getAddedHandle(room)?.connectionId;

    mockParse.mockReturnValueOnce(validEventMessage());
    socket._emitMessage('raw-event');

    expect(room.applyAndBroadcast).toHaveBeenCalledWith(expect.anything(), expectedConnectionId);
  });
});

// ─── joined: invalid_event ───────────────────────────────────────────────────

describe('handleConnection: joined → invalid_event', () => {
  it('sends an error but does NOT close the connection', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);
    socket.close.mockClear();
    socket.send.mockClear();

    mockParse.mockReturnValueOnce({
      ok: false,
      error: { code: 'invalid_event', message: 'bad shape', eventId: 'evt-broken' },
    });
    socket._emitMessage('raw-bad-event');

    const sent = (socket.send.mock.calls[0]?.[0] ?? '') as string;
    expect(JSON.parse(sent)).toMatchObject({
      type: 'error',
      code: 'invalid_event',
      eventId: 'evt-broken',
    });
    expect(socket.close).not.toHaveBeenCalled();
    expect(room.applyAndBroadcast).not.toHaveBeenCalled();
  });

  it('a subsequent valid event still dispatches normally', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);

    mockParse.mockReturnValueOnce({
      ok: false,
      error: { code: 'invalid_event', message: 'bad' },
    });
    socket._emitMessage('raw-bad');

    mockParse.mockReturnValueOnce(validEventMessage());
    socket._emitMessage('raw-good');

    expect(room.applyAndBroadcast).toHaveBeenCalledTimes(1);
  });
});

// ─── Heartbeat ───────────────────────────────────────────────────────────────

describe('handleConnection: heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends a ping every wsHeartbeatMs after join', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));
    performJoin(socket);

    expect(socket.ping).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    expect(socket.ping).toHaveBeenCalledTimes(1);

    // Simulate a healthy response.
    socket._emitPong();

    jest.advanceTimersByTime(30_000);
    expect(socket.ping).toHaveBeenCalledTimes(2);
  });

  it('does not terminate on the first interval (isAlive starts true)', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));
    performJoin(socket);

    jest.advanceTimersByTime(30_000);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('terminates the socket if no pong arrived between two intervals', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));
    performJoin(socket);

    // First interval: alive=true (initial), sets alive=false, sends ping.
    jest.advanceTimersByTime(30_000);
    expect(socket.terminate).not.toHaveBeenCalled();
    // No pong received before the next interval.
    jest.advanceTimersByTime(30_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not start heartbeat before join', () => {
    const socket = makeFakeSocket();
    setup(socket, makeContext(makeFakeRoom()));

    jest.advanceTimersByTime(60_000);
    expect(socket.ping).not.toHaveBeenCalled();
  });
});

// ─── ClientHandle integration ────────────────────────────────────────────────

describe('handleConnection: ClientHandle integration', () => {
  it('handle.send(msg) writes JSON.stringify(msg) to the socket', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);

    const handle = getAddedHandle(room);
    socket.send.mockClear();
    handle?.send({ type: 'pong' });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
  });

  it('handle.close(code, reason) closes the socket with the same args', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);

    const handle = getAddedHandle(room);
    socket.close.mockClear();
    handle?.close(1001, 'going_away');

    expect(socket.close).toHaveBeenCalledWith(1001, 'going_away');
  });

  it('handle.send swallows socket.send throws so the broadcast loop survives', () => {
    const socket = makeFakeSocket();
    socket.send.mockImplementation(() => {
      throw new Error('socket dead');
    });
    const room = makeFakeRoom();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setup(socket, makeContext(room));
      performJoin(socket);
      const handle = getAddedHandle(room);

      expect(() => handle?.send({ type: 'pong' })).not.toThrow();
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ─── Close cleanup ───────────────────────────────────────────────────────────

describe('handleConnection: close cleanup', () => {
  it('removes the client from the room when the socket closes after join', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));
    performJoin(socket);
    const handle = getAddedHandle(room);

    socket._emitClose();

    expect(room.removeClient).toHaveBeenCalledWith(handle?.connectionId);
  });

  it('does NOT call removeClient if the socket closes before join', () => {
    const socket = makeFakeSocket();
    const room = makeFakeRoom();
    setup(socket, makeContext(room));

    socket._emitClose();

    expect(room.removeClient).not.toHaveBeenCalled();
  });

  it('stops the heartbeat after close', () => {
    jest.useFakeTimers();
    try {
      const socket = makeFakeSocket();
      setup(socket, makeContext(makeFakeRoom()));
      performJoin(socket);

      socket._emitClose();
      socket.ping.mockClear();
      jest.advanceTimersByTime(60_000);

      expect(socket.ping).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
