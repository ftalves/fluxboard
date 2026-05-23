import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import type { DiagramEvent } from '@fluxboard/domain';

import { backoffFor, startLifecycle } from '../../src/net/lifecycle';
import type { LifecycleHandle } from '../../src/net/lifecycle';
import { createFluxStore, resetWireBridgeForTests } from '../../src/store/store';
import type { StoreState } from '../../src/store/store';
import type { WireCallbacks, WireHandle } from '../../src/net/wire';

type FakeWire = {
  roomId: string;
  userId: string;
  cb: WireCallbacks;
  sent: DiagramEvent[];
  closes: number[];
};

type WireFactory = {
  wireConnect: (roomId: string, userId: string, cb: WireCallbacks) => WireHandle;
  wires: FakeWire[];
  latest: () => FakeWire;
  throwNext: (err: unknown) => void;
};

function makeFakeWire(): WireFactory {
  const wires: FakeWire[] = [];
  let nextThrow: unknown = null;
  const wireConnect = (roomId: string, userId: string, cb: WireCallbacks): WireHandle => {
    if (nextThrow !== null) {
      const e = nextThrow;
      nextThrow = null;
      throw e;
    }
    const w: FakeWire = { roomId, userId, cb, sent: [], closes: [] };
    wires.push(w);
    return {
      send: (e) => {
        w.sent.push(e);
      },
      ping: () => {},
      close: (code) => {
        w.closes.push(code ?? 1000);
      },
    };
  };
  return {
    wireConnect,
    wires,
    latest: () => {
      const w = wires[wires.length - 1];
      if (!w) throw new Error('no wire opened');
      return w;
    },
    throwNext: (err) => {
      nextThrow = err;
    },
  };
}

let store: StoreApi<StoreState>;
let fake: WireFactory;
let lc: LifecycleHandle | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  store = createFluxStore();
  fake = makeFakeWire();
  resetWireBridgeForTests();
});

afterEach(() => {
  lc?.stop();
  lc = null;
  resetWireBridgeForTests();
  vi.useRealTimers();
});

describe('mount', () => {
  test('sets connection to connecting attempt=0 on start', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'user-A',
      store,
      wireConnect: fake.wireConnect,
    });
    expect(store.getState().connection).toEqual({ kind: 'connecting', attempt: 0 });
  });

  test('opens a socket via wireConnect with the supplied roomId and userId', () => {
    lc = startLifecycle({
      roomId: 'room-2',
      userId: 'user-B',
      store,
      wireConnect: fake.wireConnect,
    });
    expect(fake.wires).toHaveLength(1);
    expect(fake.latest().roomId).toBe('room-2');
    expect(fake.latest().userId).toBe('user-B');
  });
});

describe('onSync', () => {
  test('hydrates the store and transitions to connected', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({
      roomId: 'room-1',
      state: {
        elements: { r1: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 } },
        arrows: {},
      },
    });
    expect(store.getState().connection).toEqual({ kind: 'connected' });
    expect(store.getState().roomId).toBe('room-1');
    expect(store.getState().diagram.elements['r1']).toMatchObject({ id: 'r1' });
  });
});

describe('wire bridge', () => {
  test('submitEvent forwards to the current handle.send after sync', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    store.getState().submitEvent({
      id: 'evt-1',
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    });
    expect(fake.latest().sent).toHaveLength(1);
    expect(fake.latest().sent[0]?.id).toBe('evt-1');
  });
});

describe('onClose retryable', () => {
  test('1006 schedules reconnecting(attempt=1, retryAt=now+1000)', () => {
    const t0 = Date.now();
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'reconnecting',
      attempt: 1,
      retryAt: t0 + 1000,
    });
  });

  test('1011 schedules reconnect', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onClose({ code: 1011, reason: '', wasClean: false });
    expect(store.getState().connection.kind).toBe('reconnecting');
  });
});

