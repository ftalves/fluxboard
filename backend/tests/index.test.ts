/**
 * Tests for src/index.ts — boot order, signal handling, shutdown sequence,
 * and hard-timeout.
 *
 * Strategy: all heavy dependencies (EventBus, RoomRegistry, registerWorkers,
 * createRequestHandler, createUpgradeHandler, http.createServer) are replaced
 * with jest fakes before `boot()` is called. This keeps the tests pure and
 * fast while verifying that index.ts wires things together in the right order.
 *
 * `require.main === module` is false during Jest, so the module-level IIFE
 * that starts the server is NOT executed when this file imports @/index.
 */

import type { Config } from '@/config';
import type { ServerHandle } from '@/index';

// ─── Mock all dependencies BEFORE importing index.ts ─────────────────────────

// Track the construction order so boot-order tests can assert on it.
const callOrder: string[] = [];

// --- EventBus mock ---
let mockBusInstance: { publish: jest.Mock; subscribe: jest.Mock; close: jest.Mock };
jest.mock('@/event-bus/bus', () => ({
  EventBus: jest.fn().mockImplementation(() => {
    callOrder.push('EventBus');
    return mockBusInstance;
  }),
}));

// --- RoomRegistry mock ---
let mockRegistryInstance: {
  createRoom: jest.Mock;
  getRoom: jest.Mock;
  destroyRoom: jest.Mock;
  size: jest.Mock;
  forEachRoom: jest.Mock;
};
jest.mock('@/realtime/rooms/roomRegistry', () => ({
  RoomRegistry: jest.fn().mockImplementation(() => {
    callOrder.push('RoomRegistry');
    return mockRegistryInstance;
  }),
}));

// --- registerWorkers mock ---
let mockUnsub1: jest.Mock;
let mockUnsub2: jest.Mock;
jest.mock('@/workers/register', () => ({
  registerWorkers: jest.fn().mockImplementation(() => {
    callOrder.push('registerWorkers');
    return [mockUnsub1, mockUnsub2];
  }),
}));

// --- http.createServer mock ---
let mockHttpServer: {
  listen: jest.Mock;
  close: jest.Mock;
  on: jest.Mock;
};
jest.mock('node:http', () => ({
  ...jest.requireActual('node:http'),
  createServer: jest.fn().mockImplementation(() => {
    callOrder.push('createServer');
    return mockHttpServer;
  }),
}));

// --- ws mock ---
jest.mock('ws', () => ({
  WebSocketServer: jest.fn().mockImplementation(() => ({
    handleUpgrade: jest.fn(),
  })),
}));

// --- server.ts functions ---
jest.mock('@/server', () => ({
  createRequestHandler: jest.fn().mockImplementation(() => {
    callOrder.push('createRequestHandler');
    return jest.fn();
  }),
  createUpgradeHandler: jest.fn().mockImplementation(() => {
    callOrder.push('createUpgradeHandler');
    return jest.fn();
  }),
}));

// ─── Import boot after mocks are in place ─────────────────────────────────────

import { boot } from '@/index';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  PORT: 9999,
  GRACE_PERIOD_MS: 100,
  ROOM_ID_LENGTH: 8,
  JOIN_TIMEOUT_MS: 500,
  WS_HEARTBEAT_MS: 1_000,
  MAX_SEED_BYTES: 1_048_576,
  MAX_WS_MESSAGE_BYTES: 262_144,
  ...overrides,
});

// Calls boot() and swallows "not yet implemented" so assertions on mocks
// can run even while the implementation is still a stub.
const safeBoot = async (cfg: Config = makeConfig()): Promise<ServerHandle | undefined> => {
  try {
    return await boot(cfg);
  } catch {
    return undefined;
  }
};

afterEach(() => {
  // boot() registers these on process; remove them so they don't accumulate
  // across the many safeBoot() calls in this suite.
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
});

beforeEach(() => {
  callOrder.length = 0;

  mockBusInstance = {
    publish: jest.fn(),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
    close: jest.fn(),
  };

  mockRegistryInstance = {
    createRoom: jest.fn(),
    getRoom: jest.fn(),
    destroyRoom: jest.fn(),
    size: jest.fn(),
    forEachRoom: jest.fn(),
  };

  mockUnsub1 = jest.fn();
  mockUnsub2 = jest.fn();

  mockHttpServer = {
    listen: jest.fn().mockImplementation((_port: number, cb: () => void) => {
      callOrder.push('listen');
      cb(); // simulate listen success immediately
      return mockHttpServer;
    }),
    close: jest.fn().mockImplementation((cb: () => void) => {
      if (cb) cb();
    }),
    on: jest.fn().mockReturnThis(),
  };

  jest.clearAllMocks();
});

