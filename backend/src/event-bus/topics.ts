import { DiagramEvent } from '@/domain/types';

export type Topic = 'domain.event' | 'room.created' | 'room.destroyed';

export type DomainEventPayload = {
  roomId: string;
  event: DiagramEvent;
};

export type RoomCreatedPayload = {
  roomId: string;
  createdAt: number;
  seedElementCount: number;
  seedArrowCount: number;
};

export type RoomDestroyedPayload = {
  roomId: string;
  destroyedAt: number;
  reason: 'empty' | 'shutdown';
};

export type PayloadOf<T extends Topic> = T extends 'domain.event'
  ? DomainEventPayload
  : T extends 'room.created'
    ? RoomCreatedPayload
    : T extends 'room.destroyed'
      ? RoomDestroyedPayload
      : never;
