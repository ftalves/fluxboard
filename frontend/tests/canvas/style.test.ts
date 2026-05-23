import { describe, expect, test } from 'vitest';

import { STYLE } from '../../src/canvas/style';

describe('STYLE constants', () => {
  test('shape defaults match the spec', () => {
    expect(STYLE.fill).toBe('transparent');
    expect(STYLE.stroke).toBe('#111111');
    expect(STYLE.strokeWidth).toBe(2);
  });

  test('text defaults match the spec', () => {
    expect(STYLE.fontFamily).toBe('system-ui, -apple-system, sans-serif');
    expect(STYLE.fontSize).toBe(16);
    expect(STYLE.textFill).toBe('#111111');
  });

  test('selection styling is solid blue', () => {
    expect(STYLE.selectionStroke).toBe('#3b82f6');
    expect(STYLE.selectionStrokeWidth).toBe(2);
    expect(STYLE.selectionDash).toEqual([]);
    expect(STYLE.transformerAnchorSize).toBe(8);
  });

  test('hover target highlight is dashed blue', () => {
    expect(STYLE.hoverTargetStroke).toBe('#3b82f6');
    expect(STYLE.hoverTargetStrokeWidth).toBe(3);
    expect(STYLE.hoverTargetDash).toEqual([6, 4]);
  });

  test('self-arrow rejection is dashed red', () => {
    expect(STYLE.hoverTargetRejectStroke).toBe('#dc2626');
    expect(STYLE.hoverTargetRejectDash).toEqual([6, 4]);
  });

  test('ghost preview is dashed blue', () => {
    expect(STYLE.ghostStroke).toBe('#3b82f6');
    expect(STYLE.ghostStrokeWidth).toBe(2);
    expect(STYLE.ghostDash).toEqual([8, 4]);
  });
});