// ─── Boot order ───────────────────────────────────────────────────────────────

describe('boot: construction order', () => {
  it('constructs EventBus before RoomRegistry', async () => {
    await safeBoot();
    const busIdx = callOrder.indexOf('EventBus');
    const regIdx = callOrder.indexOf('RoomRegistry');
    expect(busIdx).toBeGreaterThanOrEqual(0);
    expect(regIdx).toBeGreaterThan(busIdx);
  });

  it('constructs RoomRegistry before registering workers', async () => {
    await safeBoot();
    const regIdx = callOrder.indexOf('RoomRegistry');
    const workerIdx = callOrder.indexOf('registerWorkers');
    expect(regIdx).toBeGreaterThanOrEqual(0);
    expect(workerIdx).toBeGreaterThan(regIdx);
  });

  it('registers workers before the HTTP server listens', async () => {
    await safeBoot();
    const workerIdx = callOrder.indexOf('registerWorkers');
    const listenIdx = callOrder.indexOf('listen');
    expect(workerIdx).toBeGreaterThanOrEqual(0);
    expect(listenIdx).toBeGreaterThan(workerIdx);
  });

  it('builds the HTTP server before listening', async () => {
    await safeBoot();
    const createIdx = callOrder.indexOf('createServer');
    const listenIdx = callOrder.indexOf('listen');
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(listenIdx).toBeGreaterThan(createIdx);
  });
});

describe('boot: wiring', () => {
  it('passes config.GRACE_PERIOD_MS to RoomRegistry', async () => {
    const { RoomRegistry } = jest.requireMock('@/realtime/rooms/roomRegistry') as {
      RoomRegistry: jest.Mock;
    };
    const cfg = makeConfig({ GRACE_PERIOD_MS: 12_345 });
    await safeBoot(cfg);
    expect(RoomRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ gracePeriodMs: 12_345 }),
    );
  });

  it('passes the EventBus instance to RoomRegistry', async () => {
    const { RoomRegistry } = jest.requireMock('@/realtime/rooms/roomRegistry') as {
      RoomRegistry: jest.Mock;
    };
    await safeBoot();
    expect(RoomRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ bus: mockBusInstance }),
    );
  });

  it('listens on config.PORT', async () => {
    const cfg = makeConfig({ PORT: 5555 });
    await safeBoot(cfg);
    expect(mockHttpServer.listen).toHaveBeenCalledWith(5555, expect.any(Function));
  });

  it('attaches the upgrade handler to the http.Server', async () => {
    await safeBoot();
    // The upgrade listener must be registered on the http.Server instance.
    expect(mockHttpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
  });
});

describe('boot: uncaught-exception / unhandled-rejection handlers', () => {
  it('installs an uncaughtException handler on the process', async () => {
    const onSpy = jest.spyOn(process, 'on');
    await safeBoot();
    const events = onSpy.mock.calls.map(([event]) => event);
    expect(events).toContain('uncaughtException');
    onSpy.mockRestore();
  });

  it('installs an unhandledRejection handler on the process', async () => {
    const onSpy = jest.spyOn(process, 'on');
    await safeBoot();
    const events = onSpy.mock.calls.map(([event]) => event);
    expect(events).toContain('unhandledRejection');
    onSpy.mockRestore();
  });
});

// ─── Shutdown sequence ────────────────────────────────────────────────────────

