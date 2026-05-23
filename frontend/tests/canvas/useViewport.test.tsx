import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useViewport } from '../../src/canvas/useViewport';
import { DEFAULT_VIEWPORT, MAX_SCALE, MIN_SCALE } from '../../src/canvas/viewport';

type StubMouseEvent = {
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  currentTarget: { getBoundingClientRect: () => DOMRect };
};

type StubWheelEvent = {
  deltaY: number;
  deltaX?: number;
  clientX: number;
  clientY: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault: () => void;
  currentTarget: { getBoundingClientRect: () => DOMRect };
};

function rect(left = 0, top = 0): DOMRect {
  return {
    left,
    top,
    right: left + 1024,
    bottom: top + 768,
    width: 1024,
    height: 768,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function mouseEvent(
  button: number,
  clientX: number,
  clientY: number,
  containerRect: DOMRect = rect(),
): StubMouseEvent {
  return {
    button,
    clientX,
    clientY,
    preventDefault: vi.fn(),
    currentTarget: { getBoundingClientRect: () => containerRect },
  };
}

function wheelEvent(
  deltaY: number,
  clientX: number,
  clientY: number,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; deltaX?: number } = {},
  containerRect: DOMRect = rect(),
): StubWheelEvent {
  return {
    deltaY,
    deltaX: modifiers.deltaX ?? 0,
    clientX,
    clientY,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    preventDefault: vi.fn(),
    currentTarget: { getBoundingClientRect: () => containerRect },
  };
}

describe('useViewport — defaults', () => {
  test('initial state is the identity viewport', () => {
    const { result } = renderHook(() => useViewport());
    expect(result.current.viewport).toEqual(DEFAULT_VIEWPORT);
  });
});

describe('useViewport — pan', () => {
  test('middle-button drag updates the offset by the cursor delta', () => {
    const { result } = renderHook(() => useViewport());

    const down = mouseEvent(1, 100, 100);
    act(() => result.current.onMouseDown(down as never));
    expect(down.preventDefault).toHaveBeenCalled();

    act(() => result.current.onMouseMove(mouseEvent(1, 130, 90) as never));
    expect(result.current.viewport.offset).toEqual({ x: 30, y: -10 });
    expect(result.current.viewport.scale).toBe(1);
  });

  test('mousemove without an active pan is a no-op', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onMouseMove(mouseEvent(0, 50, 50) as never));
    expect(result.current.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  test('left-button mousedown does not start a pan', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onMouseDown(mouseEvent(0, 100, 100) as never));
    act(() => result.current.onMouseMove(mouseEvent(0, 200, 200) as never));
    expect(result.current.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  test('mouseup with button 1 ends the pan', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onMouseDown(mouseEvent(1, 0, 0) as never));
    act(() => result.current.onMouseMove(mouseEvent(1, 25, 25) as never));
    act(() => result.current.onMouseUp(mouseEvent(1, 25, 25) as never));

    act(() => result.current.onMouseMove(mouseEvent(1, 999, 999) as never));
    expect(result.current.viewport.offset).toEqual({ x: 25, y: 25 });
  });

  test('mouseup with a non-middle button does not end the pan', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onMouseDown(mouseEvent(1, 0, 0) as never));
    act(() => result.current.onMouseUp(mouseEvent(0, 0, 0) as never));

    act(() => result.current.onMouseMove(mouseEvent(1, 40, 40) as never));
    expect(result.current.viewport.offset).toEqual({ x: 40, y: 40 });
  });

  test('mouseleave clears panning (fallback when pointer exits the window)', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onMouseDown(mouseEvent(1, 0, 0) as never));
    act(() => result.current.onMouseLeave(mouseEvent(1, 10, 10) as never));

    act(() => result.current.onMouseMove(mouseEvent(1, 200, 200) as never));
    expect(result.current.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  test('pan does not change scale', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onMouseDown(mouseEvent(1, 0, 0) as never));
    act(() => result.current.onMouseMove(mouseEvent(1, 500, -300) as never));
    expect(result.current.viewport.scale).toBe(1);
  });
});

