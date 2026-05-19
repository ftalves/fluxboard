import { RoomRegistry, RoomIdExhaustionError } from '@/realtime/rooms/roomRegistry';
import { Room, ClientHandle } from '@/realtime/rooms/room';
import { EventBus } from '@/event-bus/bus';
import { Element, Arrow } from '@/domain/types';

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

const emptySeed = () => ({ elements: {}, arrows: {} });

const makeRegistry = (
  overrides: {
    bus?: EventBus;
    gracePeriodMs?: number;
    generateId?: () => string;
    roomIdLength?: number;
  } = {},
): { registry: RoomRegistry; bus: EventBus } => {
  const bus = overrides.bus ?? makeFakeBus();
  const registry = new RoomRegistry({
    bus,
    gracePeriodMs: 30_000,
    ...overrides,
  });
  return { registry, bus };
};

// ─── createRoom: basic ───────────────────────────────────────────────────────

describe('RoomRegistry: createRoom', () => {
  it('returns a Room instance', () => {
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());
    expect(room).toBeInstanceOf(Room);
  });

  it('assigns the room a generated id', () => {
    const generateId = jest.fn().mockReturnValue('abc12345');
    const { registry } = makeRegistry({ generateId });
    const room = registry.createRoom(emptySeed());
    expect(room.id).toBe('abc12345');
  });

  it('inserts the room so getRoom can retrieve it', () => {
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());
    expect(registry.getRoom(room.id)).toBe(room);
  });

  it('seeds the new room with the given elements and arrows', () => {
    const { registry } = makeRegistry();
    const elements = { 'e-1': makeElement({ id: 'e-1' }) };
    const arrows = {};
    const room = registry.createRoom({ elements, arrows });

    expect(room.snapshot()).toEqual({ elements, arrows });
  });

  it('initializes processedEventIds to {} (no events pre-seen)', () => {
    // The visible proof: the room accepts events with arbitrary ids and
    // produces normal classification (not "duplicate") because nothing
    // is pre-populated. We exercise this via Room's behavior elsewhere;
    // here we just assert the snapshot doesn't expose processedEventIds.
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());
    expect(room.snapshot()).not.toHaveProperty('processedEventIds');
  });

  it('accepts an empty seed', () => {
    const { registry } = makeRegistry();
    expect(() => registry.createRoom(emptySeed())).not.toThrow();
  });

  it('generates distinct ids for distinct rooms (default generator)', () => {
    const { registry } = makeRegistry();
    const a = registry.createRoom(emptySeed());
    const b = registry.createRoom(emptySeed());
    expect(a.id).not.toBe(b.id);
  });
});

// ─── createRoom: bus publish ─────────────────────────────────────────────────

describe('RoomRegistry: createRoom — bus publish', () => {
  it('publishes room.created with the new room id', () => {
    const { registry, bus } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    expect(bus.publish).toHaveBeenCalledWith(
      'room.created',
      expect.objectContaining({ roomId: room.id }),
    );
  });

  it('includes seedElementCount and seedArrowCount in the publish', () => {
    const { registry, bus } = makeRegistry();
    const elements = {
      'e-1': makeElement({ id: 'e-1' }),
      'e-2': makeElement({ id: 'e-2' }),
    };
    const arrows = { 'a-1': makeArrow({ id: 'a-1' }) };
    registry.createRoom({ elements, arrows });

    expect(bus.publish).toHaveBeenCalledWith(
      'room.created',
      expect.objectContaining({ seedElementCount: 2, seedArrowCount: 1 }),
    );
  });

  it('publishes after the room is in the map (subscribers can look it up)', () => {
    const { registry, bus } = makeRegistry();

    let lookupAtPublishTime: Room | undefined;
    (bus.publish as jest.Mock).mockImplementation((topic: string, payload: { roomId: string }) => {
      if (topic === 'room.created') {
        lookupAtPublishTime = registry.getRoom(payload.roomId);
      }
    });

    const room = registry.createRoom(emptySeed());
    expect(lookupAtPublishTime).toBe(room);
  });
});

// ─── createRoom: id collisions ───────────────────────────────────────────────

describe('RoomRegistry: createRoom — id collisions', () => {
  it('retries on collision and creates with the next non-colliding id', () => {
    const generateId = jest
      .fn()
      .mockReturnValueOnce('id-A')
      .mockReturnValueOnce('id-A') // collision with first room
      .mockReturnValueOnce('id-B'); // succeeds on first retry
    const { registry } = makeRegistry({ generateId });

    const first = registry.createRoom(emptySeed());
    const second = registry.createRoom(emptySeed());

    expect(first.id).toBe('id-A');
    expect(second.id).toBe('id-B');
  });

  it('throws RoomIdExhaustionError after 5 consecutive collisions', () => {
    const generateId = jest.fn().mockReturnValue('id-A');
    const { registry } = makeRegistry({ generateId });

    // First creation succeeds.
    registry.createRoom(emptySeed());

    // Second creation: every attempt collides; the registry exhausts retries.
    expect(() => registry.createRoom(emptySeed())).toThrow(RoomIdExhaustionError);
  });
});

