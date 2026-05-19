import { EventBus } from '@/event-bus/bus';
import { Unsubscribe } from '@/event-bus/types';
import { startLoggingWorker } from './loggingWorker';

/**
 * Registers every worker with the event bus and returns the list of
 * `Unsubscribe` callbacks for use during graceful shutdown.
 *
 * Single seam for wiring workers — `index.ts` calls this exactly once
 * after constructing the bus and before starting the HTTP server.
 */
export function registerWorkers(bus: EventBus): Unsubscribe[] {
  return [startLoggingWorker(bus)];
}

// Re-export so callers can construct workers directly when needed
// (e.g., tests that want a lone logging worker without other plumbing).
export { startLoggingWorker };