describe('useViewport — zoom', () => {
  test('Ctrl+wheel forward zooms in by 1.1x and preventDefaults', () => {
    const { result } = renderHook(() => useViewport());
    const e = wheelEvent(-100, 0, 0, { ctrlKey: true });
    act(() => result.current.onWheel(e as never));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.viewport.scale).toBeCloseTo(1.1, 9);
  });

  test('Ctrl+wheel backward zooms out by 1/1.1', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onWheel(wheelEvent(100, 0, 0, { ctrlKey: true }) as never));
    expect(result.current.viewport.scale).toBeCloseTo(1 / 1.1, 9);
  });

  test('Meta+wheel also zooms (macOS Cmd)', () => {
    const { result } = renderHook(() => useViewport());
    act(() => result.current.onWheel(wheelEvent(-100, 0, 0, { metaKey: true }) as never));
    expect(result.current.viewport.scale).toBeCloseTo(1.1, 9);
  });

  test('wheel without a modifier is ignored and does not preventDefault', () => {
    const { result } = renderHook(() => useViewport());
    const e = wheelEvent(-100, 100, 100);
    act(() => result.current.onWheel(e as never));
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(result.current.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  test('zoom anchors on the cursor — world point under cursor stays fixed', () => {
    const { result } = renderHook(() => useViewport());

    const cursorScreen = { x: 400, y: 300 };
    const before = result.current.viewport;
    const worldBefore = {
      x: (cursorScreen.x - before.offset.x) / before.scale,
      y: (cursorScreen.y - before.offset.y) / before.scale,
    };

    act(() =>
      result.current.onWheel(
        wheelEvent(-100, cursorScreen.x, cursorScreen.y, { ctrlKey: true }) as never,
      ),
    );

    const after = result.current.viewport;
    const worldAfter = {
      x: (cursorScreen.x - after.offset.x) / after.scale,
      y: (cursorScreen.y - after.offset.y) / after.scale,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  test('zoom uses screen coords relative to the container rect (not raw clientX/Y)', () => {
    const { result } = renderHook(() => useViewport());
    const containerRect = rect(50, 20); // container offset from page (0,0)
    // cursor at clientX=450, clientY=220 → screen=(400, 200) inside container.
    act(() =>
      result.current.onWheel(wheelEvent(-100, 450, 220, { ctrlKey: true }, containerRect) as never),
    );

    const after = result.current.viewport;
    // World point under (400, 200) before zoom is (400, 200) (identity start).
    const worldUnderCursor = {
      x: (400 - after.offset.x) / after.scale,
      y: (200 - after.offset.y) / after.scale,
    };
    expect(worldUnderCursor.x).toBeCloseTo(400, 6);
    expect(worldUnderCursor.y).toBeCloseTo(200, 6);
  });

  test('scale is clamped at MAX_SCALE; further zoom-in is a no-op', () => {
    const { result } = renderHook(() => useViewport());
    // 1.1 ^ 30 ≈ 17.4 — well past MAX_SCALE.
    for (let i = 0; i < 30; i += 1) {
      act(() => result.current.onWheel(wheelEvent(-100, 0, 0, { ctrlKey: true }) as never));
    }
    expect(result.current.viewport.scale).toBe(MAX_SCALE);

    const before = result.current.viewport;
    act(() => result.current.onWheel(wheelEvent(-100, 0, 0, { ctrlKey: true }) as never));
    expect(result.current.viewport).toEqual(before);
  });

  test('scale is clamped at MIN_SCALE', () => {
    const { result } = renderHook(() => useViewport());
    for (let i = 0; i < 50; i += 1) {
      act(() => result.current.onWheel(wheelEvent(100, 0, 0, { ctrlKey: true }) as never));
    }
    expect(result.current.viewport.scale).toBe(MIN_SCALE);
  });
});

describe('useViewport — reset', () => {
  test('reset returns to the identity transform', () => {
    const { result } = renderHook(() => useViewport());

    act(() => result.current.onMouseDown(mouseEvent(1, 0, 0) as never));
    act(() => result.current.onMouseMove(mouseEvent(1, 200, 150) as never));
    act(() => result.current.onMouseUp(mouseEvent(1, 200, 150) as never));
    act(() => result.current.onWheel(wheelEvent(-100, 0, 0, { ctrlKey: true }) as never));
    expect(result.current.viewport).not.toEqual(DEFAULT_VIEWPORT);

    act(() => result.current.reset());
    expect(result.current.viewport).toEqual(DEFAULT_VIEWPORT);
  });
});
