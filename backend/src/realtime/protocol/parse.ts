import { ClientMessage } from './messages';
import { DiagramEvent } from '@/domain/types';

/**
 * Codes the parser may emit when the input does not pass schema validation.
 *
 * - `bad_json` — input is not parseable as JSON, or the top-level value is
 *   not an object with a string `type` field.
 * - `unknown_message` — top-level shape is valid but `type` is not one of
 *   the recognized client message types (`join`, `event`, `ping`).
 * - `invalid_join` — message `type` is `join` but the `userId` field is
 *   missing, not a string, or empty.
 * - `invalid_event` — message `type` is `event` but the envelope or
 *   payload fails schema validation.
 *
 * Numeric ranges and string lengths are NOT validated (matches
 * `apply-event.md`'s "no validation" stance for runtime events).
 */
export type ParseErrorCode = 'bad_json' | 'unknown_message' | 'invalid_join' | 'invalid_event';

export type ParseError = {
  code: ParseErrorCode;
  message: string;
  // Set when the failure is `invalid_event` AND the event's `id` field
  // was extractable from the malformed payload.
  eventId?: string;
};

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: ParseError };

const okR = (message: ClientMessage): ParseResult => ({ ok: true, message });

const errR = (code: ParseErrorCode, message: string, eventId?: string): ParseResult => ({
  ok: false,
  error: eventId !== undefined ? { code, message, eventId } : { code, message },
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── Event payload validators ────────────────────────────────────────────────

type ParsedPayload = DiagramEvent['payload'];

function parseEventPayload(eventType: string, p: unknown): ParsedPayload | null {
  if (!isPlainObject(p)) return null;

  switch (eventType) {
    case 'ElementCreated': {
      const { id, type, x, y, width, height, text } = p;
      if (typeof id !== 'string') return null;
      if (type !== 'rectangle' && type !== 'circle' && type !== 'text') return null;
      if (typeof x !== 'number') return null;
      if (typeof y !== 'number') return null;
      if (typeof width !== 'number') return null;
      if (typeof height !== 'number') return null;
      if (text !== undefined && typeof text !== 'string') return null;
      const out: { id: string; type: 'rectangle' | 'circle' | 'text'; x: number; y: number; width: number; height: number; text?: string } = {
        id,
        type,
        x,
        y,
        width,
        height,
      };
      if (typeof text === 'string') out.text = text;
      return out;
    }
    case 'ElementMoved': {
      const { id, x, y } = p;
      if (typeof id !== 'string') return null;
      if (typeof x !== 'number') return null;
      if (typeof y !== 'number') return null;
      return { id, x, y };
    }
    case 'ElementResized': {
      const { id, width, height } = p;
      if (typeof id !== 'string') return null;
      if (typeof width !== 'number') return null;
      if (typeof height !== 'number') return null;
      return { id, width, height };
    }
    case 'ElementTextUpdated': {
      const { id, text } = p;
      if (typeof id !== 'string') return null;
      if (typeof text !== 'string') return null;
      return { id, text };
    }
    case 'ElementDeleted': {
      const { id } = p;
      if (typeof id !== 'string') return null;
      return { id };
    }
    case 'ArrowCreated': {
      const { id, fromElementId, toElementId } = p;
      if (typeof id !== 'string') return null;
      if (typeof fromElementId !== 'string') return null;
      if (typeof toElementId !== 'string') return null;
      return { id, fromElementId, toElementId };
    }
    case 'ArrowDeleted': {
      const { id } = p;
      if (typeof id !== 'string') return null;
      return { id };
    }
    default:
      return null;
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function parseClientMessage(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errR('bad_json', 'input is not valid JSON');
  }

  if (!isPlainObject(parsed)) {
    return errR('bad_json', 'top-level value must be a JSON object');
  }

  const typeField = parsed.type;
  if (typeof typeField !== 'string') {
    return errR('bad_json', 'missing or non-string "type" field');
  }

  switch (typeField) {
    case 'ping':
      return okR({ type: 'ping' });

    case 'join': {
      const { userId } = parsed;
      if (typeof userId !== 'string' || userId.length === 0) {
        return errR('invalid_join', '"userId" must be a non-empty string');
      }
      return okR({ type: 'join', userId });
    }

    case 'event': {
      const evt = parsed.event;
      const eventIdHint =
        isPlainObject(evt) && typeof evt.id === 'string' && evt.id.length > 0
          ? evt.id
          : undefined;

      if (!isPlainObject(evt)) {
        return errR('invalid_event', '"event" must be an object');
      }
      const { id, timestamp, userId, type: eventType, payload } = evt;

      if (typeof id !== 'string' || id.length === 0) {
        return errR('invalid_event', '"event.id" must be a non-empty string');
      }
      if (typeof timestamp !== 'number') {
        return errR('invalid_event', '"event.timestamp" must be a number', eventIdHint);
      }
      if (typeof userId !== 'string' || userId.length === 0) {
        return errR('invalid_event', '"event.userId" must be a non-empty string', eventIdHint);
      }
      if (typeof eventType !== 'string') {
        return errR('invalid_event', '"event.type" must be a string', eventIdHint);
      }
      const parsedPayload = parseEventPayload(eventType, payload);
      if (parsedPayload === null) {
        return errR(
          'invalid_event',
          `invalid payload for event type "${eventType}"`,
          eventIdHint,
        );
      }

      const event = {
        id,
        timestamp,
        userId,
        type: eventType,
        payload: parsedPayload,
      } as DiagramEvent;
      return okR({ type: 'event', event });
    }

    default:
      return errR('unknown_message', `unrecognized message type "${typeField}"`);
  }
}
