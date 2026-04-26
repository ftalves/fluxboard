import { Element, Arrow } from '@/domain/types';
import { EventBus } from '@/event-bus/bus';
import { DestroyReason } from '@/realtime/protocol/messages';
import { Room } from './room';
import { generateRoomId } from './roomId';

export type Seed = {
  elements: Record<string, Element>;
  arrows: Record<string, Arrow>;
};

export interface RoomRegistryOptions {
  bus: EventBus;
  gracePeriodMs: number;
  // Defaults to 8. Forwarded to `generateRoomId`.
  roomIdLength?: number;
  // Test-only seam: override the id generator. Defaults to
  // `() => generateRoomId(roomIdLength)`. Production code should not pass this.
  generateId?: () => string;
}

/**
 * Thrown by `createRoom` when 5 consecutive id-generation attempts collide
 * with existing rooms. At default length (8 chars, base62) this is
 * astronomically unlikely; the throw is purely defensive.
 */
export class RoomIdExhaustionError extends Error {
  constructor() {
    super('Failed to generate a unique room id after 5 retries');
    this.name = 'RoomIdExhaustionError';
  }
}

export class RoomRegistry {
  private readonly bus: EventBus;
  private readonly gracePeriodMs: number;
  private readonly roomIdLength: number;
  private readonly generateId: () => string;

  constructor(opts: RoomRegistryOptions) {
    this.bus = opts.bus;
    this.gracePeriodMs = opts.gracePeriodMs;
    this.roomIdLength = opts.roomIdLength ?? 8;
    this.generateId = opts.generateId ?? (() => generateRoomId(this.roomIdLength));
  }

  createRoom(_seed: Seed): Room {
    throw new Error('RoomRegistry.createRoom: not yet implemented');
  }

  getRoom(_id: string): Room | undefined {
    throw new Error('RoomRegistry.getRoom: not yet implemented');
  }

  destroyRoom(_id: string, _reason: DestroyReason): void {
    throw new Error('RoomRegistry.destroyRoom: not yet implemented');
  }

  size(): number {
    throw new Error('RoomRegistry.size: not yet implemented');
  }

  forEachRoom(_fn: (room: Room) => void): void {
    throw new Error('RoomRegistry.forEachRoom: not yet implemented');
  }
}
