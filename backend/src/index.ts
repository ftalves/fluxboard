/**
 * Composition root — the only file that knows about all of: config, EventBus,
 * RoomRegistry, workers, the HTTP server, and the WebSocket server.
 *
 * Exports `boot` and `ServerHandle` for testing (the module-level side-effect
 * is guarded by `require.main === module`, so importing this file in tests
 * does not start the server).
 */

import http from 'node:http';
import { config as defaultConfig, Config } from './config';
import { EventBus } from './event-bus/bus';
import { RoomRegistry } from './realtime/rooms/roomRegistry';
import { registerWorkers } from './workers/register';
import { createRequestHandler, createUpgradeHandler } from './server';

export interface ServerHandle {
  shutdown(): Promise<void>;
}

/**
 * Runs the full boot sequence described in server-entry.md:
 *
 *  1. Construct EventBus
 *  2. Construct RoomRegistry (needs bus + gracePeriodMs)
 *  3. Register workers (must happen before HTTP server listens)
 *  4. Build HTTP server (request handler delegates to handleHttpRequest)
 *  5. Attach WebSocket server via noServer upgrade listener
 *  6. Start listening on config.PORT
 *
 * Returns a handle whose `shutdown()` executes the graceful-shutdown
 * sequence (stop accepting → destroy rooms → unsubscribe workers →
 * close bus → resolve; hard-timeout at 10 s).
 *
 * Signal handlers (SIGINT, SIGTERM) are installed after listen succeeds
 * and call shutdown(); they are NOT installed by boot() itself so that
 * tests can drive shutdown directly without emitting signals.
 */
export async function boot(_cfg: Config): Promise<ServerHandle> {
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandledRejection:', reason);
    process.exit(1);
  });

  throw new Error('boot: not yet implemented');
}

// ─── Process entry point ──────────────────────────────────────────────────────

if (require.main === module) {
  void (async () => {
    let handle: ServerHandle;
    try {
      handle = await boot(defaultConfig);
    } catch (err) {
      console.error('[boot] fatal:', err);
      process.exit(1);
    }

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

    console.log('[server] listening on port', defaultConfig.PORT);
  })();
}

