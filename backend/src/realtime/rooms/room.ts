import { DiagramState, DiagramEvent } from '@/domain/types';
import { EventBus } from '@/event-bus/bus';
import { DestroyReason, PublicState, ServerMessage } from '@/realtime/protocol/messages';
import { applyEvent } from '@/domain/applyEvent';

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

  private state: DiagramState;
  private readonly bus: EventBus;
  private readonly gracePeriodMs: number;
  private readonly onGraceExpired: () => void;
  private readonly clients: Map<ConnectionId, ClientHandle> = new Map();
  private destroyTimer: NodeJS.Timeout | null = null;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.createdAt = Date.now();
    this.state = opts.state;
    this.bus = opts.bus;
    this.gracePeriodMs = opts.gracePeriodMs;
    this.onGraceExpired = opts.onGraceExpired;
  }

  snapshot(): PublicState {
    return { elements: this.state.elements, arrows: this.state.arrows };
  }

  isEmpty(): boolean {
    return this.clients.size === 0;
  }

  addClient(handle: ClientHandle): void {
    // Cancel any pending grace timer (must happen before any await/yield
    // boundary in the join handler — see room-lifecycle.md §"Grace race").
    if (this.destroyTimer !== null) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    this.clients.set(handle.connectionId, handle);
  }

  removeClient(connectionId: ConnectionId): void {
    if (!this.clients.delete(connectionId)) return;
    if (this.clients.size === 0) {
      this.destroyTimer = setTimeout(() => {
        this.destroyTimer = null;
        this.onGraceExpired();
      }, this.gracePeriodMs);
      // Do not keep the Node event loop alive solely for this timer.
      // The shutdown sweep destroys rooms explicitly; orphaned grace
      // timers from forgotten rooms must not prevent process exit.
      this.destroyTimer.unref();
    }
  }

  /**
   * Per realtime-broadcast.md §"Event flow":
   *   1. Duplicate check via `processedEventIds`.
   *   2. applyEvent → classify by reference equality on elements/arrows.
   *   3. Broadcast to peers (skip-sender) + bus publish only on `applied`.
   *   4. Ack the sender with `applied | duplicate | rejected`.
   */
  applyAndBroadcast(event: DiagramEvent, originConnectionId: ConnectionId): void {
    const sender = this.clients.get(originConnectionId);

    if (this.state.processedEventIds[event.id]) {
      this.safeSend(sender, { type: 'ack', eventId: event.id, status: 'duplicate' });
      return;
    }

    const nextState = applyEvent(this.state, event);
    const applied =
      nextState.elements !== this.state.elements || nextState.arrows !== this.state.arrows;

    // Commit unconditionally so a retry of the same event id is later
    // classified as `duplicate` and not re-evaluated.
    this.state = nextState;

    if (applied) {
      for (const client of this.clients.values()) {
        if (client.connectionId === originConnectionId) continue;
        this.safeSend(client, { type: 'event', event });
      }
      this.safeSend(sender, { type: 'ack', eventId: event.id, status: 'applied' });
      try {
        this.bus.publish('domain.event', { roomId: this.id, event });
      } catch (err) {
        console.error('[room] bus.publish threw', { roomId: this.id, err });
      }
    } else {
      this.safeSend(sender, { type: 'ack', eventId: event.id, status: 'rejected' });
    }
  }

  /**
   * Send `room_destroyed` to every client and close their sockets with
   * code 1001. Called by the registry just before removing the room
   * from its map. Per spec, must not throw — failures during send/close
   * are caught and logged so a single bad socket cannot prevent the
   * whole tear-down.
   */
  disconnectAll(reason: DestroyReason): void {
    for (const client of this.clients.values()) {
      this.safeSend(client, { type: 'room_destroyed', reason });
      try {
        client.close(1001, `room ${reason}`);
      } catch (err) {
        console.error('[room] client.close threw', { roomId: this.id, err });
      }
    }
  }

  private safeSend(client: ClientHandle | undefined, msg: ServerMessage): void {
    if (!client) return;
    try {
      client.send(msg);
    } catch (err) {
      console.error('[room] client.send threw', { roomId: this.id, err });
    }
  }
}
