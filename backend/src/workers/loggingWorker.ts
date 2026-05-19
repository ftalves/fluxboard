import { EventBus } from '@/event-bus/bus';
import { Topic } from '@/event-bus/topics';
import { Unsubscribe } from '@/event-bus/types';

const TOPICS: Topic[] = ['room.created', 'domain.event', 'room.destroyed'];

/**
 * Subscribes to all bus topics and prints one line per published event
 * to stdout via `console.log`. Returns a single `Unsubscribe` that
 * removes every subscription it created.
 *
 * Output format (per [`logging-worker.md`](backend/specs/logging-worker.md)):
 *   `[bus] <topic-padded-to-16> <single-line JSON.stringify(payload)>`
 */
export function startLoggingWorker(bus: EventBus): Unsubscribe {
  const unsubs: Unsubscribe[] = TOPICS.map((topic) =>
    bus.subscribe(topic, (payload) => {
      console.log(`[bus] ${topic.padEnd(16, ' ')}${JSON.stringify(payload)}`);
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
