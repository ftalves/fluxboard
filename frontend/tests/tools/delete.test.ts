import { describe, expect, test } from 'vitest';

import { deleteEffectsFor } from '../../src/tools/gestures/delete';
import type { GestureEffect } from '../../src/tools/gestures/types';

function find(effects: GestureEffect[], type: GestureEffect['type']): GestureEffect | undefined {
  return effects.find((e) => e.type === type);
}

describe('deleteEffectsFor', () => {
  test('returns nothing when selection is none', () => {
    expect(deleteEffectsFor({ kind: 'none' })).toEqual([]);
  });

  test('element selection → ElementDeleted + setSelection to none', () => {
    const effects = deleteEffectsFor({ kind: 'element', id: 'r1' });
    const submitted = find(effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementDeleted')
      throw new Error();
    expect(submitted.event.payload).toEqual({ id: 'r1' });
    const sel = find(effects, 'setSelection');
    if (sel?.type !== 'setSelection') throw new Error();
    expect(sel.selection).toEqual({ kind: 'none' });
  });

  test('arrow selection → ArrowDeleted + setSelection to none', () => {
    const effects = deleteEffectsFor({ kind: 'arrow', id: 'x' });
    const submitted = find(effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ArrowDeleted')
      throw new Error();
    expect(submitted.event.payload).toEqual({ id: 'x' });
  });
});
