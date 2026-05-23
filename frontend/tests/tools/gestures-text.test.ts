import { describe, expect, test } from 'vitest';

import { DEFAULT_TEXT_SIZE } from '../../src/tools/constants';
import type { GestureContext, PointerInfo } from '../../src/tools/gestures/types';
import { textPointerDown } from '../../src/tools/gestures/text';

const CTX: GestureContext = {
  selection: { kind: 'none' },
  elements: {},
  arrows: {},
  vp: { scale: 1, offset: { x: 0, y: 0 } },
};

function ptr(
  world: { x: number; y: number },
  targetId: string | null = null,
  button = 0,
): PointerInfo {
  return { button, targetId, world, screen: world };
}

describe('textPointerDown', () => {
  test('click on empty canvas creates a text element + selects + enters edit mode', () => {
    const { effects } = textPointerDown(CTX, ptr({ x: 50, y: 60 }));
    const created = effects.find((e) => e.type === 'submitEvent');
    if (created?.type !== 'submitEvent' || created.event.type !== 'ElementCreated')
      throw new Error();
    expect(created.event.payload.type).toBe('text');
    expect(created.event.payload.x).toBe(50);
    expect(created.event.payload.y).toBe(60);
    expect(created.event.payload.width).toBe(DEFAULT_TEXT_SIZE.width);
    expect(created.event.payload.height).toBe(DEFAULT_TEXT_SIZE.height);
    expect(created.event.payload.text).toBe('');

    const sel = effects.find((e) => e.type === 'setSelection');
    if (sel?.type !== 'setSelection' || sel.selection.kind !== 'element') throw new Error();
    expect(sel.selection.id).toBe(created.event.payload.id);

    const begin = effects.find((e) => e.type === 'beginTextEdit');
    if (begin?.type !== 'beginTextEdit') throw new Error();
    expect(begin.id).toBe(created.event.payload.id);
  });

  test('click on an existing element is ignored', () => {
    const { effects } = textPointerDown(CTX, ptr({ x: 0, y: 0 }, 'existing'));
    expect(effects).toEqual([]);
  });

  test('non-left button is ignored', () => {
    const { effects } = textPointerDown(CTX, ptr({ x: 0, y: 0 }, null, 2));
    expect(effects).toEqual([]);
  });
});
