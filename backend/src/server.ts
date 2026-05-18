/**
 * Node-specific HTTP/WS glue — the only file in the codebase that imports
 * from 'node:http', 'node:net', or 'ws' directly.  Route logic and the
 * connection FSM are framework-agnostic; this module adapts them to the
 * Node request/upgrade lifecycle.
 *
 * Per server-entry.md §"Framework boundary":
 *  - readBody   — streams IncomingMessage and enforces the byte cap
 *  - writeHttpResponse — writes an HttpResponse onto a ServerResponse
 *  - createRequestHandler — glues readBody + handleHttpRequest + writeHttpResponse
 *  - createUpgradeHandler — parses roomId from URL, looks it up, upgrades or 404s
 */

import type http from 'node:http';
import type net from 'node:net';
import type { HttpResponse } from '@/realtime/httpRoutes';
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
export function readBody(_req: http.IncomingMessage, _maxBytes: number): Promise<string> {
  throw new Error('readBody: not yet implemented');
}

/** Writes status, headers, and body from an HttpResponse onto a ServerResponse. */
export function writeHttpResponse(_res: http.ServerResponse, _httpRes: HttpResponse): void {
  throw new Error('writeHttpResponse: not yet implemented');
}

/**
 * Returns the Node HTTP request handler.
 * Streams the body (capped at config.MAX_SEED_BYTES), delegates to
 * handleHttpRequest, and writes the result via writeHttpResponse.
 */
export function createRequestHandler(_deps: {
  registry: RoomRegistry;
  config: Config;
}): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (_req, _res) => {
    throw new Error('createRequestHandler handler: not yet implemented');
  };
}

/**
 * Returns the 'upgrade' event handler for the http.Server.
 * Parses `:roomId` from `req.url` (`/ws/:roomId`).
 * On hit  → completes upgrade, adapts ws to SocketHandle, calls handleConnection.
 * On miss → writes HTTP/1.1 404 to the raw socket and destroys it.
 */
export function createUpgradeHandler(_deps: {
  wss: WsServer;
  registry: RoomRegistry;
  bus: EventBus;
  config: Config;
}): (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void {
  return (_req, _socket, _head) => {
    throw new Error('createUpgradeHandler handler: not yet implemented');
  };
}
