import { describe, expect, test } from 'vitest';

import { arrowEndpoints, intersectBbox } from '../../src/canvas/arrow';
import type { Element } from '@fluxboard/domain';

function rect(id: string, x: number, y: number, w: number, h: number): Element {
  return { id, type: 'rectangle', x, y, width: w, height: h };
}

describe('intersectBbox', () => {
  test('returns the inside point when the segment has zero length', () => {
    const box = rect('a', 0, 0, 100, 100);
    expect(intersectBbox({ x: 50, y: 50 }, { x: 50, y: 50 }, box)).toEqual({
      x: 50,
      y: 50,
    });
  });

  test('exits on the right edge when the outside point is to the east', () => {
    const box = rect('a', 0, 0, 100, 100); // center 50,50; half 50,50
    const point = intersectBbox({ x: 50, y: 50 }, { x: 200, y: 50 }, box);
    expect(point.x).toBeCloseTo(100, 6);
    expect(point.y).toBeCloseTo(50, 6);
  });

  test('exits on the left edge when the outside point is to the west', () => {
    const box = rect('a', 0, 0, 100, 100);
    const point = intersectBbox({ x: 50, y: 50 }, { x: -100, y: 50 }, box);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(50, 6);
  });

  test('exits on the top edge when the outside point is above', () => {
    const box = rect('a', 0, 0, 100, 100);
    const point = intersectBbox({ x: 50, y: 50 }, { x: 50, y: -50 }, box);
    expect(point.x).toBeCloseTo(50, 6);
    expect(point.y).toBeCloseTo(0, 6);
  });

  test('exits on the bottom edge when the outside point is below', () => {
    const box = rect('a', 0, 0, 100, 100);
    const point = intersectBbox({ x: 50, y: 50 }, { x: 50, y: 250 }, box);
    expect(point.x).toBeCloseTo(50, 6);
    expect(point.y).toBeCloseTo(100, 6);
  });

  test('45° diagonal towards a square exits at the corner', () => {
    const box = rect('a', 0, 0, 100, 100);
    const point = intersectBbox({ x: 50, y: 50 }, { x: 150, y: 150 }, box);
    expect(point.x).toBeCloseTo(100, 6);
    expect(point.y).toBeCloseTo(100, 6);
  });

  test('wide box: a diagonal direction exits on the top/bottom edge, not the side', () => {
    // box: 200 wide x 40 tall, center 100,20. dy/dx = 1 → ty (20/1=20) < tx (100/1=100)
    const box = rect('a', 0, 0, 200, 40);
    const point = intersectBbox({ x: 100, y: 20 }, { x: 200, y: 120 }, box);
    expect(point.y).toBeCloseTo(40, 6); // bottom edge
    expect(point.x).toBeCloseTo(120, 6); // 100 + 20 * 1
  });

  test('tall box: a diagonal direction exits on the side edge, not top/bottom', () => {
    // box: 40 wide x 200 tall, center 20,100. dy/dx = 1 → tx (20/1=20) < ty (100/1=100)
    const box = rect('a', 0, 0, 40, 200);
    const point = intersectBbox({ x: 20, y: 100 }, { x: 120, y: 200 }, box);
    expect(point.x).toBeCloseTo(40, 6);
    expect(point.y).toBeCloseTo(120, 6);
  });
});

describe('arrowEndpoints', () => {
  test('two horizontally-separated equal-size boxes: line spans the facing edges', () => {
    const from = rect('a', 0, 0, 100, 100); // center 50,50
    const to = rect('b', 200, 0, 100, 100); // center 250,50
    const { x1, y1, x2, y2 } = arrowEndpoints(from, to);
    expect(x1).toBeCloseTo(100, 6); // right edge of from
    expect(y1).toBeCloseTo(50, 6);
    expect(x2).toBeCloseTo(200, 6); // left edge of to
    expect(y2).toBeCloseTo(50, 6);
  });

  test('vertically stacked boxes: endpoints sit on the facing horizontal edges', () => {
    const from = rect('a', 0, 0, 100, 100); // center 50,50
    const to = rect('b', 0, 300, 100, 100); // center 50,350
    const { x1, y1, x2, y2 } = arrowEndpoints(from, to);
    expect(x1).toBeCloseTo(50, 6);
    expect(y1).toBeCloseTo(100, 6); // bottom of from
    expect(x2).toBeCloseTo(50, 6);
    expect(y2).toBeCloseTo(300, 6); // top of to
  });

  test('coincident centers degenerate but do not crash', () => {
    const from = rect('a', 0, 0, 100, 100); // center 50,50
    const to = rect('b', 0, 0, 100, 100); // center 50,50 (same)
    const r = arrowEndpoints(from, to);
    expect(Number.isFinite(r.x1)).toBe(true);
    expect(Number.isFinite(r.y1)).toBe(true);
    expect(Number.isFinite(r.x2)).toBe(true);
    expect(Number.isFinite(r.y2)).toBe(true);
  });
});
