import { describe, expect, test } from 'vitest';

import { pointerFromEvent } from '../../src/tools/pointer';

const VP = { scale: 1, offset: { x: 0, y: 0 } };
const RECT = { left: 0, top: 0 };

describe('pointerFromEvent', () => {
  test('reads clientX/clientY from a plain DOM mouse event', () => {
    const ptr = pointerFromEvent({ clientX: 50, clientY: 60, button: 0, target: null }, RECT, VP);
    expect(ptr.screen).toEqual({ x: 50, y: 60 });
    expect(ptr.world).toEqual({ x: 50, y: 60 });
    expect(ptr.button).toBe(0);
    expect(ptr.targetId).toBeNull();
  });

  test('subtracts container offset for the screen coords', () => {
    const ptr = pointerFromEvent(
      { clientX: 100, clientY: 100, button: 0, target: null },
      { left: 25, top: 35 },
      VP,
    );
    expect(ptr.screen).toEqual({ x: 75, y: 65 });
  });

  test('converts to world coords using the viewport transform', () => {
    const vp = { scale: 2, offset: { x: 100, y: 50 } };
    const ptr = pointerFromEvent({ clientX: 300, clientY: 150, target: null }, RECT, vp);
    expect(ptr.world).toEqual({ x: 100, y: 50 });
  });

  test('reads from e.evt when the event is a KonvaEventObject', () => {
    const ptr = pointerFromEvent(
      { evt: { clientX: 40, clientY: 60, button: 1 }, target: null },
      RECT,
      VP,
    );
    expect(ptr.screen).toEqual({ x: 40, y: 60 });
    expect(ptr.button).toBe(1);
  });

  test('extracts id from a Konva-node-like target via id() function', () => {
    const target = { id: () => 'r1', getClassName: () => 'Rect' };
    const ptr = pointerFromEvent({ clientX: 0, clientY: 0, target }, RECT, VP);
    expect(ptr.targetId).toBe('r1');
  });

  test('returns null when the target is the Konva Stage', () => {
    const target = { id: () => '', getClassName: () => 'Stage' };
    const ptr = pointerFromEvent({ clientX: 0, clientY: 0, target }, RECT, VP);
    expect(ptr.targetId).toBeNull();
  });

  test('extracts id from a DOM element via data-id attribute', () => {
    const target = {
      getAttribute(name: string): string | null {
        if (name === 'data-id') return 'r1';
        if (name === 'data-konva') return 'Rect';
        return null;
      },
    };
    const ptr = pointerFromEvent({ clientX: 0, clientY: 0, target }, RECT, VP);
    expect(ptr.targetId).toBe('r1');
  });

  test('returns null when the DOM target is the Stage div', () => {
    const target = {
      getAttribute(name: string): string | null {
        if (name === 'data-konva') return 'Stage';
        return null;
      },
    };
    const ptr = pointerFromEvent({ clientX: 0, clientY: 0, target }, RECT, VP);
    expect(ptr.targetId).toBeNull();
  });
});
