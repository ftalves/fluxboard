import { describe, expect, test } from 'vitest';

import { shouldEmit } from '../../src/tools/throttle';

describe('shouldEmit', () => {
  test('emits when no prior emit (lastEmittedAt is null)', () => {
    expect(shouldEmit(1000, null, 50)).toBe(true);
  });

  test('emits when the gap exceeds the throttle window', () => {
    expect(shouldEmit(1100, 1000, 50)).toBe(true);
  });

  test('emits exactly at the boundary (>=, not >)', () => {
    expect(shouldEmit(1050, 1000, 50)).toBe(true);
  });

  test('suppresses when the gap is below the throttle window', () => {
    expect(shouldEmit(1049, 1000, 50)).toBe(false);
  });
});
