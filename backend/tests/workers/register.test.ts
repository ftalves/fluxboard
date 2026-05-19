import { registerWorkers } from '@/workers/register';
import { EventBus } from '@/event-bus/bus';

// ─── Fake bus (same pattern as loggingWorker.test.ts) ────────────────────────

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

describe('registerWorkers', () => {
  it('returns an array of unsubscribe functions', () => {
    const bus = makeFakeBus();
    const unsubs = registerWorkers(asEventBus(bus));
    expect(Array.isArray(unsubs)).toBe(true);
    expect(unsubs.length).toBeGreaterThan(0);
    unsubs.forEach((unsub) => expect(typeof unsub).toBe('function'));
  });

  it('wires the logging worker (subscribes to all three bus topics)', () => {
    const bus = makeFakeBus();
    registerWorkers(asEventBus(bus));
    expect(bus.subscribe).toHaveBeenCalledWith('room.created', expect.any(Function));
    expect(bus.subscribe).toHaveBeenCalledWith('domain.event', expect.any(Function));
    expect(bus.subscribe).toHaveBeenCalledWith('room.destroyed', expect.any(Function));
  });

  it('calling every returned unsubscribe stops all workers from receiving events', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const bus = makeFakeBus();
      const unsubs = registerWorkers(asEventBus(bus));
      unsubs.forEach((u) => u());

      bus._emit('room.created', {
        roomId: 'r-1',
        createdAt: 0,
        seedElementCount: 0,
        seedArrowCount: 0,
      });

      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
