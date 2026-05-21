import type { Arrow, DiagramEvent, Element } from '@fluxboard/domain';

export type PublicState = {
  elements: Record<string, Element>;
  arrows: Record<string, Arrow>;
};

export type AckStatus = 'applied' | 'duplicate' | 'rejected';

export type ErrorFrame = {
  code: string;
  message?: string;
  eventId?: string;
};

export type CloseInfo = {
  code: number;
  reason: string;
  wasClean: boolean;
};

export type WireCallbacks = {
  onSync: (payload: { roomId: string; state: PublicState }) => void;
  onPeerEvent: (event: DiagramEvent) => void;
  onAck: (eventId: string, status: AckStatus) => void;
  onError: (frame: ErrorFrame) => void;
  onRoomDestroyed: (reason: 'empty' | 'shutdown') => void;
  onClose: (info: CloseInfo) => void;
  onOpen: () => void;
};

export type WireHandle = {
  send(event: DiagramEvent): void;
  ping(): void;
  close(code?: number): void;
};

export type CreateRoomError =
  | { kind: 'create_failed'; status: number; detail?: string }
  | { kind: 'network'; cause: unknown };

const KNOWN_EVENT_TYPES = new Set<DiagramEvent['type']>([
  'ElementCreated',
  'ElementMoved',
  'ElementResized',
  'ElementTextUpdated',
  'ElementDeleted',
  'ArrowCreated',
  'ArrowDeleted',
]);

const BUFFER_CAP = 64;

export function backendOrigin(): string {
  const env = import.meta.env.VITE_BACKEND_URL;
  if (env && typeof env === 'string') return env.replace(/\/+$/, '');
  return window.location.origin;
}

export function wsOrigin(): string {
  const http = backendOrigin();
  return http.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

export function roomsUrl(): string {
  return `${backendOrigin()}/rooms`;
}

export function wsUrl(roomId: string): string {
  return `${wsOrigin()}/ws/${encodeURIComponent(roomId)}`;
}

export async function createRoom(opts?: { signal?: AbortSignal }): Promise<{ roomId: string }> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: { elements: {}, arrows: {} } }),
  };
  if (opts?.signal) init.signal = opts.signal;

  let res: Response;
  try {
    res = await fetch(roomsUrl(), init);
  } catch (cause) {
    const err: CreateRoomError = { kind: 'network', cause };
    throw err;
  }

  if (res.status === 201) {
    try {
      const body = (await res.json()) as { roomId?: unknown };
      if (body && typeof body === 'object' && typeof body.roomId === 'string') {
        return { roomId: body.roomId };
      }
    } catch {
      // fall through to create_failed below
    }
    const err: CreateRoomError = { kind: 'create_failed', status: 201 };
    throw err;
  }

  let detail: string | undefined;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (body && typeof body === 'object' && typeof body.detail === 'string') {
      detail = body.detail;
    }
  } catch {
    // body parse is best-effort
  }
  const err: CreateRoomError =
    detail === undefined
      ? { kind: 'create_failed', status: res.status }
      : { kind: 'create_failed', status: res.status, detail };
  throw err;
}

export function connect(roomId: string, userId: string, cb: WireCallbacks): WireHandle {
  const ws = new WebSocket(wsUrl(roomId));
  let joinAcked = false;
  const buffer: DiagramEvent[] = [];

  ws.onopen = () => {
    try {
      ws.send(JSON.stringify({ type: 'join', userId }));
    } catch {
      // socket may already be closing — surfaced via onclose
    }
    cb.onOpen();
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') {
      console.warn('[wire] non-string frame data:', typeof ev.data);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(ev.data);
    } catch {
      console.warn('[wire] failed to parse frame:', ev.data.slice(0, 200));
      return;
    }
    if (!raw || typeof raw !== 'object') {
      console.warn('[wire] frame is not an object:', raw);
      return;
    }
    const msg = raw as { type?: unknown } & Record<string, unknown>;
    if (typeof msg.type !== 'string') {
      console.warn('[wire] frame missing string type:', msg);
      return;
    }

    switch (msg.type) {
      case 'sync': {
        const state = msg.state as { elements?: unknown; arrows?: unknown } | undefined;
        if (
          typeof msg.roomId !== 'string' ||
          !state ||
          typeof state !== 'object' ||
          !state.elements ||
          typeof state.elements !== 'object' ||
          !state.arrows ||
          typeof state.arrows !== 'object'
        ) {
          console.warn('[wire] invalid sync frame');
          return;
        }
        joinAcked = true;
        cb.onSync({ roomId: msg.roomId, state: state as PublicState });
        for (const e of buffer) {
          try {
            ws.send(JSON.stringify({ type: 'event', event: e }));
          } catch {
            // ignored — close will surface error
          }
        }
        buffer.length = 0;
        return;
      }
      case 'event': {
        const e = msg.event as unknown;
        if (
          !e ||
          typeof e !== 'object' ||
          typeof (e as { type?: unknown }).type !== 'string' ||
          !KNOWN_EVENT_TYPES.has((e as { type: DiagramEvent['type'] }).type)
        ) {
          console.warn('[wire] event frame has unknown discriminant:', e);
          return;
        }
        cb.onPeerEvent(e as DiagramEvent);
        return;
      }
      case 'ack': {
        if (
          typeof msg.eventId !== 'string' ||
          (msg.status !== 'applied' && msg.status !== 'duplicate' && msg.status !== 'rejected')
        ) {
          console.warn('[wire] invalid ack frame');
          return;
        }
        cb.onAck(msg.eventId, msg.status);
        return;
      }
      case 'error': {
        if (typeof msg.code !== 'string') {
          console.warn('[wire] invalid error frame (no code)');
          return;
        }
        const frame: ErrorFrame = { code: msg.code };
        if (typeof msg.message === 'string') frame.message = msg.message;
        if (typeof msg.eventId === 'string') frame.eventId = msg.eventId;
        console.warn('[wire] server error:', frame);
        cb.onError(frame);
        return;
      }
      case 'room_destroyed': {
        const reason = msg.reason;
        if (reason !== 'empty' && reason !== 'shutdown') {
          console.warn('[wire] invalid room_destroyed reason:', reason);
          return;
        }
        cb.onRoomDestroyed(reason);
        return;
      }
      case 'pong':
        return;
      default:
        console.warn('[wire] unknown message type:', msg.type);
        return;
    }
  };

  ws.onclose = (ev: CloseEvent) => {
    cb.onClose({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
  };

  return {
    send(event) {
      if (!joinAcked) {
        if (buffer.length >= BUFFER_CAP) {
          buffer.shift();
          console.warn('[wire] outbound buffer full; dropping oldest event');
        }
        buffer.push(event);
        return;
      }
      try {
        ws.send(JSON.stringify({ type: 'event', event }));
      } catch {
        // socket may be closing
      }
    },
    ping() {
      // reserved — MVP relies on browser protocol-level ping/pong
    },
    close(code = 1000) {
      ws.close(code);
    },
  };
}
