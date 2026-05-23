import { describe, expect, test } from 'vitest';

import {
  DEFAULT_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_FACTOR,
  clampScale,
  zoomAt,
} from '../../src/canvas/viewport';

describe('viewport constants', () => {
  test('default viewport is identity transform', () => {
    expect(DEFAULT_VIEWPORT).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
  });

  test('bounds match spec', () => {
    expect(MIN_SCALE).toBe(0.1);
    expect(MAX_SCALE).toBe(5.0);
    expect(ZOOM_FACTOR).toBeCloseTo(1.1, 6);
  });
});

describe('clampScale', () => {
  test('passes through values inside the range', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.5)).toBe(0.5);
    expect(clampScale(3)).toBe(3);
  });

  test('clamps below MIN_SCALE', () => {
    expect(clampScale(0.05)).toBe(MIN_SCALE);
    expect(clampScale(-1)).toBe(MIN_SCALE);
  });

  test('clamps above MAX_SCALE', () => {
    expect(clampScale(10)).toBe(MAX_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
  });
});

describe('zoomAt', () => {
  test('cursor world point stays fixed across the scale change', () => {
    const vp = { scale: 1, offset: { x: 50, y: 50 } };
    const screenPoint = { x: 200, y: 150 };

    const worldBefore = {
      x: (screenPoint.x - vp.offset.x) / vp.scale,
      y: (screenPoint.y - vp.offset.y) / vp.scale,
    };

    const next = zoomAt(screenPoint, 2.0, vp);
    expect(next.scale).toBe(2.0);

    const worldAfter = {
      x: (screenPoint.x - next.offset.x) / next.scale,
      y: (screenPoint.y - next.offset.y) / next.scale,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  test('zooming out from a non-zero offset still anchors the cursor', () => {
    const vp = { scale: 2, offset: { x: -100, y: 80 } };
    const screenPoint = { x: 400, y: 200 };

    const next = zoomAt(screenPoint, 0.5, vp);

    const worldBefore = {
      x: (screenPoint.x - vp.offset.x) / vp.scale,
      y: (screenPoint.y - vp.offset.y) / vp.scale,
    };
    const worldAfter = {
      x: (screenPoint.x - next.offset.x) / next.scale,
      y: (screenPoint.y - next.offset.y) / next.scale,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  test('writes the supplied nextScale verbatim (caller is responsible for clamping)', () => {
    const vp = { scale: 1, offset: { x: 0, y: 0 } };
    expect(zoomAt({ x: 0, y: 0 }, 3.7, vp).scale).toBe(3.7);
  });
});
