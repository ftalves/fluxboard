import { ClientMessage } from './messages';

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

/**
 * Parses a single WebSocket frame body (UTF-8 JSON) into a typed
 * `ClientMessage`, or returns a structured error describing why the input
 * did not validate.
 *
 * The returned `ClientMessage` is a clean object containing only the
 * fields defined by the protocol; any extra fields in the input are
 * dropped rather than passed through.
 */
export function parseClientMessage(_raw: string): ParseResult {
  throw new Error('parseClientMessage: not yet implemented');
}
