import { describe, expect, test } from 'vitest';

import { isTextEditTarget, keyToTool } from '../../src/tools/keymap';

describe('keyToTool', () => {
  test.each([
    ['v', 'select'],
    ['V', 'select'],
    ['r', 'rectangle'],
    ['R', 'rectangle'],
    ['o', 'circle'],
    ['O', 'circle'],
    ['t', 'text'],
    ['T', 'text'],
    ['a', 'arrow'],
    ['A', 'arrow'],
  ])('"%s" maps to %s', (key, expected) => {
    expect(keyToTool(key)).toBe(expected);
  });

  test.each(['s', '1', 'Escape', 'Enter', ' ', 'Tab'])('"%s" maps to null', (key) => {
    expect(keyToTool(key)).toBeNull();
  });
});

describe('isTextEditTarget', () => {
  test('null target → not editing', () => {
    expect(isTextEditTarget(null)).toBe(false);
  });

  test('TEXTAREA tag → editing', () => {
    expect(isTextEditTarget({ tagName: 'TEXTAREA' })).toBe(true);
  });

  test('INPUT tag → editing (defensive — no inputs in MVP but keep gate broad)', () => {
    expect(isTextEditTarget({ tagName: 'INPUT' })).toBe(true);
  });

  test('contentEditable elements → editing', () => {
    expect(isTextEditTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  test('plain element → not editing', () => {
    expect(isTextEditTarget({ tagName: 'BUTTON' })).toBe(false);
  });
});
