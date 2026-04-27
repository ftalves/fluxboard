import { startLoggingWorker } from '@/workers/loggingWorker';
import { EventBus } from '@/event-bus/bus';

// ─── Fake bus ────────────────────────────────────────────────────────────────

type FakeBus = {
  publish: jest.Mock;
  subscribe: jest.Mock;
  close: jest.Mock;
  _emit: (topic: string, payload: unknown) => void;
};

const makeFakeBus = (): FakeBus => {
  const subs = new Map<string, Array<(payload: unknown) => void>>();
  return {
    publish: jest.fn(),
    subscribe: jest.fn((topic: string, handler: (payload: unknown) => void) => {
      const list = subs.get(topic) ?? [];
      list.push(handler);
      subs.set(topic, list);
      return jest.fn(() => {
        const updated = (subs.get(topic) ?? []).filter((h) => h !== handler);
        subs.set(topic, updated);
      });
    }),
    close: jest.fn(),
    _emit: (topic, payload) => {
      (subs.get(topic) ?? []).forEach((h) => h(payload));
    },
  };
};

const asEventBus = (b: FakeBus): EventBus => b as unknown as EventBus;

// ─── Subscriptions ───────────────────────────────────────────────────────────

describe('startLoggingWorker: subscriptions', () => {
  it('subscribes to room.created', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));
    expect(bus.subscribe).toHaveBeenCalledWith('room.created', expect.any(Function));
  });

  it('subscribes to domain.event', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));
    expect(bus.subscribe).toHaveBeenCalledWith('domain.event', expect.any(Function));
  });

  it('subscribes to room.destroyed', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));
    expect(bus.subscribe).toHaveBeenCalledWith('room.destroyed', expect.any(Function));
  });

  it('makes exactly three subscriptions (one per topic)', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));
    expect(bus.subscribe).toHaveBeenCalledTimes(3);
  });
});

// ─── Log format ──────────────────────────────────────────────────────────────

describe('startLoggingWorker: log format', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs room.created with topic padded to 16 chars + compact JSON payload', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));

    const payload = {
      roomId: 'r-1',
      createdAt: 1700000000000,
      seedElementCount: 2,
      seedArrowCount: 1,
    };
    bus._emit('room.created', payload);

    expect(logSpy).toHaveBeenCalledWith(`[bus] room.created    ${JSON.stringify(payload)}`);
  });

  it('logs domain.event with the full event object (metadata + payload)', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));

    const payload = {
      roomId: 'r-1',
      event: {
        id: 'evt-1',
        timestamp: 1700000000000,
        userId: 'u-1',
        type: 'ElementCreated',
        payload: {
          id: 'el-1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
        },
      },
    };
    bus._emit('domain.event', payload);

    expect(logSpy).toHaveBeenCalledWith(`[bus] domain.event    ${JSON.stringify(payload)}`);
  });

  it('logs room.destroyed with the reason inside the JSON payload', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));

    const payload = {
      roomId: 'r-1',
      destroyedAt: 1700000001000,
      reason: 'empty',
    };
    bus._emit('room.destroyed', payload);

    // 'room.destroyed' is 14 chars, padded to 16 = 2 trailing spaces.
    expect(logSpy).toHaveBeenCalledWith(`[bus] room.destroyed  ${JSON.stringify(payload)}`);
  });

  it('logs each emitted event exactly once', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));

    bus._emit('room.created', {
      roomId: 'r-1',
      createdAt: 0,
      seedElementCount: 0,
      seedArrowCount: 0,
    });
    bus._emit('room.created', {
      roomId: 'r-2',
      createdAt: 0,
      seedElementCount: 0,
      seedArrowCount: 0,
    });

    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it('uses compact JSON (no extra whitespace, no newlines)', () => {
    const bus = makeFakeBus();
    startLoggingWorker(asEventBus(bus));

    bus._emit('room.created', {
      roomId: 'r-1',
      createdAt: 0,
      seedElementCount: 0,
      seedArrowCount: 0,
    });

    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain('\n');
    expect(line).not.toMatch(/{\s/); // no space after `{`
    expect(line).not.toMatch(/,\s/); // no space after `,`
  });
});

// ─── Unsubscribe ─────────────────────────────────────────────────────────────

describe('startLoggingWorker: unsubscribe', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('returns a function', () => {
    const bus = makeFakeBus();
    expect(typeof startLoggingWorker(asEventBus(bus))).toBe('function');
  });

  it('the returned unsubscribe stops further log lines from being printed', () => {
    const bus = makeFakeBus();
    const unsubscribe = startLoggingWorker(asEventBus(bus));

    unsubscribe();

    bus._emit('room.created', {
      roomId: 'r-1',
      createdAt: 0,
      seedElementCount: 0,
      seedArrowCount: 0,
    });
    bus._emit('domain.event', { roomId: 'r-1', event: {} });
    bus._emit('room.destroyed', { roomId: 'r-1', destroyedAt: 0, reason: 'empty' });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('unsubscribe is idempotent (calling twice does not throw)', () => {
    const bus = makeFakeBus();
    const unsubscribe = startLoggingWorker(asEventBus(bus));

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
});
