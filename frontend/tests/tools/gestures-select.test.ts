import { describe, expect, test } from 'vitest';

import {
  initialSelectState,
  selectPointerDown,
  selectPointerMove,
  selectPointerUp,
} from '../../src/tools/gestures/select';
import type { GestureEffect, PointerInfo } from '../../src/tools/effects';
import type { Selection } from '../../src/store/store';
import type { Element } from '@fluxboard/domain';

const VP = { scale: 1, offset: { x: 0, y: 0 } };

function el(id: string, x = 10, y = 20, w = 30, h = 40): Element {
  return { id, type: 'rectangle', x, y, width: w, height: h };
}

function ptr(opts: Partial<PointerInfo> = {}): PointerInfo {
  return {
    button: 0,
    targetId: null,
    world: { x: 0, y: 0 },
    screen: { x: 0, y: 0 },
    ...opts,
  };
}

function ctx(selection: Selection, elements: Element[] = []) {
  const elementsById = Object.fromEntries(elements.map((e) => [e.id, e]));
  return { selection, elements: elementsById, arrows: {}, vp: VP };
}

function find(effects: GestureEffect[], type: GestureEffect['type']): GestureEffect | undefined {
  return effects.find((e) => e.type === type);
}

describe('selectPointerDown', () => {
  test('click on an element sets element selection', () => {
    const r = el('r1');
    const { effects } = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'none' }, [r]),
      ptr({ targetId: 'r1', world: { x: 20, y: 30 }, screen: { x: 20, y: 30 } }),
      0,
    );
    expect(find(effects, 'setSelection')).toEqual({
      type: 'setSelection',
      selection: { kind: 'element', id: 'r1' },
    });
  });

  test('click on the same already-selected element does not re-set selection', () => {
    const r = el('r1');
    const { effects } = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'element', id: 'r1' }, [r]),
      ptr({ targetId: 'r1' }),
      0,
    );
    expect(find(effects, 'setSelection')).toBeUndefined();
  });

  test('click on empty canvas clears selection', () => {
    const { effects } = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'element', id: 'r1' }, [el('r1')]),
      ptr({ targetId: null }),
      0,
    );
    expect(find(effects, 'setSelection')).toEqual({
      type: 'setSelection',
      selection: { kind: 'none' },
    });
  });

  test('non-left button is a no-op', () => {
    const { state, effects } = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'none' }, [el('r1')]),
      ptr({ targetId: 'r1', button: 2 }),
      0,
    );
    expect(state).toBe(initialSelectState);
    expect(effects).toEqual([]);
  });

  test('starts drag-move state when clicking on an element', () => {
    const r = el('r1', 10, 20, 30, 40);
    const { state } = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'none' }, [r]),
      ptr({ targetId: 'r1', screen: { x: 100, y: 100 }, world: { x: 100, y: 100 } }),
      0,
    );
    expect(state.dragMove).toEqual({
      id: 'r1',
      startScreen: { x: 100, y: 100 },
      startElementPos: { x: 10, y: 20 },
      lastEmittedAt: null,
    });
  });
});

describe('selectPointerMove', () => {
  test('without a drag in progress, returns state unchanged and no effects', () => {
    const { state, effects } = selectPointerMove(
      initialSelectState,
      ctx({ kind: 'none' }),
      ptr(),
      100,
    );
    expect(state).toBe(initialSelectState);
    expect(effects).toEqual([]);
  });

  test('emits a throttled ElementMoved event with delta-adjusted position', () => {
    const r = el('r1', 10, 20);
    const start = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'none' }, [r]),
      ptr({ targetId: 'r1', screen: { x: 100, y: 100 }, world: { x: 100, y: 100 } }),
      0,
    );
    const move = selectPointerMove(
      start.state,
      ctx({ kind: 'element', id: 'r1' }, [r]),
      ptr({ screen: { x: 130, y: 80 }, world: { x: 130, y: 80 } }),
      100,
    );
    const submitted = find(move.effects, 'submitEvent');
    expect(submitted).toBeDefined();
    if (submitted?.type !== 'submitEvent') throw new Error('expected submitEvent');
    expect(submitted.event.type).toBe('ElementMoved');
    if (submitted.event.type !== 'ElementMoved') throw new Error();
    expect(submitted.event.payload).toEqual({ id: 'r1', x: 40, y: 0 });
    expect(move.state.dragMove?.lastEmittedAt).toBe(100);
  });

  test('throttles subsequent moves within the window', () => {
    const r = el('r1', 0, 0);
    const start = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'none' }, [r]),
      ptr({ targetId: 'r1' }),
      0,
    );
    const first = selectPointerMove(
      start.state,
      ctx({ kind: 'element', id: 'r1' }, [r]),
      ptr({ screen: { x: 10, y: 0 }, world: { x: 10, y: 0 } }),
      0,
    );
    const second = selectPointerMove(
      first.state,
      ctx({ kind: 'element', id: 'r1' }, [r]),
      ptr({ screen: { x: 20, y: 0 }, world: { x: 20, y: 0 } }),
      10,
    );
    expect(find(second.effects, 'submitEvent')).toBeUndefined();
  });

  test('scales the screen delta by 1/vp.scale to get world delta', () => {
    const r = el('r1', 0, 0);
    const customVp = { scale: 2, offset: { x: 0, y: 0 } };
    const start = selectPointerDown(
      initialSelectState,
      { selection: { kind: 'none' }, elements: { r1: r }, arrows: {}, vp: customVp },
      ptr({ targetId: 'r1', screen: { x: 0, y: 0 } }),
      0,
    );
    const move = selectPointerMove(
      start.state,
      { selection: { kind: 'element', id: 'r1' }, elements: { r1: r }, arrows: {}, vp: customVp },
      ptr({ screen: { x: 100, y: 0 } }),
      100,
    );
    const submitted = find(move.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementMoved')
      throw new Error();
    expect(submitted.event.payload.x).toBe(50);
  });
});

describe('selectPointerUp', () => {
  test('without a drag in progress, returns state unchanged and no effects', () => {
    const { state, effects } = selectPointerUp(
      initialSelectState,
      ctx({ kind: 'none' }),
      ptr(),
      100,
    );
    expect(state).toBe(initialSelectState);
    expect(effects).toEqual([]);
  });

  test('emits a final ElementMoved with the terminal position and clears drag', () => {
    const r = el('r1', 10, 20);
    const start = selectPointerDown(
      initialSelectState,
      ctx({ kind: 'none' }, [r]),
      ptr({ targetId: 'r1', screen: { x: 0, y: 0 } }),
      0,
    );
    const up = selectPointerUp(
      start.state,
      ctx({ kind: 'element', id: 'r1' }, [r]),
      ptr({ screen: { x: 50, y: 60 } }),
      10,
    );
    const submitted = find(up.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementMoved')
      throw new Error();
    expect(submitted.event.payload).toEqual({ id: 'r1', x: 60, y: 80 });
    expect(up.state.dragMove).toBeNull();
  });
});
