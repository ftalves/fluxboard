import { Room, ClientHandle, RoomOptions } from '@/realtime/rooms/room';
import { EventBus } from '@/event-bus/bus';
import { DiagramState, DiagramEvent, Element, Arrow } from '@/domain/types';

// ─── Fakes / factories ───────────────────────────────────────────────────────

const makeFakeBus = (): EventBus =>
  ({
    publish: jest.fn(),
    subscribe: jest.fn().mockReturnValue(() => {}),
    close: jest.fn(),
  }) as unknown as EventBus;

const makeFakeClient = (
  connectionId = 'conn-1',
  userId = 'user-1',
): ClientHandle & { send: jest.Mock; close: jest.Mock } => ({
  connectionId,
  userId,
  send: jest.fn(),
  close: jest.fn(),
});

const emptyDiagramState = (): DiagramState => ({
  elements: {},
  arrows: {},
  processedEventIds: {},
});

const makeElement = (overrides: Partial<Element> = {}): Element => ({
  id: 'el-1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...overrides,
});

const makeArrow = (overrides: Partial<Arrow> = {}): Arrow => ({
  id: 'arrow-1',
  fromElementId: 'el-1',
  toElementId: 'el-2',
  ...overrides,
});

const baseEvent = { timestamp: 1000, userId: 'user-1' };

const elementCreatedEvent = (id = 'evt-1', element = makeElement()): DiagramEvent => ({
  ...baseEvent,
  id,
  type: 'ElementCreated',
  payload: element,
});

const elementMovedEvent = (
  id = 'evt-2',
  payload: { id: string; x: number; y: number } = { id: 'el-1', x: 10, y: 20 },
): DiagramEvent => ({
  ...baseEvent,
  id,
  type: 'ElementMoved',
  payload,
});

const makeRoom = (overrides: Partial<RoomOptions> = {}): Room =>
  new Room({
    id: 'room-1',
    state: emptyDiagramState(),
    bus: makeFakeBus(),
    gracePeriodMs: 30_000,
    onGraceExpired: jest.fn(),
    ...overrides,
  });

// ─── Construction & basic accessors ──────────────────────────────────────────

describe('Room: construction', () => {
  it('exposes the id passed at construction', () => {
    const room = makeRoom({ id: 'abc12345' });
    expect(room.id).toBe('abc12345');
  });

  it('records createdAt at construction time', () => {
    const before = Date.now();
    const room = makeRoom();
    const after = Date.now();
    expect(room.createdAt).toBeGreaterThanOrEqual(before);
    expect(room.createdAt).toBeLessThanOrEqual(after);
  });
});

// ─── snapshot() — public projection ──────────────────────────────────────────

describe('Room: snapshot', () => {
  it('returns the elements and arrows of the current state', () => {
    const element = makeElement();
    const arrow = makeArrow({ fromElementId: 'el-1', toElementId: 'el-1' });
    const state: DiagramState = {
      elements: { 'el-1': element },
      arrows: { 'arrow-1': arrow },
      processedEventIds: {},
    };
    const room = makeRoom({ state });

    expect(room.snapshot()).toEqual({
      elements: { 'el-1': element },
      arrows: { 'arrow-1': arrow },
    });
  });

  it('omits processedEventIds (the internal idempotency map)', () => {
    const state: DiagramState = {
      elements: {},
      arrows: {},
      processedEventIds: { 'evt-old': true },
    };
    const room = makeRoom({ state });

    expect(room.snapshot()).not.toHaveProperty('processedEventIds');
  });
});

// ─── isEmpty / addClient / removeClient ──────────────────────────────────────

describe('Room: client membership', () => {
  it('isEmpty returns true for a fresh room', () => {
    expect(makeRoom().isEmpty()).toBe(true);
  });

  it('isEmpty returns false after addClient', () => {
    const room = makeRoom();
    room.addClient(makeFakeClient());
    expect(room.isEmpty()).toBe(false);
  });

  it('isEmpty returns true after the last client is removed', () => {
    const room = makeRoom();
    const client = makeFakeClient('conn-1');
    room.addClient(client);
    room.removeClient('conn-1');
    expect(room.isEmpty()).toBe(true);
  });

  it('isEmpty stays false while at least one client remains', () => {
    const room = makeRoom();
    room.addClient(makeFakeClient('conn-1'));
    room.addClient(makeFakeClient('conn-2'));
    room.removeClient('conn-1');
    expect(room.isEmpty()).toBe(false);
  });

  it('removeClient with an unknown connectionId is a no-op', () => {
    const room = makeRoom();
    room.addClient(makeFakeClient('conn-1'));
    expect(() => room.removeClient('conn-unknown')).not.toThrow();
    expect(room.isEmpty()).toBe(false);
  });
});

