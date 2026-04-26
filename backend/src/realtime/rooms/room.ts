import { DiagramState, DiagramEvent } from '@/domain/types';
import { EventBus } from '@/event-bus/bus';
import { DestroyReason, PublicState, ServerMessage } from '@/realtime/protocol/messages';

// `ConnectionId` is implementation-internal and never crosses the wire.
// It uniquely identifies a single WebSocket connection within this process.
export type ConnectionId = string;

export interface ClientHandle {
  connectionId: ConnectionId;
  userId: string;
  send: (message: ServerMessage) => void;
  close: (code: number, reason?: string) => void;
}

export interface RoomOptions {
  id: string;
  state: DiagramState;
  bus: EventBus;
  gracePeriodMs: number;
  // Invoked when the grace timer fires (after the room has been empty
  // for `gracePeriodMs` continuously). Typically calls
  // `registry.destroyRoom(id, 'empty')`.
  onGraceExpired: () => void;
}

export class Room {
  readonly id: string;
  readonly createdAt: number;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.createdAt = Date.now();
  }

  applyAndBroadcast(_event: DiagramEvent, _originConnectionId: ConnectionId): void {
    throw new Error('Room.applyAndBroadcast: not yet implemented');
  }

  addClient(_handle: ClientHandle): void {
    throw new Error('Room.addClient: not yet implemented');
  }

  removeClient(_connectionId: ConnectionId): void {
    throw new Error('Room.removeClient: not yet implemented');
  }

  snapshot(): PublicState {
    throw new Error('Room.snapshot: not yet implemented');
  }

  isEmpty(): boolean {
    throw new Error('Room.isEmpty: not yet implemented');
  }

  /**
   * Send `room_destroyed` to every client and close their sockets with
   * code 1001. Called by the registry just before removing the room
   * from its map. Per spec, must not throw — failures during send/close
   * are caught and logged so a single bad socket cannot prevent the
   * whole tear-down.
   */
  disconnectAll(_reason: DestroyReason): void {
    throw new Error('Room.disconnectAll: not yet implemented');
  }
}
