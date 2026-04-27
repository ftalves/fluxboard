import { validateSeed } from '@/realtime/seedValidator';
import { Element, Arrow } from '@/domain/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Top-level shape ─────────────────────────────────────────────────────────

describe('validateSeed: top-level shape', () => {
  it('accepts an empty seed', () => {
    const result = validateSeed({ elements: {}, arrows: {} });
    expect(result).toEqual({ valid: true, seed: { elements: {}, arrows: {} } });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'hello'],
    ['boolean', true],
    ['array', []],
  ])('rejects when top-level is %s', (_, input) => {
    expect(validateSeed(input)).toMatchObject({ valid: false });
  });

  it('rejects when elements is missing', () => {
    expect(validateSeed({ arrows: {} })).toMatchObject({ valid: false });
  });

  it('rejects when arrows is missing', () => {
    expect(validateSeed({ elements: {} })).toMatchObject({ valid: false });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'x'],
  ])('rejects when elements is %s (not an object)', (_, badElements) => {
    expect(validateSeed({ elements: badElements, arrows: {} })).toMatchObject({ valid: false });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'x'],
  ])('rejects when arrows is %s (not an object)', (_, badArrows) => {
    expect(validateSeed({ elements: {}, arrows: badArrows })).toMatchObject({
      valid: false,
    });
  });
});

// ─── Element validation ──────────────────────────────────────────────────────

describe('validateSeed: elements', () => {
  it('accepts a valid element', () => {
    const el = makeElement();
    const seed = { elements: { [el.id]: el }, arrows: {} };
    expect(validateSeed(seed)).toEqual({ valid: true, seed });
  });

  it.each(['rectangle', 'circle', 'text'])('accepts element with type %s', (type) => {
    const el = makeElement({ type: type as Element['type'] });
    const seed = { elements: { [el.id]: el }, arrows: {} };
    expect(validateSeed(seed)).toMatchObject({ valid: true });
  });

  it('rejects element with unknown type literal', () => {
    const el = { ...makeElement(), type: 'hexagon' };
    expect(validateSeed({ elements: { 'el-1': el }, arrows: {} })).toMatchObject({ valid: false });
  });

  it('rejects when the map key does not match element.id', () => {
    expect(
      validateSeed({
        elements: { 'mismatch-key': makeElement({ id: 'el-1' }) },
        arrows: {},
      }),
    ).toMatchObject({ valid: false });
  });

  it('rejects when element.id is the empty string', () => {
    expect(
      validateSeed({
        elements: { '': makeElement({ id: '' }) },
        arrows: {},
      }),
    ).toMatchObject({ valid: false });
  });

  it('rejects when element.id is not a string', () => {
    const el = { ...makeElement(), id: 123 };
    expect(validateSeed({ elements: { '123': el }, arrows: {} })).toMatchObject({ valid: false });
  });

  it.each(['x', 'y', 'width', 'height'])('rejects element when %s is missing', (field) => {
    const el = { ...makeElement() } as Record<string, unknown>;
    delete el[field];
    expect(validateSeed({ elements: { 'el-1': el }, arrows: {} })).toMatchObject({ valid: false });
  });

  it.each(['x', 'y', 'width', 'height'])('rejects element when %s is not a number', (field) => {
    const el = { ...makeElement(), [field]: 'not a number' };
    expect(validateSeed({ elements: { 'el-1': el }, arrows: {} })).toMatchObject({ valid: false });
  });

  it.each(['x', 'y', 'width', 'height'])('rejects element when %s is NaN', (field) => {
    const el = { ...makeElement(), [field]: NaN };
    expect(validateSeed({ elements: { 'el-1': el }, arrows: {} })).toMatchObject({ valid: false });
  });

  it.each(['x', 'y', 'width', 'height'])('rejects element when %s is Infinity', (field) => {
    const el = { ...makeElement(), [field]: Infinity };
    expect(validateSeed({ elements: { 'el-1': el }, arrows: {} })).toMatchObject({ valid: false });
  });

  it('accepts element with negative coordinates', () => {
    const el = makeElement({ x: -100, y: -50 });
    expect(validateSeed({ elements: { [el.id]: el }, arrows: {} })).toMatchObject({ valid: true });
  });

  it('accepts element with zero or negative dimensions', () => {
    const el = makeElement({ width: 0, height: -1 });
    expect(validateSeed({ elements: { [el.id]: el }, arrows: {} })).toMatchObject({ valid: true });
  });

  it('accepts element with optional text', () => {
    const el = { ...makeElement(), text: 'hello' };
    expect(validateSeed({ elements: { [el.id]: el }, arrows: {} })).toMatchObject({ valid: true });
  });

  it('accepts element with empty-string text', () => {
    const el = { ...makeElement(), text: '' };
    expect(validateSeed({ elements: { [el.id]: el }, arrows: {} })).toMatchObject({ valid: true });
  });

  it('rejects element with non-string text', () => {
    const el = { ...makeElement(), text: 42 };
    expect(validateSeed({ elements: { 'el-1': el }, arrows: {} })).toMatchObject({ valid: false });
  });
});