// ─── applyAndBroadcast: applied path ─────────────────────────────────────────

describe('Room: applyAndBroadcast — applied', () => {
  it('updates the visible state when the event applies', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    const event = elementCreatedEvent('evt-1', makeElement({ id: 'el-new' }));
    room.applyAndBroadcast(event, 'conn-1');

    expect(room.snapshot().elements['el-new']).toBeDefined();
  });

  it('broadcasts the event to all peers except the sender', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    const peerA = makeFakeClient('conn-2');
    const peerB = makeFakeClient('conn-3');
    room.addClient(sender);
    room.addClient(peerA);
    room.addClient(peerB);

    const event = elementCreatedEvent();
    room.applyAndBroadcast(event, 'conn-1');

    expect(peerA.send).toHaveBeenCalledWith({ type: 'event', event });
    expect(peerB.send).toHaveBeenCalledWith({ type: 'event', event });
    // Sender does not receive an `event` echo.
    const senderEventCalls = sender.send.mock.calls.filter(
      ([msg]) => (msg as { type: string }).type === 'event',
    );
    expect(senderEventCalls).toHaveLength(0);
  });

  it('acks the sender with status "applied"', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    room.applyAndBroadcast(elementCreatedEvent('evt-1'), 'conn-1');

    expect(sender.send).toHaveBeenCalledWith({
      type: 'ack',
      eventId: 'evt-1',
      status: 'applied',
    });
  });

  it('publishes domain.event to the bus on apply', () => {
    const bus = makeFakeBus();
    const room = makeRoom({ bus });
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    const event = elementCreatedEvent('evt-1');
    room.applyAndBroadcast(event, 'conn-1');

    expect(bus.publish).toHaveBeenCalledWith('domain.event', {
      roomId: 'room-1',
      event,
    });
  });
});

// ─── applyAndBroadcast: duplicate path ───────────────────────────────────────

