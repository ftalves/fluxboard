import { applyEvent } from '@/domain/applyEvent';
import { DiagramState, DiagramEvent, Element, Arrow } from '@/domain/types';

const emptyState = (): DiagramState => ({
  elements: {},
  arrows: {},
  processedEventIds: {},
});

const baseEvent = { timestamp: 1000, userId: 'user-1' };

const makeElement = (overrides: Partial<Element> = {}): Element => ({
  id: 'el-1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...overrides,
});

const makeArrow = (overrides: Partial<Arrow> = {}): Arrow => ({
  id: 'arrow-1',
  fromElementId: 'el-1',
  toElementId: 'el-2',
  ...overrides,
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('ignores an event whose id has already been processed', () => {
    const element = makeElement();
    const event: DiagramEvent = {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: element,
    };
    const after = applyEvent(emptyState(), event);
    const again = applyEvent(after, event);

    expect(again).toBe(after); // same reference — no change
  });

  it('adds the event id to processedEventIds after applying', () => {
    const event: DiagramEvent = {
      ...baseEvent,
      id: 'evt-42',
      type: 'ElementCreated',
      payload: makeElement(),
    };
    const after = applyEvent(emptyState(), event);
    expect(after.processedEventIds['evt-42']).toBe(true);
  });
});

// ─── ElementCreated ──────────────────────────────────────────────────────────

describe('ElementCreated', () => {
  it('adds a new element to state', () => {
    const element = makeElement({ id: 'el-1' });
    const event: DiagramEvent = {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: element,
    };
    const after = applyEvent(emptyState(), event);
    expect(after.elements['el-1']).toEqual(element);
  });

  it('overwrites an existing element with the same id (last-write-wins)', () => {
    const original = makeElement({ x: 0, y: 0 });
    const updated = makeElement({ x: 99, y: 99 });
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: original,
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementCreated',
      payload: updated,
    });
    expect(after.elements['el-1']).toEqual(updated);
  });

  it('does not affect arrows', () => {
    const state = emptyState();
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement(),
    });
    expect(after.arrows).toEqual({});
  });

  it('does not mutate input state', () => {
    const state = emptyState();
    applyEvent(state, {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement(),
    });
    expect(state.elements).toEqual({});
  });
});

// ─── ElementMoved ────────────────────────────────────────────────────────────

describe('ElementMoved', () => {
  it('updates x and y on an existing element', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement({ x: 0, y: 0 }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementMoved',
      payload: { id: 'el-1', x: 200, y: 300 },
    });
    expect(after.elements['el-1'].x).toBe(200);
    expect(after.elements['el-1'].y).toBe(300);
  });

  it('does not change other fields when moving', () => {
    const element = makeElement({ width: 120, height: 60, text: 'hello' });
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: element,
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementMoved',
      payload: { id: 'el-1', x: 10, y: 20 },
    });
    expect(after.elements['el-1'].width).toBe(120);
    expect(after.elements['el-1'].height).toBe(60);
    expect(after.elements['el-1'].text).toBe('hello');
  });

  it('is a no-op for an unknown element id', () => {
    const state = emptyState();
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementMoved',
      payload: { id: 'nonexistent', x: 10, y: 10 },
    });
    expect(after.elements).toEqual({});
  });

  it('accepts negative coordinates without error', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement(),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementMoved',
      payload: { id: 'el-1', x: -50, y: -200 },
    });
    expect(after.elements['el-1'].x).toBe(-50);
    expect(after.elements['el-1'].y).toBe(-200);
  });
});

// ─── ElementResized ──────────────────────────────────────────────────────────

describe('ElementResized', () => {
  it('updates width and height on an existing element', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement({ width: 100, height: 50 }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementResized',
      payload: { id: 'el-1', width: 200, height: 150 },
    });
    expect(after.elements['el-1'].width).toBe(200);
    expect(after.elements['el-1'].height).toBe(150);
  });

  it('does not change other fields when resizing', () => {
    const element = makeElement({ x: 10, y: 20, text: 'hi' });
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: element,
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementResized',
      payload: { id: 'el-1', width: 300, height: 300 },
    });
    expect(after.elements['el-1'].x).toBe(10);
    expect(after.elements['el-1'].y).toBe(20);
    expect(after.elements['el-1'].text).toBe('hi');
  });

  it('is a no-op for an unknown element id', () => {
    const after = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementResized',
      payload: { id: 'ghost', width: 10, height: 10 },
    });
    expect(after.elements).toEqual({});
  });

  it('accepts zero and negative dimensions without error', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement(),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementResized',
      payload: { id: 'el-1', width: 0, height: -10 },
    });
    expect(after.elements['el-1'].width).toBe(0);
    expect(after.elements['el-1'].height).toBe(-10);
  });
});

// ─── ElementTextUpdated ──────────────────────────────────────────────────────

describe('ElementTextUpdated', () => {
  it('updates only the text field', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement({ x: 5, y: 5, text: 'old' }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementTextUpdated',
      payload: { id: 'el-1', text: 'new' },
    });
    expect(after.elements['el-1'].text).toBe('new');
    expect(after.elements['el-1'].x).toBe(5);
    expect(after.elements['el-1'].y).toBe(5);
  });

  it('sets text on an element that had none', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement({ text: undefined }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementTextUpdated',
      payload: { id: 'el-1', text: 'hello' },
    });
    expect(after.elements['el-1'].text).toBe('hello');
  });

  it('accepts empty string as a valid text value', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement({ text: 'something' }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementTextUpdated',
      payload: { id: 'el-1', text: '' },
    });
    expect(after.elements['el-1'].text).toBe('');
  });

  it('is a no-op for an unknown element id', () => {
    const after = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementTextUpdated',
      payload: { id: 'ghost', text: 'hello' },
    });
    expect(after.elements).toEqual({});
  });
});