// ─── Arrow validation ────────────────────────────────────────────────────────

describe('validateSeed: arrows', () => {
  it('accepts a valid arrow with both endpoints in elements', () => {
    const e1 = makeElement({ id: 'el-1' });
    const e2 = makeElement({ id: 'el-2' });
    const a = makeArrow();
    const seed = {
      elements: { [e1.id]: e1, [e2.id]: e2 },
      arrows: { [a.id]: a },
    };
    expect(validateSeed(seed)).toEqual({ valid: true, seed });
  });

  it('rejects when fromElementId is not present in elements', () => {
    const e2 = makeElement({ id: 'el-2' });
    const a = makeArrow({ fromElementId: 'ghost' });
    expect(
      validateSeed({
        elements: { [e2.id]: e2 },
        arrows: { [a.id]: a },
      }),
    ).toMatchObject({ valid: false });
  });

  it('rejects when toElementId is not present in elements', () => {
    const e1 = makeElement({ id: 'el-1' });
    const a = makeArrow({ toElementId: 'ghost' });
    expect(
      validateSeed({
        elements: { [e1.id]: e1 },
        arrows: { [a.id]: a },
      }),
    ).toMatchObject({ valid: false });
  });

  it('rejects when the map key does not match arrow.id', () => {
    const e1 = makeElement({ id: 'el-1' });
    const e2 = makeElement({ id: 'el-2' });
    const a = makeArrow({ id: 'arrow-1' });
    expect(
      validateSeed({
        elements: { [e1.id]: e1, [e2.id]: e2 },
        arrows: { 'wrong-key': a },
      }),
    ).toMatchObject({ valid: false });
  });

  it('rejects when arrow.id is the empty string', () => {
    const e1 = makeElement({ id: 'el-1' });
    const e2 = makeElement({ id: 'el-2' });
    expect(
      validateSeed({
        elements: { [e1.id]: e1, [e2.id]: e2 },
        arrows: { '': makeArrow({ id: '' }) },
      }),
    ).toMatchObject({ valid: false });
  });

  it.each(['fromElementId', 'toElementId'])(
    'rejects when arrow.%s is the empty string',
    (field) => {
      const e1 = makeElement({ id: 'el-1' });
      const e2 = makeElement({ id: 'el-2' });
      const a = { ...makeArrow(), [field]: '' };
      expect(
        validateSeed({
          elements: { [e1.id]: e1, [e2.id]: e2 },
          arrows: { [a.id]: a },
        }),
      ).toMatchObject({ valid: false });
    },
  );

  it('rejects a self-referencing arrow even when the target exists', () => {
    const e = makeElement({ id: 'el-1' });
    const a = makeArrow({ fromElementId: 'el-1', toElementId: 'el-1' });
    expect(
      validateSeed({
        elements: { [e.id]: e },
        arrows: { [a.id]: a },
      }),
    ).toMatchObject({ valid: false });
  });
});

// ─── Multi-element / multi-arrow ─────────────────────────────────────────────

describe('validateSeed: multiple entries', () => {
  it('accepts a non-trivial seed', () => {
    const e1 = makeElement({ id: 'e1' });
    const e2 = makeElement({ id: 'e2' });
    const e3 = makeElement({ id: 'e3' });
    const a1 = makeArrow({ id: 'a1', fromElementId: 'e1', toElementId: 'e2' });
    const a2 = makeArrow({ id: 'a2', fromElementId: 'e2', toElementId: 'e3' });

    const seed = {
      elements: { e1, e2, e3 },
      arrows: { a1, a2 },
    };
    expect(validateSeed(seed)).toMatchObject({ valid: true });
  });

  it('rejects when any one arrow references a missing element', () => {
    const e1 = makeElement({ id: 'e1' });
    const e2 = makeElement({ id: 'e2' });
    const a1 = makeArrow({ id: 'a1', fromElementId: 'e1', toElementId: 'e2' });
    const a2 = makeArrow({ id: 'a2', fromElementId: 'e2', toElementId: 'ghost' });

    expect(validateSeed({ elements: { e1, e2 }, arrows: { a1, a2 } })).toMatchObject({
      valid: false,
    });
  });

  it('rejects when any one element fails validation', () => {
    const e1 = makeElement({ id: 'e1' });
    const e2 = { ...makeElement({ id: 'e2' }), type: 'hexagon' };
    expect(validateSeed({ elements: { e1, e2 }, arrows: {} })).toMatchObject({ valid: false });
  });
});

// ─── Error detail ────────────────────────────────────────────────────────────

describe('validateSeed: error detail', () => {
  it('attaches a non-empty detail string to every failure', () => {
    const result = validateSeed(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.detail).toEqual(expect.any(String));
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });
});