describe('Room: applyAndBroadcast — duplicate', () => {
  it('acks the sender with status "duplicate" when the event id was already processed', () => {
    const state: DiagramState = {
      elements: {},
      arrows: {},
      processedEventIds: { 'evt-1': true },
    };
    const room = makeRoom({ state });
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    room.applyAndBroadcast(elementCreatedEvent('evt-1'), 'conn-1');

    expect(sender.send).toHaveBeenCalledWith({
      type: 'ack',
      eventId: 'evt-1',
      status: 'duplicate',
    });
  });

  it('does not broadcast a duplicate to peers', () => {
    const state: DiagramState = {
      elements: {},
      arrows: {},
      processedEventIds: { 'evt-1': true },
    };
    const room = makeRoom({ state });
    const sender = makeFakeClient('conn-1');
    const peer = makeFakeClient('conn-2');
    room.addClient(sender);
    room.addClient(peer);

    room.applyAndBroadcast(elementCreatedEvent('evt-1'), 'conn-1');

    expect(peer.send).not.toHaveBeenCalled();
  });

  it('does not publish a duplicate to the bus', () => {
    const bus = makeFakeBus();
    const state: DiagramState = {
      elements: {},
      arrows: {},
      processedEventIds: { 'evt-1': true },
    };
    const room = makeRoom({ bus, state });
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    room.applyAndBroadcast(elementCreatedEvent('evt-1'), 'conn-1');

    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('does not modify visible state on duplicate', () => {
    const state: DiagramState = {
      elements: { 'el-existing': makeElement({ id: 'el-existing' }) },
      arrows: {},
      processedEventIds: { 'evt-1': true },
    };
    const room = makeRoom({ state });
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    room.applyAndBroadcast(elementCreatedEvent('evt-1', makeElement({ id: 'el-new' })), 'conn-1');

    const snap = room.snapshot();
    expect(snap.elements['el-new']).toBeUndefined();
    expect(snap.elements['el-existing']).toBeDefined();
  });
});

// ─── applyAndBroadcast: rejected path ────────────────────────────────────────

describe('Room: applyAndBroadcast — rejected', () => {
  it('acks the sender with status "rejected" when the event semantically no-ops', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    // ElementMoved on a non-existent element: applyEvent returns a new state
    // with only `processedEventIds` updated. No element was moved.
    room.applyAndBroadcast(elementMovedEvent('evt-rej', { id: 'ghost', x: 1, y: 2 }), 'conn-1');

    expect(sender.send).toHaveBeenCalledWith({
      type: 'ack',
      eventId: 'evt-rej',
      status: 'rejected',
    });
  });

  it('does not broadcast a rejected event to peers', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    const peer = makeFakeClient('conn-2');
    room.addClient(sender);
    room.addClient(peer);

    room.applyAndBroadcast(elementMovedEvent('evt-rej', { id: 'ghost', x: 1, y: 2 }), 'conn-1');

    expect(peer.send).not.toHaveBeenCalled();
  });

  it('does not publish a rejected event to the bus', () => {
    const bus = makeFakeBus();
    const room = makeRoom({ bus });
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    room.applyAndBroadcast(elementMovedEvent('evt-rej', { id: 'ghost', x: 1, y: 2 }), 'conn-1');

    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('leaves the visible state unchanged on rejection', () => {
    const initial = makeElement({ id: 'el-1', x: 0, y: 0 });
    const state: DiagramState = {
      elements: { 'el-1': initial },
      arrows: {},
      processedEventIds: {},
    };
    const room = makeRoom({ state });
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    const before = room.snapshot();
    room.applyAndBroadcast(elementMovedEvent('evt-rej', { id: 'ghost', x: 1, y: 2 }), 'conn-1');

    expect(room.snapshot()).toEqual(before);
  });

  it('commits the rejection so retries with the same event id are reported as duplicate', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    room.addClient(sender);

    // First send: rejected.
    room.applyAndBroadcast(elementMovedEvent('evt-rej', { id: 'ghost', x: 1, y: 2 }), 'conn-1');
    // Second send with the SAME event id: the rejection-commit means the id
    // is already in processedEventIds, so step 2 catches it as a duplicate.
    room.applyAndBroadcast(elementMovedEvent('evt-rej', { id: 'ghost', x: 1, y: 2 }), 'conn-1');

    expect(sender.send).toHaveBeenNthCalledWith(1, {
      type: 'ack',
      eventId: 'evt-rej',
      status: 'rejected',
    });
    expect(sender.send).toHaveBeenNthCalledWith(2, {
      type: 'ack',
      eventId: 'evt-rej',
      status: 'duplicate',
    });
  });
});

// ─── applyAndBroadcast: send-failure isolation ───────────────────────────────

describe('Room: applyAndBroadcast — send error isolation', () => {
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('a peer whose send throws does not prevent siblings from receiving the broadcast', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    const flaky = makeFakeClient('conn-2');
    flaky.send.mockImplementation(() => {
      throw new Error('socket closed');
    });
    const healthy = makeFakeClient('conn-3');
    room.addClient(sender);
    room.addClient(flaky);
    room.addClient(healthy);

    room.applyAndBroadcast(elementCreatedEvent(), 'conn-1');

    expect(healthy.send).toHaveBeenCalled();
  });

  it('the sender still receives an ack even if a peer send throws', () => {
    const room = makeRoom();
    const sender = makeFakeClient('conn-1');
    const flaky = makeFakeClient('conn-2');
    flaky.send.mockImplementation(() => {
      throw new Error('socket closed');
    });
    room.addClient(sender);
    room.addClient(flaky);

    room.applyAndBroadcast(elementCreatedEvent('evt-1'), 'conn-1');

    expect(sender.send).toHaveBeenCalledWith({
      type: 'ack',
      eventId: 'evt-1',
      status: 'applied',
    });
  });
});

// ─── disconnectAll ───────────────────────────────────────────────────────────

