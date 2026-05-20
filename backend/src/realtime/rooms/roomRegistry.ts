import { Element, Arrow } from '@fluxboard/domain';
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

const MAX_ID_ATTEMPTS = 5;

export class RoomRegistry {
  private readonly bus: EventBus;
  private readonly gracePeriodMs: number;
  private readonly roomIdLength: number;
  private readonly generateId: () => string;
  private readonly rooms: Map<string, Room> = new Map();

  constructor(opts: RoomRegistryOptions) {
    this.bus = opts.bus;
    this.gracePeriodMs = opts.gracePeriodMs;
    this.roomIdLength = opts.roomIdLength ?? 8;
    this.generateId = opts.generateId ?? (() => generateRoomId(this.roomIdLength));
  }

  createRoom(seed: Seed): Room {
    let id: string | undefined;
    for (let i = 0; i < MAX_ID_ATTEMPTS; i++) {
      const candidate = this.generateId();
      if (!this.rooms.has(candidate)) {
        id = candidate;
        break;
      }
    }
    if (id === undefined) throw new RoomIdExhaustionError();

    const room = new Room({
      id,
      state: {
        elements: seed.elements,
        arrows: seed.arrows,
        processedEventIds: {},
      },
      bus: this.bus,
      gracePeriodMs: this.gracePeriodMs,
      onGraceExpired: () => this.destroyRoom(id as string, 'empty'),
    });
    this.rooms.set(id, room);

    // Publish AFTER insertion so subscribers that look up the room find it.
    try {
      this.bus.publish('room.created', {
        roomId: id,
        createdAt: room.createdAt,
        seedElementCount: Object.keys(seed.elements).length,
        seedArrowCount: Object.keys(seed.arrows).length,
      });
    } catch (err) {
      console.error('[registry] bus.publish room.created threw', { roomId: id, err });
    }

    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  destroyRoom(id: string, reason: DestroyReason): void {
    const room = this.rooms.get(id);
    if (!room) return;
    // Grace race: a reconnect that arrived between the timer firing and
    // this callback running has restored clients. Only abort on 'empty';
    // 'shutdown' proceeds regardless.
    if (reason === 'empty' && !room.isEmpty()) return;

    try {
      room.disconnectAll(reason);
    } catch (err) {
      console.error('[registry] room.disconnectAll threw', { roomId: id, err });
    }

    this.rooms.delete(id);

    try {
      this.bus.publish('room.destroyed', {
        roomId: id,
        destroyedAt: Date.now(),
        reason,
      });
    } catch (err) {
      console.error('[registry] bus.publish room.destroyed threw', { roomId: id, err });
    }
  }

  size(): number {
    return this.rooms.size;
  }

  forEachRoom(fn: (room: Room) => void): void {
    for (const room of this.rooms.values()) {
      fn(room);
    }
  }
}
