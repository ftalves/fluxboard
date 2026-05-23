import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { Canvas } from '../../src/canvas/Canvas';
import { fluxStore } from '../../src/store/instance';
import { ToolProvider } from '../../src/tools/ToolProvider';
import type { Tool } from '../../src/tools/tool';

function renderCanvas(initialTool: Tool = 'select') {
  return render(
    <ToolProvider initialTool={initialTool}>
      <Canvas width={800} height={600} />
    </ToolProvider>,
  );
}

beforeEach(() => {
  act(() => {
    fluxStore.getState().hydrateFromSync('r', { elements: {}, arrows: {} });
    fluxStore.getState().setConnection({ kind: 'connected' });
  });
});

describe('Canvas + tools integration', () => {
  test('rectangle tool: drag on stage creates an element on mouseup', () => {
    const { container } = renderCanvas('rectangle');
    const stage = container.querySelector('[data-konva="Stage"]') as HTMLElement;

    fireEvent.mouseDown(stage, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.mouseMove(stage, { button: 0, clientX: 60, clientY: 70 });
    fireEvent.mouseUp(stage, { button: 0, clientX: 60, clientY: 70 });

    const elements = Object.values(fluxStore.getState().diagram.elements);
    expect(elements.length).toBe(1);
    expect(elements[0]?.type).toBe('rectangle');
    expect(elements[0]?.width).toBe(50);
    expect(elements[0]?.height).toBe(50);
  });

  test('circle tool: click without drag snaps to default size', () => {
    const { container } = renderCanvas('circle');
    const stage = container.querySelector('[data-konva="Stage"]') as HTMLElement;
    fireEvent.mouseDown(stage, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(stage, { button: 0, clientX: 100, clientY: 100 });
    const elements = Object.values(fluxStore.getState().diagram.elements);
    expect(elements[0]?.type).toBe('circle');
    expect(elements[0]?.width).toBe(80);
    expect(elements[0]?.height).toBe(80);
  });

  test('text tool: click on empty canvas places a text element and enters edit mode', () => {
    const { container } = renderCanvas('text');
    const stage = container.querySelector('[data-konva="Stage"]') as HTMLElement;
    fireEvent.mouseDown(stage, { button: 0, clientX: 200, clientY: 50 });
    const elements = Object.values(fluxStore.getState().diagram.elements);
    expect(elements[0]?.type).toBe('text');
    expect(fluxStore.getState().textEditingElementId).toBe(elements[0]?.id);
  });

  test('select tool: clicking an element shape sets selection', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'e1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'r1', type: 'rectangle', x: 50, y: 50, width: 100, height: 100 },
      });
    });
    const { container } = renderCanvas('select');
    const rect = container.querySelector('[data-konva="Rect"]') as HTMLElement;
    fireEvent.mouseDown(rect, { button: 0, clientX: 60, clientY: 60 });
    expect(fluxStore.getState().selection).toEqual({ kind: 'element', id: 'r1' });
  });

  test('arrow tool: source click + target click creates an arrow', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'e1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'a', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
      });
      fluxStore.getState().submitEvent({
        id: 'e2',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'b', type: 'rectangle', x: 200, y: 0, width: 50, height: 50 },
      });
    });
    const { container } = renderCanvas('arrow');
    const rects = Array.from(container.querySelectorAll('[data-konva="Rect"]')) as HTMLElement[];
    const rectA = rects[0];
    const rectB = rects[1];
    if (!rectA || !rectB) throw new Error('expected two rect nodes');
    fireEvent.mouseDown(rectA, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseDown(rectB, { button: 0, clientX: 210, clientY: 10 });
    const arrows = Object.values(fluxStore.getState().diagram.arrows);
    expect(arrows.length).toBe(1);
    expect(arrows[0]?.fromElementId).toBe('a');
    expect(arrows[0]?.toElementId).toBe('b');
  });

  test('gestures gated by connection: mousedown ignored when reconnecting', () => {
    act(() => {
      fluxStore.getState().setConnection({ kind: 'reconnecting', attempt: 1, retryAt: 0 });
    });
    const { container } = renderCanvas('rectangle');
    const stage = container.querySelector('[data-konva="Stage"]') as HTMLElement;
    fireEvent.mouseDown(stage, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseUp(stage, { button: 0, clientX: 50, clientY: 50 });
    expect(Object.keys(fluxStore.getState().diagram.elements).length).toBe(0);
  });

  test('Escape cancels an in-progress rectangle drag', () => {
    const { container } = renderCanvas('rectangle');
    const stage = container.querySelector('[data-konva="Stage"]') as HTMLElement;
    fireEvent.mouseDown(stage, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(stage, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseUp(stage, { button: 0, clientX: 50, clientY: 50 });
    expect(Object.keys(fluxStore.getState().diagram.elements).length).toBe(0);
  });
});