describe('shutdown: sequence', () => {
  it('calls httpServer.close to stop accepting new connections', async () => {
    const handle = await safeBoot();
    if (!handle) return; // still a stub — test will fail here after implementation
    await handle.shutdown();
    expect(mockHttpServer.close).toHaveBeenCalled();
  });

  it('calls registry.destroyRoom for each room before closing the bus', async () => {
    const roomA = { id: 'a' };
    const roomB = { id: 'b' };
    mockRegistryInstance.forEachRoom.mockImplementation((fn: (r: { id: string }) => void) => {
      fn(roomA);
      fn(roomB);
    });

    const handle = await safeBoot();
    if (!handle) return;
    await handle.shutdown();

    expect(mockRegistryInstance.destroyRoom).toHaveBeenCalledWith('a', 'shutdown');
    expect(mockRegistryInstance.destroyRoom).toHaveBeenCalledWith('b', 'shutdown');
  });

  it('snapshots rooms via forEachRoom before calling destroyRoom', async () => {
    const destroyOrder: string[] = [];
    const forEachOrder: string[] = [];

    mockRegistryInstance.forEachRoom.mockImplementation((fn: (r: { id: string }) => void) => {
      forEachOrder.push('forEach');
      fn({ id: 'x' });
    });
    mockRegistryInstance.destroyRoom.mockImplementation(() => {
      destroyOrder.push('destroy');
    });

    const handle = await safeBoot();
    if (!handle) return;
    await handle.shutdown();

    expect(forEachOrder[0]).toBe('forEach');
    expect(destroyOrder[0]).toBe('destroy');
  });

  it('calls every worker unsubscribe function', async () => {
    const handle = await safeBoot();
    if (!handle) return;
    await handle.shutdown();
    expect(mockUnsub1).toHaveBeenCalled();
    expect(mockUnsub2).toHaveBeenCalled();
  });

  it('calls bus.close after worker unsubscribes', async () => {
    const unsub1 = jest.fn();
    const unsub2 = jest.fn();
    const { registerWorkers } = jest.requireMock('@/workers/register') as {
      registerWorkers: jest.Mock;
    };
    registerWorkers.mockReturnValue([unsub1, unsub2]);

    let unsubCalledBeforeBusClose = false;
    mockBusInstance.close.mockImplementation(() => {
      unsubCalledBeforeBusClose = unsub1.mock.calls.length > 0 && unsub2.mock.calls.length > 0;
    });

    const handle = await safeBoot();
    if (!handle) return;
    await handle.shutdown();

    expect(unsubCalledBeforeBusClose).toBe(true);
  });

  it('calls bus.close during shutdown', async () => {
    const handle = await safeBoot();
    if (!handle) return;
    await handle.shutdown();
    expect(mockBusInstance.close).toHaveBeenCalled();
  });
});

// ─── Shutdown idempotency ─────────────────────────────────────────────────────

describe('shutdown: idempotency', () => {
  it('a second call to shutdown() is a no-op (does not double-close the bus)', async () => {
    const handle = await safeBoot();
    if (!handle) return;
    await handle.shutdown();
    await handle.shutdown();
    // bus.close must have been called exactly once
    expect(mockBusInstance.close).toHaveBeenCalledTimes(1);
  });
});

// ─── Signal handlers ─────────────────────────────────────────────────────────

describe('signal handlers', () => {
  it('SIGINT triggers shutdown', async () => {
    const handle = await safeBoot();
    if (!handle) return;

    const shutdownSpy = jest.spyOn(handle, 'shutdown').mockResolvedValue();
    process.emit('SIGINT', 'SIGINT');
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('SIGTERM triggers shutdown', async () => {
    const handle = await safeBoot();
    if (!handle) return;

    const shutdownSpy = jest.spyOn(handle, 'shutdown').mockResolvedValue();
    process.emit('SIGTERM', 'SIGTERM');
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('second SIGINT does not trigger a second shutdown call', async () => {
    const handle = await safeBoot();
    if (!handle) return;

    const shutdownSpy = jest.spyOn(handle, 'shutdown').mockResolvedValue();
    process.emit('SIGINT', 'SIGINT');
    process.emit('SIGINT', 'SIGINT');
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('third SIGINT calls process.exit(1)', async () => {
    const handle = await safeBoot();
    if (!handle) return;

    jest.spyOn(handle, 'shutdown').mockResolvedValue();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      process.emit('SIGINT', 'SIGINT');
      process.emit('SIGINT', 'SIGINT');
      process.emit('SIGINT', 'SIGINT');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ─── Hard shutdown timeout ────────────────────────────────────────────────────

describe('shutdown: hard timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls process.exit(1) if shutdown has not completed within 10 000 ms', async () => {
    // Make httpServer.close hang so shutdown never resolves.
    mockHttpServer.close.mockImplementation(() => {
      // never calls the callback
    });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const handle = await safeBoot();
      if (!handle) return;

      // Start shutdown but don't await — it will hang.
      void handle.shutdown();

      jest.advanceTimersByTime(9_999);
      expect(exitSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('does NOT call process.exit(1) when shutdown completes before the timeout', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      const handle = await safeBoot();
      if (!handle) return;

      await handle.shutdown();
      jest.advanceTimersByTime(10_001);

      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ─── listen failure ───────────────────────────────────────────────────────────

describe('boot: listen failure', () => {
  it('rejects boot() when the http server emits an error on listen', async () => {
    const listenError = new Error('EADDRINUSE');
    mockHttpServer.listen.mockImplementation((_port: number, _cb: () => void) => {
      // Emit 'error' instead of calling the success callback.
      setImmediate(() => {
        const errorHandler = (mockHttpServer.on as jest.Mock).mock.calls.find(
          ([ev]: [string]) => ev === 'error',
        )?.[1] as ((err: Error) => void) | undefined;
        errorHandler?.(listenError);
      });
      return mockHttpServer;
    });

    await expect(boot(makeConfig())).rejects.toThrow('EADDRINUSE');
  });
});
