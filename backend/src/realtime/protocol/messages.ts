import { DiagramEvent, Element, Arrow } from '@/domain/types';

// The public projection of DiagramState that crosses the wire.
// `processedEventIds` is internal to the server and never sent to clients.
export type PublicState = {
  elements: Record<string, Element>;
  arrows: Record<string, Arrow>;
};

export type AckStatus = 'applied' | 'duplicate' | 'rejected';

export type DestroyReason = 'empty' | 'shutdown';

// ─── Shared envelope ─────────────────────────────────────────────────────────

export type EventMessage = { type: 'event'; event: DiagramEvent };

// ─── Client → server ─────────────────────────────────────────────────────────

export type JoinMessage = { type: 'join'; userId: string };
export type PingMessage = { type: 'ping' };

export type ClientMessage = JoinMessage | EventMessage | PingMessage;

// ─── Server → client ─────────────────────────────────────────────────────────

export type SyncMessage = { type: 'sync'; roomId: string; state: PublicState };
export type AckMessage = { type: 'ack'; eventId: string; status: AckStatus };
export type ErrorMessage = {
  type: 'error';
  code: string;
  message?: string;
  eventId?: string;
};
export type RoomDestroyedMessage = { type: 'room_destroyed'; reason: DestroyReason };
export type PongMessage = { type: 'pong' };

export type ServerMessage =
  | SyncMessage
  | EventMessage
  | AckMessage
  | ErrorMessage
  | RoomDestroyedMessage
  | PongMessage;
