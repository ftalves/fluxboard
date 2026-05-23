import { describe, expect, test } from 'vitest';

import { screenToWorld, stagePointerWorld, worldToScreen } from '../../src/canvas/coords';
import type { Viewport } from '../../src/canvas/viewport';

const identity: Viewport = { scale: 1, offset: { x: 0, y: 0 } };

describe('screenToWorld', () => {
  test('identity transform returns the input', () => {
    expect(screenToWorld({ x: 12, y: 34 }, identity)).toEqual({ x: 12, y: 34 });
  });

  test('applies offset and scale', () => {
    const vp: Viewport = { scale: 2, offset: { x: 100, y: 50 } };
    // world = (screen - offset) / scale
    expect(screenToWorld({ x: 300, y: 250 }, vp)).toEqual({ x: 100, y: 100 });
  });

  test('handles negative offsets', () => {
    const vp: Viewport = { scale: 0.5, offset: { x: -10, y: -20 } };
    expect(screenToWorld({ x: 90, y: 80 }, vp)).toEqual({ x: 200, y: 200 });
  });
});

describe('worldToScreen', () => {
  test('identity transform returns the input', () => {
    expect(worldToScreen({ x: 12, y: 34 }, identity)).toEqual({ x: 12, y: 34 });
  });

  test('applies scale then offset', () => {
    const vp: Viewport = { scale: 2, offset: { x: 100, y: 50 } };
    // screen = world * scale + offset
    expect(worldToScreen({ x: 50, y: 25 }, vp)).toEqual({ x: 200, y: 100 });
  });
});

describe('roundtrip', () => {
  test('worldToScreen ∘ screenToWorld is identity', () => {
    const vp: Viewport = { scale: 1.7, offset: { x: 33, y: -22 } };
    const screen = { x: 123, y: 456 };
    const back = worldToScreen(screenToWorld(screen, vp), vp);
    expect(back.x).toBeCloseTo(screen.x, 9);
    expect(back.y).toBeCloseTo(screen.y, 9);
  });
});

describe('stagePointerWorld', () => {
  test('returns null when the stage has no pointer position', () => {
    const stage = { getPointerPosition: () => null };
    expect(stagePointerWorld(stage as never, identity)).toBeNull();
  });

  test('converts the stage pointer position through the viewport', () => {
    const stage = { getPointerPosition: () => ({ x: 300, y: 250 }) };
    const vp: Viewport = { scale: 2, offset: { x: 100, y: 50 } };
    expect(stagePointerWorld(stage as never, vp)).toEqual({ x: 100, y: 100 });
  });
});
