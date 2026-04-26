import { EventBus } from '@/event-bus/bus';
import type {
  DomainEventPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
} from '@/event-bus/topics';
import type { Unsubscribe } from '@/event-bus/types';
import type { DiagramEvent } from '@/domain/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeDiagramEvent = (overrides: Partial<DiagramEvent> = {}): DiagramEvent =>
  ({
    id: 'evt-1',
    timestamp: 1000,
    userId: 'user-1',
    type: 'ElementCreated',
    payload: { id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
    ...overrides,
  }) as DiagramEvent;

const makeDomainEventPayload = (
  overrides: Partial<DomainEventPayload> = {},
): DomainEventPayload => ({
  roomId: 'room-1',
  event: makeDiagramEvent(),
  ...overrides,
});

const makeRoomCreatedPayload = (
  overrides: Partial<RoomCreatedPayload> = {},
): RoomCreatedPayload => ({
  roomId: 'room-1',
  createdAt: 1000,
  seedElementCount: 0,
  seedArrowCount: 0,
  ...overrides,
});

const makeRoomDestroyedPayload = (
  overrides: Partial<RoomDestroyedPayload> = {},
): RoomDestroyedPayload => ({
  roomId: 'room-1',
  destroyedAt: 2000,
  reason: 'empty',
  ...overrides,
});

// Drains all pending microtasks before resolving.
const drain = (): Promise<void> => Promise.resolve();

// ─── Basic subscribe + publish ───────────────────────────────────────────────

describe('EventBus: subscribe + publish', () => {
  it('invokes a subscribed handler when an event is published', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes the published payload through to the handler', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const payload = makeDomainEventPayload({ roomId: 'room-xyz' });
    bus.subscribe('domain.event', handler);

    bus.publish('domain.event', payload);
    await drain();

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('does nothing when there are no subscribers for the topic', () => {
    const bus = new EventBus();
    expect(() => bus.publish('domain.event', makeDomainEventPayload())).not.toThrow();
  });

  it('does not invoke handlers subscribed to a different topic', async () => {
    const bus = new EventBus();
    const domainHandler = jest.fn();
    const createdHandler = jest.fn();
    bus.subscribe('domain.event', domainHandler);
    bus.subscribe('room.created', createdHandler);

    bus.publish('room.created', makeRoomCreatedPayload());
    await drain();

    expect(createdHandler).toHaveBeenCalledTimes(1);
    expect(domainHandler).not.toHaveBeenCalled();
  });

  it('invokes multiple subscribers to the same topic in registration order', async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.subscribe('domain.event', () => order.push('a'));
    bus.subscribe('domain.event', () => order.push('b'));
    bus.subscribe('domain.event', () => order.push('c'));

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();

    expect(order).toEqual(['a', 'b', 'c']);
  });
});

// ─── Microtask dispatch contract ─────────────────────────────────────────────

describe('EventBus: dispatch is microtask-deferred', () => {
  it('does not invoke the subscriber synchronously inside publish', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());

    // Handler must not run inside the publish call itself.
    expect(handler).not.toHaveBeenCalled();
  });

  it('publish returns synchronously even when a subscriber will throw', () => {
    const bus = new EventBus();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    bus.subscribe('domain.event', () => {
      throw new Error('boom');
    });

    expect(() => bus.publish('domain.event', makeDomainEventPayload())).not.toThrow();

    errSpy.mockRestore();
  });

  it('drains the handler on the next microtask', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());
    expect(handler).not.toHaveBeenCalled();

    await drain();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ─── Error isolation ─────────────────────────────────────────────────────────

describe('EventBus: error isolation', () => {
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('a throwing subscriber does not prevent sibling subscribers from running', async () => {
    const bus = new EventBus();
    const before = jest.fn();
    const after = jest.fn();
    bus.subscribe('domain.event', before);
    bus.subscribe('domain.event', () => {
      throw new Error('boom');
    });
    bus.subscribe('domain.event', after);

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();

    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('logs the error via console.error when a subscriber throws', async () => {
    const bus = new EventBus();
    bus.subscribe('domain.event', () => {
      throw new Error('boom');
    });

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();

    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── Publish-time snapshot ───────────────────────────────────────────────────

describe('EventBus: publish-time subscriber snapshot', () => {
  it('subscribers added after publish are NOT invoked for that publish', async () => {
    const bus = new EventBus();
    const early = jest.fn();
    const late = jest.fn();
    bus.subscribe('domain.event', early);

    bus.publish('domain.event', makeDomainEventPayload());
    bus.subscribe('domain.event', late); // after publish, before microtasks
    await drain();

    expect(early).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
  });

  it('subscribers unsubscribed between publish and microtask ARE still invoked', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsub = bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());
    unsub(); // microtask is already scheduled — cannot be cancelled
    await drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subscribers added inside another subscriber handler are not invoked for that publish', async () => {
    const bus = new EventBus();
    const inner = jest.fn();
    bus.subscribe('domain.event', () => {
      bus.subscribe('domain.event', inner);
    });

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    await drain();

    expect(inner).not.toHaveBeenCalled();
  });
});

// ─── Unsubscribe ─────────────────────────────────────────────────────────────

describe('EventBus: unsubscribe', () => {
  it('removes the handler from future publishes', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsub = bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it('is idempotent — calling twice is a no-op', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsub = bus.subscribe('domain.event', handler);

    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('the same handler subscribed twice receives two invocations per publish, and one unsubscribe removes only one', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsubA = bus.subscribe('domain.event', handler);
    bus.subscribe('domain.event', handler); // second registration

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).toHaveBeenCalledTimes(2);

    unsubA();
    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).toHaveBeenCalledTimes(3); // only the surviving registration ran
  });

  it('unsubscribing one topic does not affect other topics for the same handler', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsubA = bus.subscribe('domain.event', handler as never);
    bus.subscribe('room.created', handler as never);

    unsubA();

    bus.publish('domain.event', makeDomainEventPayload());
    bus.publish('room.created', makeRoomCreatedPayload());
    await drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing from inside the handler permits the current invocation to complete', async () => {
    const bus = new EventBus();
    let unsub: Unsubscribe | undefined;
    const handler = jest.fn(() => {
      unsub?.();
    });
    unsub = bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).toHaveBeenCalledTimes(1);

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).toHaveBeenCalledTimes(1); // self-unsubscribed
  });
});

// ─── Cross-topic isolation ───────────────────────────────────────────────────

describe('EventBus: multiple topics', () => {
  it('a publish to one topic does not invoke subscribers of another topic', async () => {
    const bus = new EventBus();
    const created = jest.fn();
    const destroyed = jest.fn();
    bus.subscribe('room.created', created);
    bus.subscribe('room.destroyed', destroyed);

    bus.publish('room.destroyed', makeRoomDestroyedPayload());
    await drain();

    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(created).not.toHaveBeenCalled();
  });

  it('a single handler can subscribe to multiple topics independently', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('domain.event', handler as never);
    bus.subscribe('room.created', handler as never);
    bus.subscribe('room.destroyed', handler as never);

    bus.publish('domain.event', makeDomainEventPayload());
    bus.publish('room.created', makeRoomCreatedPayload());
    bus.publish('room.destroyed', makeRoomDestroyedPayload());
    await drain();

    expect(handler).toHaveBeenCalledTimes(3);
  });
});

