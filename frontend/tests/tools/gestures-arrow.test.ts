import { describe, expect, test } from 'vitest';

import type { GestureContext, GestureEffect, PointerInfo } from '../../src/tools/gestures/types';
import {
  arrowHover,
  arrowPointerCancel,
  arrowPointerDown,
  initialArrowState,
} from '../../src/tools/gestures/arrow';
import type { Element } from '@fluxboard/domain';

function el(id: string, x = 0, y = 0, w = 50, h = 50): Element {
  return { id, type: 'rectangle', x, y, width: w, height: h };
}

function ctxWith(elements: Element[]): GestureContext {
  return {
    selection: { kind: 'none' },
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
    arrows: {},
    vp: { scale: 1, offset: { x: 0, y: 0 } },
  };
}

function ptr(
  world: { x: number; y: number },
  targetId: string | null = null,
  button = 0,
): PointerInfo {
  return { button, targetId, world, screen: world };
}

function find(effects: GestureEffect[], type: GestureEffect['type']): GestureEffect | undefined {
  return effects.find((e) => e.type === type);
}

describe('arrowPointerDown — source pick', () => {
  test('clicks on an element to record source', () => {
    const a = el('a');
    const ctx = ctxWith([a]);
    const { state, effects } = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    expect(state.sourceId).toBe('a');
    expect(effects).toEqual([]);
  });

  test('mousedown on empty canvas before any source is a no-op', () => {
    const ctx = ctxWith([]);
    const { state, effects } = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, null));
    expect(state).toBe(initialArrowState);
    expect(effects).toEqual([]);
  });

  test('non-left-button is ignored', () => {
    const a = el('a');
    const ctx = ctxWith([a]);
    const { state } = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a', 2));
    expect(state.sourceId).toBeNull();
  });
});

describe('arrowPointerDown — target click', () => {
  test('clicking a different element emits ArrowCreated and clears source', () => {
    const a = el('a');
    const b = el('b', 100, 0);
    const ctx = ctxWith([a, b]);
    const sourced = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    const targeted = arrowPointerDown(sourced.state, ctx, ptr({ x: 100, y: 0 }, 'b'));
    const submitted = find(targeted.effects, 'submitEvent');
    if (submitted?.type !== 'submitEvent' || submitted.event.type !== 'ArrowCreated')
      throw new Error();
    expect(submitted.event.payload.fromElementId).toBe('a');
    expect(submitted.event.payload.toElementId).toBe('b');
    expect(targeted.state.sourceId).toBeNull();
  });

  test('self-click is rejected — no event, source remains', () => {
    const a = el('a');
    const ctx = ctxWith([a]);
    const sourced = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    const same = arrowPointerDown(sourced.state, ctx, ptr({ x: 0, y: 0 }, 'a'));
    expect(find(same.effects, 'submitEvent')).toBeUndefined();
    expect(same.state.sourceId).toBe('a');
  });

  test('click on empty canvas during target phase cancels', () => {
    const a = el('a');
    const ctx = ctxWith([a]);
    const sourced = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    const cancelled = arrowPointerDown(sourced.state, ctx, ptr({ x: 999, y: 999 }, null));
    expect(cancelled.state.sourceId).toBeNull();
    expect(find(cancelled.effects, 'submitEvent')).toBeUndefined();
  });
});

describe('arrowHover', () => {
  test('without a source picked, hover yields no overlay state', () => {
    const ctx = ctxWith([el('a')]);
    const result = arrowHover(initialArrowState, ctx, ptr({ x: 5, y: 5 }, 'a'));
    expect(result.rubberBand).toBeNull();
    expect(result.hoverTarget).toBeNull();
  });

  test('with a source, returns the rubber-band line and a blue hover target when over a different element', () => {
    const a = el('a', 0, 0, 50, 50);
    const b = el('b', 100, 0, 50, 50);
    const ctx = ctxWith([a, b]);
    const sourced = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    const hover = arrowHover(sourced.state, ctx, ptr({ x: 120, y: 25 }, 'b'));
    expect(hover.rubberBand).toEqual({
      source: { x: 25, y: 25 },
      cursor: { x: 120, y: 25 },
    });
    expect(hover.hoverTarget?.element.id).toBe('b');
    expect(hover.hoverTarget?.reject).toBe(false);
  });

  test('hover on the source itself marks the highlight as a reject', () => {
    const a = el('a', 0, 0, 50, 50);
    const ctx = ctxWith([a]);
    const sourced = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    const hover = arrowHover(sourced.state, ctx, ptr({ x: 25, y: 25 }, 'a'));
    expect(hover.hoverTarget?.reject).toBe(true);
  });
});

describe('arrowPointerCancel', () => {
  test('clears the source', () => {
    const a = el('a');
    const ctx = ctxWith([a]);
    const sourced = arrowPointerDown(initialArrowState, ctx, ptr({ x: 0, y: 0 }, 'a'));
    const cancelled = arrowPointerCancel(sourced.state);
    expect(cancelled.state.sourceId).toBeNull();
  });
});
