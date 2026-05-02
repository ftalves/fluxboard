import { Room } from '@/realtime/rooms/room';

/**
 * The realtime layer's view of a WebSocket connection.
 *
 * `connection.ts` operates against this abstraction rather than the
 * `ws` library directly, so the FSM stays framework-agnostic and the
 * tests can drive it with a plain object. `server.ts` adapts a real
 * `ws.WebSocket` into a `SocketHandle` at upgrade time.
 *
 * Per [`server-entry.md`](backend/specs/server-entry.md) — Framework boundary,
 * this is the only seam through which Node-specific WS types may flow.
 */
export interface SocketHandle {
  // Outbound
  send(data: string): void;
  close(code: number, reason?: string): void;
  terminate(): void;
  ping(): void;

  // Inbound — handlers are registered exactly once during setup.
  onMessage(handler: (data: string) => void): void;
  onPong(handler: () => void): void;
  onClose(handler: () => void): void;
}

export interface ConnectionConfig {
  joinTimeoutMs: number;
  wsHeartbeatMs: number;
}

export interface ConnectionContext {
  room: Room;
  config: ConnectionConfig;
}

/**
 * Drives the per-socket state machine described in
 * [`wire-protocol.md`](backend/specs/wire-protocol.md) §"Connection states":
 *
 * ```
 * connected → awaitingJoin → joined(roomId, userId) → closed
 * ```
 *
 * Responsibilities:
 *  - Register message/pong/close handlers on the socket.
 *  - Enforce the join timeout (close `4408` if no `join` arrives in
 *    `config.joinTimeoutMs`).
 *  - Parse inbound messages via `parseClientMessage`; map parse errors
 *    onto the wire `error` envelope and (for protocol-level violations)
 *    close the socket with the appropriate code.
 *  - On a successful `join`, build a `ClientHandle` wrapping the socket,
 *    add it to the room, and send the initial `sync` snapshot.
 *  - On subsequent `event` messages, re-stamp `event.timestamp` and
 *    `event.userId` server-side, then call `room.applyAndBroadcast`.
 *  - Maintain heartbeat: send `ping` every `wsHeartbeatMs`; terminate
 *    if the prior interval did not produce a `pong`.
 *  - On socket close, remove the client from the room and clear timers.
 *
 * The function sets up handlers and returns; the FSM lives entirely in
 * the closures over its local state.
 */
export function handleConnection(_socket: SocketHandle, _ctx: ConnectionContext): void {
  throw new Error('handleConnection: not yet implemented');
}