// ─── Publish from inside a handler ───────────────────────────────────────────

describe('EventBus: publish from inside a handler', () => {
  it('chains via microtasks without re-entrance', async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.subscribe('domain.event', () => {
      order.push('domain.event');
      bus.publish('room.created', makeRoomCreatedPayload());
    });
    bus.subscribe('room.created', () => {
      order.push('room.created');
    });

    bus.publish('domain.event', makeDomainEventPayload());
    expect(order).toEqual([]); // nothing has run synchronously

    await drain();
    await drain();

    expect(order).toEqual(['domain.event', 'room.created']);
  });
});

// ─── close() ─────────────────────────────────────────────────────────────────

describe('EventBus: close', () => {
  it('publish after close is a no-op', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('domain.event', handler);

    bus.close();
    bus.publish('domain.event', makeDomainEventPayload());
    await drain();

    expect(handler).not.toHaveBeenCalled();
  });

  it('subscribe after close returns a no-op unsubscribe and never invokes the handler', async () => {
    const bus = new EventBus();
    bus.close();

    const handler = jest.fn();
    const unsub = bus.subscribe('domain.event', handler);

    expect(() => unsub()).not.toThrow();

    bus.publish('domain.event', makeDomainEventPayload());
    await drain();
    expect(handler).not.toHaveBeenCalled();
  });

  it('is idempotent — calling close twice is a no-op', () => {
    const bus = new EventBus();
    bus.close();
    expect(() => bus.close()).not.toThrow();
  });

  it('microtasks already scheduled at close time still run', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('domain.event', handler);

    bus.publish('domain.event', makeDomainEventPayload());
    bus.close(); // microtask is already queued
    await drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
