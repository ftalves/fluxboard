/**
 * Node-specific HTTP/WS glue — the only file in the codebase that imports
 * from 'node:http', 'node:net', or 'ws' directly.  Route logic and the
 * connection FSM are framework-agnostic; this module adapts them to the
 * Node request/upgrade lifecycle.
 */

import type http from 'node:http';
import type net from 'node:net';
import {
  handleHttpRequest,
  HttpRequest,
  HttpResponse,
} from '@/realtime/httpRoutes';
import { handleConnection, SocketHandle } from '@/realtime/connection';
import type { RoomRegistry } from '@/realtime/rooms/roomRegistry';
import type { EventBus } from '@/event-bus/bus';
import type { Config } from './config';

// ─── Minimal WS interfaces (avoids a hard ws import in the skeleton) ──────────

/** The subset of ws.WebSocketServer used by the upgrade handler. */
export interface WsServer {
  handleUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer,
    cb: (ws: WsSocket) => void,
  ): void;
}

/** The subset of ws.WebSocket used by the SocketHandle adapter in index.ts. */
export interface WsSocket {
  on(event: 'message', listener: (data: Buffer | string) => void): this;
  on(event: 'pong', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Reads and concatenates all chunks from an IncomingMessage.
 * Rejects with { tooLarge: true } if accumulated bytes exceed `maxBytes`.
 */
export function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      size += buf.length;
      if (size > maxBytes) {
        settle(() => reject({ tooLarge: true }));
        // Best-effort: stop reading. Caller may still receive 'end' or 'error'.
        try {
          req.destroy();
        } catch {
          // ignore — already settling
        }
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      settle(() => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', (err) => {
      settle(() => reject(err));
    });
  });
}

/** Writes status, headers, and body from an HttpResponse onto a ServerResponse. */
export function writeHttpResponse(res: http.ServerResponse, httpRes: HttpResponse): void {
  res.writeHead(httpRes.status, httpRes.headers ?? {});
  if (httpRes.body !== undefined) {
    res.end(httpRes.body);
  } else {
    res.end();
  }
}

/**
 * Returns the Node HTTP request handler.
 * Streams the body (capped at config.MAX_SEED_BYTES), delegates to
 * handleHttpRequest, and writes the result via writeHttpResponse.
 */
export function createRequestHandler(deps: {
  registry: RoomRegistry;
  config: Config;
}): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    let body: string;
    try {
      body = await readBody(req, deps.config.MAX_SEED_BYTES);
    } catch (err) {
      if (err && typeof err === 'object' && (err as { tooLarge?: boolean }).tooLarge) {
        writeHttpResponse(res, {
          status: 413,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'payload_too_large' }),
        });
      } else {
        writeHttpResponse(res, {
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'internal_error' }),
        });
      }
      return;
    }

    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }

    const httpReq: HttpRequest = {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers,
      body,
    };

    const result = handleHttpRequest(httpReq, {
      registry: deps.registry,
      maxBodyBytes: deps.config.MAX_SEED_BYTES,
    });
    writeHttpResponse(res, result);
  };
}

/**
 * Returns the 'upgrade' event handler for the http.Server.
 * Parses `:roomId` from `req.url` (`/ws/:roomId`).
 * On hit  → completes upgrade, adapts ws to SocketHandle, calls handleConnection.
 * On miss → writes HTTP/1.1 404 to the raw socket and destroys it.
 */
export function createUpgradeHandler(deps: {
  wss: WsServer;
  registry: RoomRegistry;
  bus: EventBus;
  config: Config;
}): (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void {
  return (req, socket, head) => {
    const url = req.url ?? '';
    // /ws/:roomId — capture up to first /, ?, or end of string.
    const match = url.match(/^\/ws\/([^/?]+)/);
    if (!match) {
      reject404(socket);
      return;
    }
    const roomId = match[1];
    const room = deps.registry.getRoom(roomId);
    if (!room) {
      reject404(socket);
      return;
    }

    deps.wss.handleUpgrade(req, socket, head, (ws) => {
      const handle: SocketHandle = {
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
        terminate: () => ws.terminate(),
        ping: () => ws.ping(),
        onMessage: (h) =>
          ws.on('message', (data) => {
            const str =
              typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            h(str);
          }),
        onPong: (h) => ws.on('pong', h),
        onClose: (h) => ws.on('close', h),
      };
      handleConnection(handle, {
        room,
        config: {
          joinTimeoutMs: deps.config.JOIN_TIMEOUT_MS,
          wsHeartbeatMs: deps.config.WS_HEARTBEAT_MS,
        },
      });
    });
  };
}

function reject404(socket: net.Socket): void {
  try {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  } catch {
    // ignore — socket may already be unwritable
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}
