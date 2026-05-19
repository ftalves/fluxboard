/**
 * Composition root — the only file that knows about all of: config, EventBus,
 * RoomRegistry, workers, the HTTP server, and the WebSocket server.
 *
 * Exports `boot` and `ServerHandle` for testing (the module-level side-effect
 * is guarded by `require.main === module`, so importing this file in tests
 * does not start the server).
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config as defaultConfig, Config } from './config';
import { EventBus } from './event-bus/bus';
import { RoomRegistry } from './realtime/rooms/roomRegistry';
import { registerWorkers } from './workers/register';
import { createRequestHandler, createUpgradeHandler } from './server';

export interface ServerHandle {
  shutdown(): Promise<void>;
}

const SHUTDOWN_HARD_TIMEOUT_MS = 10_000;

/**
 * Runs the full boot sequence described in server-entry.md:
 *
 *  1. Construct EventBus
 *  2. Construct RoomRegistry (needs bus + gracePeriodMs)
 *  3. Register workers (must happen before HTTP server listens)
 *  4. Build HTTP server (request handler delegates to handleHttpRequest)
 *  5. Attach WebSocket server via noServer upgrade listener
 *  6. Start listening on config.PORT
 *  7. After listen success, install SIGINT/SIGTERM listeners on `process`
 *     that invoke the returned ServerHandle's `shutdown()`.
 *
 * Returns a handle whose `shutdown()` executes the graceful-shutdown
 * sequence (stop accepting → destroy rooms → unsubscribe workers →
 * close bus → resolve; hard-timeout at 10 s).
 */
export async function boot(cfg: Config): Promise<ServerHandle> {
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandledRejection:', reason);
    process.exit(1);
  });

  const bus = new EventBus();
  const registry = new RoomRegistry({ bus, gracePeriodMs: cfg.GRACE_PERIOD_MS });
  const unsubs = registerWorkers(bus);

  const wss = new WebSocketServer({ noServer: true, maxPayload: cfg.MAX_WS_MESSAGE_BYTES });
  const requestHandler = createRequestHandler({ registry, config: cfg });
  const upgradeHandler = createUpgradeHandler({ wss, registry, bus, config: cfg });

  const httpServer = http.createServer(requestHandler);
  httpServer.on('upgrade', upgradeHandler);

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      httpServer.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      httpServer.listen(cfg.PORT, () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  } catch (err) {
    // Listen failed — tear down per server-entry.md §"Startup failures".
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        /* swallow during teardown */
      }
    }
    try {
      bus.close();
    } catch {
      /* swallow */
    }
    throw err;
  }

  // ─── Shutdown ───────────────────────────────────────────────────────────────

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    const hardTimer = setTimeout(() => {
      console.error('[server] shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_HARD_TIMEOUT_MS);
    hardTimer.unref();

    // 1. Stop accepting new connections.
    await new Promise<void>((resolve) => {
      try {
        httpServer.close(() => resolve());
      } catch {
        resolve();
      }
    });

    // 2. Snapshot then destroy rooms.
    const ids: string[] = [];
    registry.forEachRoom((room) => ids.push(room.id));
    for (const id of ids) {
      try {
        registry.destroyRoom(id, 'shutdown');
      } catch {
        /* registry.destroyRoom must not throw per spec; defensive catch */
      }
    }

    // 3. Unsubscribe workers.
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        /* swallow */
      }
    }

    // 4. Close bus.
    try {
      bus.close();
    } catch {
      /* swallow */
    }

    clearTimeout(hardTimer);
  };

  const handle: ServerHandle = { shutdown };

  // ─── Signal handlers ────────────────────────────────────────────────────────
  // boot() owns process signal handling. Strip any prior installations
  // so repeated boots in tests do not accumulate listeners.
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');

  let sigCount = 0;
  const onSignal = (sig: string) => {
    sigCount++;
    if (sigCount === 1) {
      console.log(`[server] received ${sig}, shutting down`);
      handle.shutdown().catch((err) => {
        console.error('[server] shutdown error:', err);
        process.exit(1);
      });
    } else if (sigCount === 2) {
      console.log(`[server] shutdown already in progress (${sig} ignored)`);
    } else {
      process.exit(1);
    }
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  return handle;
}

// ─── Process entry point ──────────────────────────────────────────────────────

if (require.main === module) {
  void (async () => {
    try {
      await boot(defaultConfig);
      console.log('[server] listening on port', defaultConfig.PORT);
    } catch (err) {
      console.error('[boot] fatal:', err);
      process.exit(1);
    }
  })();
}