describe('Room: disconnectAll', () => {
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('sends room_destroyed with the given reason to every client', () => {
    const room = makeRoom();
    const a = makeFakeClient('conn-a');
    const b = makeFakeClient('conn-b');
    room.addClient(a);
    room.addClient(b);

    room.disconnectAll('shutdown');

    expect(a.send).toHaveBeenCalledWith({ type: 'room_destroyed', reason: 'shutdown' });
    expect(b.send).toHaveBeenCalledWith({ type: 'room_destroyed', reason: 'shutdown' });
  });

  it('closes every client socket with code 1001 (going away)', () => {
    const room = makeRoom();
    const a = makeFakeClient('conn-a');
    const b = makeFakeClient('conn-b');
    room.addClient(a);
    room.addClient(b);

    room.disconnectAll('shutdown');

    expect(a.close).toHaveBeenCalledWith(1001, expect.any(String));
    expect(b.close).toHaveBeenCalledWith(1001, expect.any(String));
  });

  it('passes the reason verbatim (empty vs shutdown)', () => {
    const room = makeRoom();
    const a = makeFakeClient('conn-a');
    room.addClient(a);

    room.disconnectAll('empty');

    expect(a.send).toHaveBeenCalledWith({ type: 'room_destroyed', reason: 'empty' });
  });

  it('a send error on one client does not prevent siblings from being notified', () => {
    const room = makeRoom();
    const flaky = makeFakeClient('conn-flaky');
    flaky.send.mockImplementation(() => {
      throw new Error('socket dead');
    });
    const healthy = makeFakeClient('conn-healthy');
    room.addClient(flaky);
    room.addClient(healthy);

    expect(() => room.disconnectAll('shutdown')).not.toThrow();
    expect(healthy.send).toHaveBeenCalledWith({ type: 'room_destroyed', reason: 'shutdown' });
    expect(healthy.close).toHaveBeenCalled();
  });

  it('a close error on one client does not prevent siblings from being closed', () => {
    const room = makeRoom();
    const flaky = makeFakeClient('conn-flaky');
    flaky.close.mockImplementation(() => {
      throw new Error('already closed');
    });
    const healthy = makeFakeClient('conn-healthy');
    room.addClient(flaky);
    room.addClient(healthy);

    expect(() => room.disconnectAll('shutdown')).not.toThrow();
    expect(healthy.close).toHaveBeenCalled();
  });

  it('does not throw on an empty room', () => {
    const room = makeRoom();
    expect(() => room.disconnectAll('shutdown')).not.toThrow();
  });
});

// ─── Grace period ────────────────────────────────────────────────────────────

describe('Room: grace period', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules onGraceExpired after gracePeriodMs when the last client leaves', () => {
    const onGraceExpired = jest.fn();
    const room = makeRoom({ onGraceExpired, gracePeriodMs: 30_000 });
    room.addClient(makeFakeClient('conn-1'));
    room.removeClient('conn-1');

    jest.advanceTimersByTime(29_999);
    expect(onGraceExpired).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a grace timer when a non-last client leaves', () => {
    const onGraceExpired = jest.fn();
    const room = makeRoom({ onGraceExpired, gracePeriodMs: 30_000 });
    room.addClient(makeFakeClient('conn-1'));
    room.addClient(makeFakeClient('conn-2'));
    room.removeClient('conn-1');

    jest.advanceTimersByTime(60_000);
    expect(onGraceExpired).not.toHaveBeenCalled();
  });

  it('cancels a running grace timer when a new client joins within the window', () => {
    const onGraceExpired = jest.fn();
    const room = makeRoom({ onGraceExpired, gracePeriodMs: 30_000 });
    room.addClient(makeFakeClient('conn-1'));
    room.removeClient('conn-1');

    jest.advanceTimersByTime(15_000);
    room.addClient(makeFakeClient('conn-2'));
    jest.advanceTimersByTime(60_000);

    expect(onGraceExpired).not.toHaveBeenCalled();
  });

  it('schedules a fresh grace timer if the room becomes empty again', () => {
    const onGraceExpired = jest.fn();
    const room = makeRoom({ onGraceExpired, gracePeriodMs: 30_000 });

    // First emptiness: rejoin within window cancels.
    room.addClient(makeFakeClient('conn-1'));
    room.removeClient('conn-1');
    jest.advanceTimersByTime(15_000);
    room.addClient(makeFakeClient('conn-2'));
    jest.advanceTimersByTime(60_000);
    expect(onGraceExpired).not.toHaveBeenCalled();

    // Second emptiness: a fresh full grace period must elapse before firing.
    room.removeClient('conn-2');
    jest.advanceTimersByTime(29_999);
    expect(onGraceExpired).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });
});
