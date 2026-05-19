import { parseClientMessage, ParseResult } from '@/realtime/protocol/parse';

// ─── Helpers / fixtures ──────────────────────────────────────────────────────

const parseObj = (obj: unknown): ParseResult => parseClientMessage(JSON.stringify(obj));

const validElement = {
  id: 'el-1',
  type: 'rectangle' as const,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
};

const validArrow = {
  id: 'arrow-1',
  fromElementId: 'el-1',
  toElementId: 'el-2',
};

const baseEnvelope = {
  id: 'evt-1',
  timestamp: 1700000000000,
  userId: 'user-1',
};

const validElementCreatedEvent = {
  ...baseEnvelope,
  type: 'ElementCreated',
  payload: validElement,
};

const validEventMessage = (eventOverride: Record<string, unknown> = {}) => ({
  type: 'event',
  event: { ...validElementCreatedEvent, ...eventOverride },
});

// ─── Top-level shape ─────────────────────────────────────────────────────────

describe('parseClientMessage: top-level shape', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['plain text', 'hello'],
    ['unclosed object', '{'],
    ['truncated key', '{"type":'],
  ])('returns bad_json for unparseable input (%s)', (_, input) => {
    expect(parseClientMessage(input)).toMatchObject({
      ok: false,
      error: { code: 'bad_json' },
    });
  });

  it.each([
    ['number', '123'],
    ['quoted string', '"hello"'],
    ['null', 'null'],
    ['boolean', 'true'],
    ['array', '[1, 2]'],
  ])('returns bad_json when top-level is not an object (%s)', (_, input) => {
    expect(parseClientMessage(input)).toMatchObject({
      ok: false,
      error: { code: 'bad_json' },
    });
  });

  it('returns bad_json when the type field is missing', () => {
    expect(parseObj({ userId: 'u' })).toMatchObject({
      ok: false,
      error: { code: 'bad_json' },
    });
  });

  it('returns bad_json when the type field is not a string', () => {
    expect(parseObj({ type: 123 })).toMatchObject({
      ok: false,
      error: { code: 'bad_json' },
    });
  });

  it('returns unknown_message for an unrecognized type literal', () => {
    expect(parseObj({ type: 'foo' })).toMatchObject({
      ok: false,
      error: { code: 'unknown_message' },
    });
  });

  it('attaches a human-readable message to every error', () => {
    const result = parseClientMessage('not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toEqual(expect.any(String));
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

// ─── ping ────────────────────────────────────────────────────────────────────

describe('parseClientMessage: ping', () => {
  it('parses a valid ping', () => {
    expect(parseObj({ type: 'ping' })).toEqual({
      ok: true,
      message: { type: 'ping' },
    });
  });

  it('strips extra fields from the parsed ping', () => {
    expect(parseObj({ type: 'ping', extra: 'ignored' })).toEqual({
      ok: true,
      message: { type: 'ping' },
    });
  });
});

// ─── join ────────────────────────────────────────────────────────────────────

describe('parseClientMessage: join', () => {
  it('parses a valid join', () => {
    expect(parseObj({ type: 'join', userId: 'user-1' })).toEqual({
      ok: true,
      message: { type: 'join', userId: 'user-1' },
    });
  });

  it('returns invalid_join when userId is missing', () => {
    expect(parseObj({ type: 'join' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_join' },
    });
  });

  it('returns invalid_join when userId is not a string', () => {
    expect(parseObj({ type: 'join', userId: 42 })).toMatchObject({
      ok: false,
      error: { code: 'invalid_join' },
    });
  });

  it('returns invalid_join when userId is the empty string', () => {
    expect(parseObj({ type: 'join', userId: '' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_join' },
    });
  });

  it('strips extra fields from the parsed join', () => {
    expect(parseObj({ type: 'join', userId: 'u', extra: 'ignored' })).toEqual({
      ok: true,
      message: { type: 'join', userId: 'u' },
    });
  });
});

// ─── event: envelope ─────────────────────────────────────────────────────────

describe('parseClientMessage: event envelope', () => {
  it('parses a well-formed event message', () => {
    const result = parseObj(validEventMessage());
    expect(result).toEqual({
      ok: true,
      message: { type: 'event', event: validElementCreatedEvent },
    });
  });

  it('returns invalid_event when the event field is missing', () => {
    expect(parseObj({ type: 'event' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });

  it('returns invalid_event when the event field is not an object', () => {
    expect(parseObj({ type: 'event', event: 'not-an-object' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });

  // These all override fields *inside* the event envelope. The outer
  // message `type` stays `'event'` (valid), so the failure code is
  // `invalid_event` rather than `bad_json` or `unknown_message`. The
  // inner `event.type` is a DiagramEvent discriminator (`ElementCreated`,
  // etc.), distinct from the message-level `type` checked at the top.
  it.each([
    ['event.id missing', { id: undefined }],
    ['event.id not a string', { id: 123 }],
    ['event.id empty string', { id: '' }],
    ['event.timestamp missing', { timestamp: undefined }],
    ['event.timestamp not a number', { timestamp: 'now' }],
    ['event.userId missing', { userId: undefined }],
    ['event.userId not a string', { userId: 7 }],
    ['event.userId empty string', { userId: '' }],
    ['event.type missing', { type: undefined }],
    ['event.type not a string', { type: 9 }],
    ['event.type unknown DiagramEvent variant', { type: 'NotAnEvent' }],
    ['event.payload missing', { payload: undefined }],
    ['event.payload not an object', { payload: 'string-payload' }],
    ['event.payload null', { payload: null }],
  ])('returns invalid_event when %s', (_, override) => {
    // `undefined` strips the key during JSON.stringify, simulating "missing".
    const result = parseObj(validEventMessage(override));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });

  it('strips extra fields on the event envelope', () => {
    const result = parseObj(validEventMessage({ extra: 'ignored' }));
    expect(result).toEqual({
      ok: true,
      message: { type: 'event', event: validElementCreatedEvent },
    });
  });
});

// ─── event: error eventId hint ───────────────────────────────────────────────

describe('parseClientMessage: invalid_event eventId hint', () => {
  it('includes eventId on the error when the event.id was extractable', () => {
    // payload is malformed, but event.id is fine.
    const result = parseObj(validEventMessage({ payload: 'not an object' }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_event', eventId: 'evt-1' },
    });
  });

  it('omits eventId on the error when event.id is itself unparseable', () => {
    const result = parseObj(validEventMessage({ id: 123 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_event');
      expect(result.error.eventId).toBeUndefined();
    }
  });

  it('omits eventId when the event field is not an object at all', () => {
    const result = parseObj({ type: 'event', event: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.eventId).toBeUndefined();
    }
  });
});

// ─── event payloads: ElementCreated ──────────────────────────────────────────

describe('parseClientMessage: ElementCreated payload', () => {
  it('parses a valid ElementCreated', () => {
    const result = parseObj(validEventMessage());
    expect(result).toEqual({
      ok: true,
      message: { type: 'event', event: validElementCreatedEvent },
    });
  });

  it('accepts an optional text field', () => {
    const event = {
      ...validElementCreatedEvent,
      payload: { ...validElement, text: 'hello' },
    };
    const result = parseObj({ type: 'event', event });
    expect(result).toEqual({ ok: true, message: { type: 'event', event } });
  });

  it.each(['id', 'x', 'y', 'width', 'height'])(
    'rejects ElementCreated when payload is missing %s',
    (field) => {
      const payload = { ...validElement } as Record<string, unknown>;
      delete payload[field];
      const result = parseObj(validEventMessage({ payload }));
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'invalid_event' },
      });
    },
  );

  it('rejects ElementCreated when type is not one of rectangle/circle/text', () => {
    const result = parseObj(validEventMessage({ payload: { ...validElement, type: 'hexagon' } }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });

  it.each(['rectangle', 'circle', 'text'])('accepts ElementCreated with type %s', (type) => {
    const result = parseObj(validEventMessage({ payload: { ...validElement, type } }));
    expect(result.ok).toBe(true);
  });

  it('rejects ElementCreated when a numeric field is not a number', () => {
    const result = parseObj(validEventMessage({ payload: { ...validElement, x: 'ten' } }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });

  it('strips extra fields from the ElementCreated payload', () => {
    const result = parseObj(validEventMessage({ payload: { ...validElement, extra: 'x' } }));
    expect(result).toEqual({
      ok: true,
      message: { type: 'event', event: validElementCreatedEvent },
    });
  });
});

// ─── event payloads: ElementMoved ────────────────────────────────────────────

describe('parseClientMessage: ElementMoved payload', () => {
  const movedEvent = {
    ...baseEnvelope,
    type: 'ElementMoved',
    payload: { id: 'el-1', x: 50, y: 75 },
  };

  it('parses a valid ElementMoved', () => {
    const result = parseObj({ type: 'event', event: movedEvent });
    expect(result).toEqual({ ok: true, message: { type: 'event', event: movedEvent } });
  });

  it.each(['id', 'x', 'y'])('rejects ElementMoved when payload is missing %s', (field) => {
    const payload = { ...movedEvent.payload } as Record<string, unknown>;
    delete payload[field];
    const result = parseObj({ type: 'event', event: { ...movedEvent, payload } });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });
});

// ─── event payloads: ElementResized ──────────────────────────────────────────

describe('parseClientMessage: ElementResized payload', () => {
  const resizedEvent = {
    ...baseEnvelope,
    type: 'ElementResized',
    payload: { id: 'el-1', width: 200, height: 100 },
  };

  it('parses a valid ElementResized', () => {
    expect(parseObj({ type: 'event', event: resizedEvent })).toEqual({
      ok: true,
      message: { type: 'event', event: resizedEvent },
    });
  });

  it.each(['id', 'width', 'height'])(
    'rejects ElementResized when payload is missing %s',
    (field) => {
      const payload = { ...resizedEvent.payload } as Record<string, unknown>;
      delete payload[field];
      const result = parseObj({ type: 'event', event: { ...resizedEvent, payload } });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'invalid_event' },
      });
    },
  );
});

// ─── event payloads: ElementTextUpdated ──────────────────────────────────────

describe('parseClientMessage: ElementTextUpdated payload', () => {
  const textEvent = {
    ...baseEnvelope,
    type: 'ElementTextUpdated',
    payload: { id: 'el-1', text: 'hello world' },
  };

  it('parses a valid ElementTextUpdated', () => {
    expect(parseObj({ type: 'event', event: textEvent })).toEqual({
      ok: true,
      message: { type: 'event', event: textEvent },
    });
  });

  it('accepts an empty string for text', () => {
    const event = { ...textEvent, payload: { id: 'el-1', text: '' } };
    expect(parseObj({ type: 'event', event })).toEqual({
      ok: true,
      message: { type: 'event', event },
    });
  });

  it('rejects when text is not a string', () => {
    const event = { ...textEvent, payload: { id: 'el-1', text: 42 } };
    expect(parseObj({ type: 'event', event })).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });

  it('rejects when id is missing', () => {
    const event = { ...textEvent, payload: { text: 'x' } };
    expect(parseObj({ type: 'event', event })).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });
});

// ─── event payloads: ElementDeleted ──────────────────────────────────────────

describe('parseClientMessage: ElementDeleted payload', () => {
  const deletedEvent = {
    ...baseEnvelope,
    type: 'ElementDeleted',
    payload: { id: 'el-1' },
  };

  it('parses a valid ElementDeleted', () => {
    expect(parseObj({ type: 'event', event: deletedEvent })).toEqual({
      ok: true,
      message: { type: 'event', event: deletedEvent },
    });
  });

  it('rejects when id is missing', () => {
    const event = { ...deletedEvent, payload: {} };
    expect(parseObj({ type: 'event', event })).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });
});

// ─── event payloads: ArrowCreated ────────────────────────────────────────────

describe('parseClientMessage: ArrowCreated payload', () => {
  const arrowCreatedEvent = {
    ...baseEnvelope,
    type: 'ArrowCreated',
    payload: validArrow,
  };

  it('parses a valid ArrowCreated', () => {
    expect(parseObj({ type: 'event', event: arrowCreatedEvent })).toEqual({
      ok: true,
      message: { type: 'event', event: arrowCreatedEvent },
    });
  });

  it.each(['id', 'fromElementId', 'toElementId'])(
    'rejects ArrowCreated when payload is missing %s',
    (field) => {
      const payload = { ...validArrow } as Record<string, unknown>;
      delete payload[field];
      const result = parseObj({
        type: 'event',
        event: { ...arrowCreatedEvent, payload },
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'invalid_event' },
      });
    },
  );
});

// ─── event payloads: ArrowDeleted ────────────────────────────────────────────

describe('parseClientMessage: ArrowDeleted payload', () => {
  const arrowDeletedEvent = {
    ...baseEnvelope,
    type: 'ArrowDeleted',
    payload: { id: 'arrow-1' },
  };

  it('parses a valid ArrowDeleted', () => {
    expect(parseObj({ type: 'event', event: arrowDeletedEvent })).toEqual({
      ok: true,
      message: { type: 'event', event: arrowDeletedEvent },
    });
  });

  it('rejects when id is missing', () => {
    const event = { ...arrowDeletedEvent, payload: {} };
    expect(parseObj({ type: 'event', event })).toMatchObject({
      ok: false,
      error: { code: 'invalid_event' },
    });
  });
});
