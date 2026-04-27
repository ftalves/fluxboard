import { EventBus } from '@/event-bus/bus';
import { Unsubscribe } from '@/event-bus/types';

/**
 * Subscribes to all bus topics and prints one line per published event
 * to stdout via `console.log`. Returns a single `Unsubscribe` that
 * removes every subscription it created.
 *
 * Output format (per [`logging-worker.md`](backend/specs/logging-worker.md)):
 *   `[bus] <topic-padded-to-16> <single-line JSON.stringify(payload)>`
 *
 * The full bus payload is logged verbatim — including the `event`
 * object on `domain.event` — so the log is sufficient to reconstruct
 * what changed.
 */
export function startLoggingWorker(_bus: EventBus): Unsubscribe {
  throw new Error('startLoggingWorker: not yet implemented');
}