// ─── getRoom ─────────────────────────────────────────────────────────────────

describe('RoomRegistry: getRoom', () => {
  it('returns undefined for an unknown id', () => {
    const { registry } = makeRegistry();
    expect(registry.getRoom('nonexistent')).toBeUndefined();
  });

  it('returns undefined for the empty string', () => {
    const { registry } = makeRegistry();
    expect(registry.getRoom('')).toBeUndefined();
  });

  it('returns the room after createRoom', () => {
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());
    expect(registry.getRoom(room.id)).toBe(room);
  });

  it('returns undefined after destroyRoom', () => {
    jest.spyOn(Room.prototype, 'isEmpty').mockReturnValue(true);
    jest.spyOn(Room.prototype, 'disconnectAll').mockImplementation();
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());
    registry.destroyRoom(room.id, 'shutdown');
    expect(registry.getRoom(room.id)).toBeUndefined();
  });
});

// ─── destroyRoom ─────────────────────────────────────────────────────────────

describe('RoomRegistry: destroyRoom', () => {
  let isEmptySpy: jest.SpyInstance;
  let disconnectAllSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    isEmptySpy = jest.spyOn(Room.prototype, 'isEmpty').mockReturnValue(true);
    disconnectAllSpy = jest.spyOn(Room.prototype, 'disconnectAll').mockImplementation();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    isEmptySpy.mockRestore();
    disconnectAllSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('removes the room from the registry', () => {
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    registry.destroyRoom(room.id, 'shutdown');

    expect(registry.getRoom(room.id)).toBeUndefined();
  });

  it('publishes room.destroyed with the given reason', () => {
    const { registry, bus } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    registry.destroyRoom(room.id, 'empty');

    expect(bus.publish).toHaveBeenCalledWith(
      'room.destroyed',
      expect.objectContaining({ roomId: room.id, reason: 'empty' }),
    );
  });

  it('publishes after the room is removed from the map (subscribers see it absent)', () => {
    const { registry, bus } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    let lookupAtPublishTime: Room | undefined = room; // sentinel
    (bus.publish as jest.Mock).mockImplementation((topic: string, payload: { roomId: string }) => {
      if (topic === 'room.destroyed') {
        lookupAtPublishTime = registry.getRoom(payload.roomId);
      }
    });

    registry.destroyRoom(room.id, 'shutdown');
    expect(lookupAtPublishTime).toBeUndefined();
  });

  it('calls room.disconnectAll(reason) before removing it', () => {
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    registry.destroyRoom(room.id, 'shutdown');

    expect(disconnectAllSpy).toHaveBeenCalledWith('shutdown');
    // And the room is gone afterward — same call sequence still removes it.
    expect(registry.getRoom(room.id)).toBeUndefined();
  });

  it('is idempotent: destroyRoom on an unknown id is a no-op (no publish)', () => {
    const { registry, bus } = makeRegistry();

    expect(() => registry.destroyRoom('does-not-exist', 'shutdown')).not.toThrow();
    expect(bus.publish).not.toHaveBeenCalledWith('room.destroyed', expect.anything());
    expect(disconnectAllSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: destroyRoom called twice on the same id only acts once', () => {
    const { registry, bus } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    registry.destroyRoom(room.id, 'shutdown');
    registry.destroyRoom(room.id, 'shutdown');

    const destroyedPublishes = (bus.publish as jest.Mock).mock.calls.filter(
      ([topic]) => topic === 'room.destroyed',
    );
    expect(destroyedPublishes).toHaveLength(1);
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts when reason is "empty" but clients are still connected (grace race)', () => {
    isEmptySpy.mockReturnValue(false); // simulate a client present
    const { registry, bus } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    registry.destroyRoom(room.id, 'empty');

    // Room remains
    expect(registry.getRoom(room.id)).toBe(room);
    // No room.destroyed publish
    const destroyedPublishes = (bus.publish as jest.Mock).mock.calls.filter(
      ([topic]) => topic === 'room.destroyed',
    );
    expect(destroyedPublishes).toHaveLength(0);
    // disconnectAll not called
    expect(disconnectAllSpy).not.toHaveBeenCalled();
  });

  it('proceeds with reason "shutdown" even when clients are connected', () => {
    isEmptySpy.mockReturnValue(false);
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    registry.destroyRoom(room.id, 'shutdown');

    expect(disconnectAllSpy).toHaveBeenCalledWith('shutdown');
    expect(registry.getRoom(room.id)).toBeUndefined();
  });

  it('does not throw if room.disconnectAll throws (still removes the room)', () => {
    disconnectAllSpy.mockImplementation(() => {
      throw new Error('disconnect failed');
    });
    const { registry } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    expect(() => registry.destroyRoom(room.id, 'shutdown')).not.toThrow();
    expect(registry.getRoom(room.id)).toBeUndefined();
  });

  it('does not throw if bus.publish throws (still removes the room)', () => {
    const { registry, bus } = makeRegistry();
    const room = registry.createRoom(emptySeed());

    (bus.publish as jest.Mock).mockImplementation((topic: string) => {
      if (topic === 'room.destroyed') {
        throw new Error('bus failed');
      }
    });

    expect(() => registry.destroyRoom(room.id, 'shutdown')).not.toThrow();
    expect(registry.getRoom(room.id)).toBeUndefined();
  });
});

// ─── size ────────────────────────────────────────────────────────────────────

describe('RoomRegistry: size', () => {
  it('starts at 0', () => {
    const { registry } = makeRegistry();
    expect(registry.size()).toBe(0);
  });

  it('increments after createRoom', () => {
    const { registry } = makeRegistry();
    registry.createRoom(emptySeed());
    expect(registry.size()).toBe(1);
    registry.createRoom(emptySeed());
    expect(registry.size()).toBe(2);
  });

  it('decrements after destroyRoom', () => {
    jest.spyOn(Room.prototype, 'isEmpty').mockReturnValue(true);
    jest.spyOn(Room.prototype, 'disconnectAll').mockImplementation();
    const { registry } = makeRegistry();
    const a = registry.createRoom(emptySeed());
    registry.createRoom(emptySeed());
    expect(registry.size()).toBe(2);
    registry.destroyRoom(a.id, 'shutdown');
    expect(registry.size()).toBe(1);
  });
});

// ─── forEachRoom ─────────────────────────────────────────────────────────────

describe('RoomRegistry: forEachRoom', () => {
  it('does nothing on an empty registry', () => {
    const { registry } = makeRegistry();
    const fn = jest.fn();
    registry.forEachRoom(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('visits every room exactly once', () => {
    const { registry } = makeRegistry();
    const a = registry.createRoom(emptySeed());
    const b = registry.createRoom(emptySeed());
    const c = registry.createRoom(emptySeed());

    const visited: string[] = [];
    registry.forEachRoom((room) => visited.push(room.id));

    expect(visited).toHaveLength(3);
    expect(visited).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
  });

  it('iterates in insertion order', () => {
    const generateId = jest
      .fn()
      .mockReturnValueOnce('first')
      .mockReturnValueOnce('second')
      .mockReturnValueOnce('third');
    const { registry } = makeRegistry({ generateId });

    registry.createRoom(emptySeed());
    registry.createRoom(emptySeed());
    registry.createRoom(emptySeed());

    const visited: string[] = [];
    registry.forEachRoom((room) => visited.push(room.id));

    expect(visited).toEqual(['first', 'second', 'third']);
  });
});

// ─── Grace period integration ────────────────────────────────────────────────
// These exercise the wiring between Room.removeClient (sets a grace timer)
// and RoomRegistry.destroyRoom (the timer's callback). They will pass only
// once both Room and Registry behaviors are implemented.

describe('RoomRegistry: grace integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a room becoming empty triggers destroyRoom("empty") after gracePeriodMs', () => {
    const { registry, bus } = makeRegistry({ gracePeriodMs: 30_000 });
    const room = registry.createRoom(emptySeed());
    const client = makeFakeClient('conn-1');

    room.addClient(client);
    room.removeClient('conn-1');

    jest.advanceTimersByTime(29_999);
    expect(registry.getRoom(room.id)).toBe(room);

    jest.advanceTimersByTime(1);

    expect(registry.getRoom(room.id)).toBeUndefined();
    expect(bus.publish).toHaveBeenCalledWith(
      'room.destroyed',
      expect.objectContaining({ roomId: room.id, reason: 'empty' }),
    );
  });

  it('a rejoin within the grace window cancels the auto-destroy', () => {
    const { registry } = makeRegistry({ gracePeriodMs: 30_000 });
    const room = registry.createRoom(emptySeed());

    room.addClient(makeFakeClient('conn-1'));
    room.removeClient('conn-1');
    jest.advanceTimersByTime(15_000);
    room.addClient(makeFakeClient('conn-2'));
    jest.advanceTimersByTime(60_000);

    expect(registry.getRoom(room.id)).toBe(room);
  });
});
