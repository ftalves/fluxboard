import { Topic, PayloadOf } from './topics';
import { Subscriber, Unsubscribe } from './types';

export class EventBus {
  publish<T extends Topic>(_topic: T, _payload: PayloadOf<T>): void {
    throw new Error('EventBus.publish: not yet implemented');
  }

  subscribe<T extends Topic>(_topic: T, _handler: Subscriber<T>): Unsubscribe {
    throw new Error('EventBus.subscribe: not yet implemented');
  }

  close(): void {
    throw new Error('EventBus.close: not yet implemented');
  }
}