describe('stop()', () => {
  test('closes the current socket with 1000', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    lc.stop();
    lc = null;
    expect(fake.latest().closes).toEqual([1000]);
  });

  test('clears the pending backoff timer (no new socket opens after stop)', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection.kind).toBe('reconnecting');
    lc.stop();
    lc = null;
    vi.advanceTimersByTime(5000);
    expect(fake.wires).toHaveLength(1);
  });

  test('clears pending ack timers (no close after stop)', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    store.getState().submitEvent({
      id: 'evt-1',
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    });
    const closesBefore = fake.latest().closes.length;
    lc.stop();
    const closesAfterStop = fake.latest().closes.length;
    lc = null;
    vi.advanceTimersByTime(20_000);
    // Only the stop() close; no ack-timeout-triggered second close.
    expect(fake.latest().closes.length).toBe(closesAfterStop);
    expect(closesAfterStop).toBe(closesBefore + 1);
  });

  test('subsequent onClose after stop is ignored (no transition)', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    expect(store.getState().connection).toEqual({ kind: 'connected' });
    const captured = fake.latest().cb;
    lc.stop();
    lc = null;
    // Replay the wire callback after stop — should not re-touch the store.
    captured.onClose({ code: 1001, reason: '', wasClean: true });
    expect(store.getState().connection).toEqual({ kind: 'connected' });
  });
});

describe('network failure', () => {
  test('wireConnect throwing on initial connect → terminal network', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.throwNext(new Error('boom'));
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'network',
    });
    warn.mockRestore();
  });
});

describe('reconnect schedule', () => {
  test('backoff timer fires → opens new socket at connecting attempt=1', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(fake.wires).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(fake.wires).toHaveLength(2);
    expect(store.getState().connection).toEqual({ kind: 'connecting', attempt: 1 });
  });

  test('attempt monotonic across cycles; uses 1s/2s/4s backoff', () => {
    const t0 = Date.now();
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    // Cycle 1: close → reconnect attempt=1 (+1000)
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'reconnecting',
      attempt: 1,
      retryAt: t0 + 1000,
    });
    vi.advanceTimersByTime(1000);
    // Cycle 2: close → reconnect attempt=2 (+2000)
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'reconnecting',
      attempt: 2,
      retryAt: t0 + 1000 + 2000,
    });
    vi.advanceTimersByTime(2000);
    // Cycle 3: close → reconnect attempt=3 (+4000)
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'reconnecting',
      attempt: 3,
      retryAt: t0 + 1000 + 2000 + 4000,
    });
  });
});

describe('max retries', () => {
  test('after MAX_ATTEMPTS-1 retries + one more failure → terminal max_retries', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    const delays = [1000, 2000, 4000, 8000]; // attempts 1..4
    for (const d of delays) {
      fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
      vi.advanceTimersByTime(d);
    }
    // Now in connecting attempt=4. One more retryable close → next=5 >= MAX → terminal.
    expect(store.getState().connection).toEqual({ kind: 'connecting', attempt: 4 });
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'max_retries',
    });
  });
});

describe('backoffFor', () => {
  test('returns 1000, 2000, 4000, 8000, 16000, 30000 (capped) for attempts 0..N', () => {
    expect(backoffFor(0)).toBe(1000);
    expect(backoffFor(1)).toBe(2000);
    expect(backoffFor(2)).toBe(4000);
    expect(backoffFor(3)).toBe(8000);
    expect(backoffFor(4)).toBe(16000);
    expect(backoffFor(5)).toBe(30000);
    expect(backoffFor(99)).toBe(30000);
  });
});

describe('onRoomDestroyed', () => {
  test('"empty" pre-stages; subsequent onClose → terminal room_destroyed', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onRoomDestroyed('empty');
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'room_destroyed',
    });
  });

  test('"shutdown" pre-stages; subsequent onClose → terminal server_shutdown', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onRoomDestroyed('shutdown');
    fake.latest().cb.onClose({ code: 1011, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'server_shutdown',
    });
  });
});

describe('onClose 4408', () => {
  test('4408 on attempt 0 → reconnecting', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onClose({ code: 4408, reason: '', wasClean: false });
    expect(store.getState().connection.kind).toBe('reconnecting');
  });

  test('4408 on attempt > 0 → terminal client_bug', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    // first close advances to reconnecting attempt=1
    fake.latest().cb.onClose({ code: 1006, reason: '', wasClean: false });
    vi.advanceTimersByTime(1000);
    expect(store.getState().connection).toEqual({ kind: 'connecting', attempt: 1 });
    // Now 4408 on attempt 1 should terminal
    fake.latest().cb.onClose({ code: 4408, reason: '', wasClean: false });
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'client_bug',
    });
  });
});