// ─── ElementDeleted ──────────────────────────────────────────────────────────

describe('ElementDeleted', () => {
  it('removes the element from state', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ElementDeleted',
      payload: { id: 'el-1' },
    });
    expect(after.elements['el-1']).toBeUndefined();
  });

  it('removes arrows where fromElementId matches the deleted element', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-1', fromElementId: 'el-1', toElementId: 'el-2' }),
    });

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-del',
      type: 'ElementDeleted',
      payload: { id: 'el-1' },
    });
    expect(after.arrows['arrow-1']).toBeUndefined();
  });

  it('removes arrows where toElementId matches the deleted element', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-1', fromElementId: 'el-1', toElementId: 'el-2' }),
    });

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-del',
      type: 'ElementDeleted',
      payload: { id: 'el-2' },
    });
    expect(after.arrows['arrow-1']).toBeUndefined();
  });

  it('only removes arrows referencing the deleted element, leaving others intact', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-3' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e4',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-1', fromElementId: 'el-1', toElementId: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e5',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-2', fromElementId: 'el-2', toElementId: 'el-3' }),
    });

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-del',
      type: 'ElementDeleted',
      payload: { id: 'el-1' },
    });
    expect(after.arrows['arrow-1']).toBeUndefined();
    expect(after.arrows['arrow-2']).toBeDefined();
  });

  it('is a no-op for an unknown element id', () => {
    const state = emptyState();
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-1',
      type: 'ElementDeleted',
      payload: { id: 'ghost' },
    });
    expect(after.elements).toEqual({});
    expect(after.arrows).toEqual({});
  });

  it('is a no-op when the element does not exist, even if arrows exist', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-1', fromElementId: 'el-1', toElementId: 'el-2' }),
    });

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-del',
      type: 'ElementDeleted',
      payload: { id: 'ghost' },
    });
    expect(after.arrows['arrow-1']).toBeDefined();
  });
});

// ─── ArrowCreated ────────────────────────────────────────────────────────────

describe('ArrowCreated', () => {
  it('adds an arrow when both elements exist', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });

    const arrow = makeArrow({ fromElementId: 'el-1', toElementId: 'el-2' });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-3',
      type: 'ArrowCreated',
      payload: arrow,
    });
    expect(after.arrows['arrow-1']).toEqual(arrow);
  });

  it('is a no-op when fromElementId does not exist', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ArrowCreated',
      payload: makeArrow({ fromElementId: 'ghost', toElementId: 'el-2' }),
    });
    expect(after.arrows).toEqual({});
  });

  it('is a no-op when toElementId does not exist', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'evt-2',
      type: 'ArrowCreated',
      payload: makeArrow({ fromElementId: 'el-1', toElementId: 'ghost' }),
    });
    expect(after.arrows).toEqual({});
  });

  it('overwrites an existing arrow with the same id (last-write-wins)', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-3' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e4',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-1', fromElementId: 'el-1', toElementId: 'el-2' }),
    });

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'e5',
      type: 'ArrowCreated',
      payload: makeArrow({ id: 'arrow-1', fromElementId: 'el-1', toElementId: 'el-3' }),
    });
    expect(after.arrows['arrow-1'].toElementId).toBe('el-3');
  });

  it('accepts a self-referencing arrow when the element exists', () => {
    const state = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    const after = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ArrowCreated',
      payload: makeArrow({ fromElementId: 'el-1', toElementId: 'el-1' }),
    });
    expect(after.arrows['arrow-1']).toBeDefined();
  });

  it('does not affect elements', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    const elementsBefore = { ...state.elements };

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ArrowCreated',
      payload: makeArrow({ fromElementId: 'el-1', toElementId: 'el-2' }),
    });
    expect(after.elements).toEqual(elementsBefore);
  });
});

// ─── ArrowDeleted ────────────────────────────────────────────────────────────

describe('ArrowDeleted', () => {
  it('removes an existing arrow', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ArrowCreated',
      payload: makeArrow(),
    });

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'e4',
      type: 'ArrowDeleted',
      payload: { id: 'arrow-1' },
    });
    expect(after.arrows['arrow-1']).toBeUndefined();
  });

  it('is a no-op for an unknown arrow id', () => {
    const after = applyEvent(emptyState(), {
      ...baseEvent,
      id: 'evt-1',
      type: 'ArrowDeleted',
      payload: { id: 'ghost' },
    });
    expect(after.arrows).toEqual({});
  });

  it('does not affect elements', () => {
    let state = emptyState();
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e1',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-1' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e2',
      type: 'ElementCreated',
      payload: makeElement({ id: 'el-2' }),
    });
    state = applyEvent(state, {
      ...baseEvent,
      id: 'e3',
      type: 'ArrowCreated',
      payload: makeArrow(),
    });
    const elementsBefore = { ...state.elements };

    const after = applyEvent(state, {
      ...baseEvent,
      id: 'e4',
      type: 'ArrowDeleted',
      payload: { id: 'arrow-1' },
    });
    expect(after.elements).toEqual(elementsBefore);
  });
});

// ─── Unknown event type ───────────────────────────────────────────────────────

describe('unknown event type', () => {
  it('returns state unchanged for an unrecognised event type', () => {
    const state = emptyState();
    const unknownEvent = {
      ...baseEvent,
      id: 'evt-1',
      type: 'SomeFutureEvent',
      payload: {},
    } as unknown as DiagramEvent;
    const after = applyEvent(state, unknownEvent);
    expect(after.elements).toEqual({});
    expect(after.arrows).toEqual({});
  });
});
