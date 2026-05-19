import { Topic, PayloadOf } from './topics';

export type Subscriber<T extends Topic> = (payload: PayloadOf<T>) => void;

export type Unsubscribe = () => void;