describe('onClose terminal codes', () => {
  function startAndClose(code: number): void {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onClose({ code, reason: '', wasClean: false });
  }

  test('1001 → terminal server_shutdown', () => {
    startAndClose(1001);
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'server_shutdown',
    });
  });

  test('4404 → terminal not_found', () => {
    startAndClose(4404);
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'not_found',
    });
  });

  test('1003 → terminal client_bug', () => {
    startAndClose(1003);
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'client_bug',
    });
  });

  test('1009 → terminal client_bug', () => {
    startAndClose(1009);
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'client_bug',
    });
  });

  test('4400 → terminal client_bug', () => {
    startAndClose(4400);
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'client_bug',
    });
  });

  test('unknown 4xxx → terminal client_bug', () => {
    startAndClose(4567);
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'client_bug',
    });
  });

  test('1000 → no transition (stays in connecting)', () => {
    startAndClose(1000);
    expect(store.getState().connection).toEqual({ kind: 'connecting', attempt: 0 });
  });
});

describe('ack timeout → reconnect', () => {
  test('ack-timeout-driven 1000 close transitions to reconnecting (not terminal)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    store.getState().submitEvent({
      id: 'evt-stuck',
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    });
    vi.advanceTimersByTime(10_000);
    // handle.close(1000) was called by the ack-timeout path
    expect(fake.latest().closes).toEqual([1000]);
    // Simulate the resulting onClose
    fake.latest().cb.onClose({ code: 1000, reason: '', wasClean: true });
    // Should reconnect, not be no-op.
    expect(store.getState().connection.kind).toBe('reconnecting');
    warn.mockRestore();
  });
});

describe('ack timeout', () => {
  test('no ack within ACK_TIMEOUT_MS triggers handle.close(1000) and console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    store.getState().submitEvent({
      id: 'evt-late',
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    });
    vi.advanceTimersByTime(10_000);
    expect(fake.latest().closes).toEqual([1000]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ack timeout'), 'evt-late');
    warn.mockRestore();
  });

  test('onAck within the window cancels the timeout (no close)', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    store.getState().submitEvent({
      id: 'evt-fast',
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    });
    fake.latest().cb.onAck('evt-fast', 'applied');
    vi.advanceTimersByTime(20_000);
    expect(fake.latest().closes).toEqual([]);
  });
});

describe('onAck', () => {
  function submitLocal(eventId: string): void {
    store.getState().submitEvent({
      id: eventId,
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 },
    });
  }

  test('"applied" drops the pending event', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    submitLocal('evt-1');
    expect(store.getState().pendingEvents['evt-1']).toBeDefined();
    fake.latest().cb.onAck('evt-1', 'applied');
    expect(store.getState().pendingEvents['evt-1']).toBeUndefined();
  });

  test('"rejected" drops the pending event and rolls back', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    submitLocal('evt-2');
    expect(store.getState().diagram.elements['r1']).toBeDefined();
    fake.latest().cb.onAck('evt-2', 'rejected');
    expect(store.getState().pendingEvents['evt-2']).toBeUndefined();
    expect(store.getState().diagram.elements['r1']).toBeUndefined();
  });
});

describe('onPeerEvent', () => {
  test('forwards events to the store', () => {
    lc = startLifecycle({
      roomId: 'room-1',
      userId: 'u',
      store,
      wireConnect: fake.wireConnect,
    });
    fake.latest().cb.onSync({ roomId: 'room-1', state: { elements: {}, arrows: {} } });
    fake.latest().cb.onPeerEvent({
      id: 'peer-1',
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'peer',
      payload: { id: 'r1', type: 'rectangle', x: 1, y: 2, width: 3, height: 4 },
    });
    expect(store.getState().diagram.elements['r1']).toMatchObject({ id: 'r1', x: 1, y: 2 });
  });
});
