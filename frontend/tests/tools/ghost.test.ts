import { describe, expect, test } from 'vitest';

import { creationGeometry, ghostGeometry } from '../../src/tools/ghost';

describe('ghostGeometry', () => {
  test('normalises two points to a positive-extent bbox (drag right+down)', () => {
    expect(ghostGeometry({ x: 10, y: 20 }, { x: 50, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  test('normalises when drag goes left+up (start > current)', () => {
    expect(ghostGeometry({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  test('zero-size drag yields a zero-extent bbox at the start point', () => {
    expect(ghostGeometry({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe('creationGeometry', () => {
  const defaults = { width: 100, height: 60 };
  const minSize = 10;

  test('returns the ghost geometry when at least one axis exceeds minSize', () => {
    const start = { x: 0, y: 0 };
    const current = { x: 50, y: 5 };
    expect(creationGeometry(start, current, defaults, minSize)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 5,
    });
  });

  test('snaps to default size centered at start when both axes are below minSize', () => {
    const start = { x: 100, y: 100 };
    const current = { x: 103, y: 102 };
    expect(creationGeometry(start, current, defaults, minSize)).toEqual({
      x: 100 - defaults.width / 2,
      y: 100 - defaults.height / 2,
      width: defaults.width,
      height: defaults.height,
    });
  });

  test('snaps to default when start == current (pure click, no drag)', () => {
    const start = { x: 0, y: 0 };
    expect(creationGeometry(start, start, defaults, minSize)).toEqual({
      x: -defaults.width / 2,
      y: -defaults.height / 2,
      width: defaults.width,
      height: defaults.height,
    });
  });
});
