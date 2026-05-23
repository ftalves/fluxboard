import { act, render } from '@testing-library/react';
import { describe, expect, test, beforeEach } from 'vitest';

import { Canvas } from '../../src/canvas/Canvas';
import { fluxStore } from '../../src/store/instance';
import { STYLE } from '../../src/canvas/style';

beforeEach(() => {
  act(() => {
    fluxStore.getState().hydrateFromSync('room', { elements: {}, arrows: {} });
  });
});

describe('Canvas', () => {
  test('renders a Stage with three layers in z-order', () => {
    const { container } = render(<Canvas width={400} height={300} />);
    const stage = container.querySelector('[data-konva="Stage"]');
    expect(stage).not.toBeNull();
    const layers = Array.from(container.querySelectorAll('[data-konva="Layer"]'));
    expect(layers.length).toBe(3);
    expect(layers.map((l) => l.getAttribute('data-name'))).toEqual(['shapes', 'overlay', 'ui']);
  });

  test('shows the empty-state hint when the diagram has no elements', () => {
    const { getByTestId } = render(<Canvas width={400} height={300} />);
    expect(getByTestId('empty-hint')).toBeInTheDocument();
  });

  test('hides the empty-state hint once an element exists in the store', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'ev1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
      });
    });
    const { queryByTestId, container } = render(<Canvas width={400} height={300} />);
    expect(queryByTestId('empty-hint')).toBeNull();
    expect(container.querySelectorAll('[data-konva="Rect"]').length).toBe(1);
  });

  test('renders a Transformer on the ui layer', () => {
    const { container } = render(<Canvas width={400} height={300} />);
    const transformer = container.querySelector('[data-konva="Transformer"]');
    expect(transformer).not.toBeNull();
    expect(transformer?.getAttribute('data-rotateenabled')).toBe('false');
    expect(transformer?.getAttribute('data-flipenabled')).toBe('false');
  });

  test('selection ring appears when an element is selected', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'ev1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'r1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50 },
      });
      fluxStore.getState().setSelection({ kind: 'element', id: 'r1' });
    });
    const { container } = render(<Canvas width={400} height={300} />);
    const strokes = Array.from(container.querySelectorAll('[data-konva="Rect"]')).map((n) =>
      n.getAttribute('data-stroke'),
    );
    expect(strokes).toContain(STYLE.selectionStroke);
  });
});
