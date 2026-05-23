import { describe, expect, test } from 'vitest';

import { DEFAULT_CIRCLE_SIZE, DEFAULT_RECT_SIZE, MIN_SIZE } from '../../src/tools/constants';
import type { GestureContext, GestureEffect, PointerInfo } from '../../src/tools/gestures/types';
import {
  initialShapeCreateState,
  shapePointerCancel,
  shapePointerDown,
  shapePointerMove,
  shapePointerUp,
} from '../../src/tools/gestures/shape';

const CTX: GestureContext = {
  selection: { kind: 'none' },
  elements: {},
  arrows: {},
  vp: { scale: 1, offset: { x: 0, y: 0 } },
};

function ptr(world: { x: number; y: number }, button = 0): PointerInfo {
  return { button, targetId: null, world, screen: world };
}

function find(effects: GestureEffect[], type: GestureEffect['type']): GestureEffect | undefined {
  return effects.find((e) => e.type === type);
}

describe('shape gesture — pointer down', () => {
  test('records start point and current point in world coords', () => {
    const { state } = shapePointerDown(
      initialShapeCreateState,
      CTX,
      ptr({ x: 50, y: 60 }),
      'rectangle',
    );
    expect(state.creating).toEqual({
      shape: 'rectangle',
      start: { x: 50, y: 60 },
      current: { x: 50, y: 60 },
    });
  });

  test('non-left-button is ignored', () => {
    const { state, effects } = shapePointerDown(
      initialShapeCreateState,
      CTX,
      ptr({ x: 0, y: 0 }, 2),
      'rectangle',
    );
    expect(state).toBe(initialShapeCreateState);
    expect(effects).toEqual([]);
  });
});

describe('shape gesture — pointer move', () => {
  test('updates current point during a drag', () => {
    const down = shapePointerDown(initialShapeCreateState, CTX, ptr({ x: 0, y: 0 }), 'rectangle');
    const move = shapePointerMove(down.state, CTX, ptr({ x: 30, y: 40 }));
    expect(move.state.creating?.current).toEqual({ x: 30, y: 40 });
  });

  test('without an active creation, returns state unchanged', () => {
    const { state } = shapePointerMove(initialShapeCreateState, CTX, ptr({ x: 5, y: 5 }));
    expect(state).toBe(initialShapeCreateState);
  });
});

describe('shape gesture — pointer up (commit)', () => {
  test('rectangle drag larger than MIN_SIZE submits ElementCreated with normalised bbox', () => {
    const down = shapePointerDown(initialShapeCreateState, CTX, ptr({ x: 0, y: 0 }), 'rectangle');
    const move = shapePointerMove(down.state, CTX, ptr({ x: 60, y: 50 }));
    const up = shapePointerUp(move.state, CTX, ptr({ x: 60, y: 50 }));
    const submitted = find(up.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementCreated')
      throw new Error('expected ElementCreated');
    expect(submitted.event.payload.type).toBe('rectangle');
    expect(submitted.event.payload.width).toBe(60);
    expect(submitted.event.payload.height).toBe(50);
    expect(submitted.event.payload.x).toBe(0);
    expect(submitted.event.payload.y).toBe(0);
    expect(up.state.creating).toBeNull();
  });

  test('click-with-no-drag snaps to DEFAULT_RECT_SIZE centered on start', () => {
    const down = shapePointerDown(
      initialShapeCreateState,
      CTX,
      ptr({ x: 100, y: 100 }),
      'rectangle',
    );
    const up = shapePointerUp(down.state, CTX, ptr({ x: 102, y: 101 }));
    const submitted = find(up.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementCreated')
      throw new Error();
    expect(submitted.event.payload.width).toBe(DEFAULT_RECT_SIZE.width);
    expect(submitted.event.payload.height).toBe(DEFAULT_RECT_SIZE.height);
  });

  test('click-with-no-drag uses DEFAULT_CIRCLE_SIZE for the circle tool', () => {
    const down = shapePointerDown(initialShapeCreateState, CTX, ptr({ x: 0, y: 0 }), 'circle');
    const up = shapePointerUp(down.state, CTX, ptr({ x: 0, y: 0 }));
    const submitted = find(up.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementCreated')
      throw new Error();
    expect(submitted.event.payload.type).toBe('circle');
    expect(submitted.event.payload.width).toBe(DEFAULT_CIRCLE_SIZE.width);
    expect(submitted.event.payload.height).toBe(DEFAULT_CIRCLE_SIZE.height);
  });

  test('selects the new element so create→move chains smoothly', () => {
    const down = shapePointerDown(initialShapeCreateState, CTX, ptr({ x: 0, y: 0 }), 'rectangle');
    const up = shapePointerUp(down.state, CTX, ptr({ x: 50, y: 50 }));
    const sel = find(up.effects, 'setSelection');
    if (sel?.type !== 'setSelection') throw new Error();
    expect(sel.selection.kind).toBe('element');
    const submitted = find(up.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ElementCreated')
      throw new Error();
    if (sel.selection.kind !== 'element') throw new Error();
    expect(sel.selection.id).toBe(submitted.event.payload.id);
  });

  test('without an active creation, pointer-up is a no-op', () => {
    const { state, effects } = shapePointerUp(initialShapeCreateState, CTX, ptr({ x: 0, y: 0 }));
    expect(state).toBe(initialShapeCreateState);
    expect(effects).toEqual([]);
  });

  test('MIN_SIZE constant guards the snap behavior', () => {
    expect(MIN_SIZE).toBeGreaterThan(0);
  });
});

describe('shape gesture — cancel', () => {
  test('clears in-progress creation', () => {
    const down = shapePointerDown(initialShapeCreateState, CTX, ptr({ x: 0, y: 0 }), 'rectangle');
    expect(down.state.creating).not.toBeNull();
    const cancelled = shapePointerCancel(down.state);
    expect(cancelled.state.creating).toBeNull();
    expect(cancelled.effects).toEqual([]);
  });
});
