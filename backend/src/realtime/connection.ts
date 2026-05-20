import { randomBytes } from 'node:crypto';
import { Room, ClientHandle, ConnectionId } from '@/realtime/rooms/room';
import { ServerMessage } from '@/realtime/protocol/messages';
import { parseClientMessage } from '@/realtime/protocol/parse';
import { DiagramEvent } from '@fluxboard/domain';

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

type State = 'awaitingJoin' | 'joined' | 'closed';

/**
 * Drives the per-socket state machine described in wire-protocol.md
 * §"Connection states": `connected → awaitingJoin → joined → closed`.
 */
export function handleConnection(socket: SocketHandle, ctx: ConnectionContext): void {
  const connectionId: ConnectionId = randomBytes(8).toString('hex');
  let state: State = 'awaitingJoin';
  let userId = '';
  let isAlive = true;
  let joinTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const sendRaw = (msg: ServerMessage): void => {
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[conn] socket.send threw', { connectionId, err });
    }
  };

  const closeWith = (code: number, reason: string): void => {
    if (state === 'closed') return;
    state = 'closed';
    clearTimers();
    try {
      socket.close(code, reason);
    } catch (err) {
      console.error('[conn] socket.close threw', { connectionId, err });
    }
  };

  const clearTimers = (): void => {
    if (joinTimer) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = (): void => {
    isAlive = true;
    heartbeatTimer = setInterval(() => {
      if (!isAlive) {
        try {
          socket.terminate();
        } catch (err) {
          console.error('[conn] socket.terminate threw', { connectionId, err });
        }
        return;
      }
      isAlive = false;
      try {
        socket.ping();
      } catch (err) {
        console.error('[conn] socket.ping threw', { connectionId, err });
      }
    }, ctx.config.wsHeartbeatMs);
    heartbeatTimer.unref();
  };

  socket.onMessage((data) => {
    if (state === 'closed') return;

    const result = parseClientMessage(data);
    if (!result.ok) {
      const { code, eventId } = result.error;
      const errMsg: ServerMessage =
        eventId !== undefined
          ? { type: 'error', code, eventId }
          : { type: 'error', code };
      sendRaw(errMsg);

      if (code === 'bad_json') closeWith(1003, 'bad_json');
      else if (code === 'invalid_join') closeWith(4400, 'invalid_join');
      // unknown_message + invalid_event: connection stays open.
      return;
    }

    const msg = result.message;

    if (state === 'awaitingJoin') {
      if (msg.type !== 'join') {
        sendRaw({ type: 'error', code: 'must_join_first' });
        closeWith(4400, 'must_join_first');
        return;
      }
      // Join success.
      state = 'joined';
      userId = msg.userId;
      if (joinTimer) {
        clearTimeout(joinTimer);
        joinTimer = null;
      }

      const handle: ClientHandle = {
        connectionId,
        userId,
        send: (m) => sendRaw(m),
        close: (code, reason) => socket.close(code, reason),
      };
      ctx.room.addClient(handle);
      sendRaw({ type: 'sync', roomId: ctx.room.id, state: ctx.room.snapshot() });
      startHeartbeat();
      return;
    }

    // state === 'joined'
    if (msg.type === 'join') {
      sendRaw({ type: 'error', code: 'already_joined' });
      closeWith(4400, 'already_joined');
      return;
    }
    if (msg.type === 'ping') {
      sendRaw({ type: 'pong' });
      return;
    }
    if (msg.type === 'event') {
      const stamped: DiagramEvent = {
        ...msg.event,
        timestamp: Date.now(),
        userId,
      };
      ctx.room.applyAndBroadcast(stamped, connectionId);
      return;
    }
  });

  socket.onPong(() => {
    isAlive = true;
  });

  socket.onClose(() => {
    if (state === 'joined') {
      ctx.room.removeClient(connectionId);
    }
    clearTimers();
    state = 'closed';
  });

  joinTimer = setTimeout(() => {
    joinTimer = null;
    if (state === 'awaitingJoin') closeWith(4408, 'join_timeout');
  }, ctx.config.joinTimeoutMs);
  joinTimer.unref();
}
