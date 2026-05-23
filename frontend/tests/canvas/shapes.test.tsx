import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { ArrowShape } from '../../src/canvas/shapes/ArrowShape';
import { CircleShape } from '../../src/canvas/shapes/CircleShape';
import { RectangleShape } from '../../src/canvas/shapes/RectangleShape';
import { TextShape } from '../../src/canvas/shapes/TextShape';
import type { Arrow, Element } from '@fluxboard/domain';

const VP = { scale: 1, offset: { x: 0, y: 0 } };

function rect(id: string, x = 0, y = 0, w = 100, h = 100): Element {
  return { id, type: 'rectangle', x, y, width: w, height: h };
}

function circle(id: string): Element {
  return { id, type: 'circle', x: 10, y: 20, width: 80, height: 40 };
}

function text(id: string, str: string): Element {
  return { id, type: 'text', x: 1, y: 2, width: 200, height: 30, text: str };
}

describe('shape components', () => {
  test('RectangleShape renders a Konva Rect with element geometry', () => {
    const { container } = render(<RectangleShape element={rect('r1', 5, 6, 7, 8)} vp={VP} />);
    const node = container.querySelector('[data-konva="Rect"]');
    expect(node).not.toBeNull();
    expect(node?.getAttribute('data-id')).toBe('r1');
    expect(node?.getAttribute('data-x')).toBe('5');
    expect(node?.getAttribute('data-width')).toBe('7');
  });

  test('CircleShape renders a Konva Ellipse anchored at center', () => {
    const { container } = render(<CircleShape element={circle('c1')} vp={VP} />);
    const node = container.querySelector('[data-konva="Ellipse"]');
    expect(node).not.toBeNull();
    expect(node?.getAttribute('data-x')).toBe('50'); // 10 + 80/2
    expect(node?.getAttribute('data-radiusx')).toBe('40');
  });

  test('TextShape hides when in edit mode for its id', () => {
    const e = text('t1', 'hello');
    const { container, rerender } = render(
      <TextShape element={e} vp={VP} textEditingElementId={null} />,
    );
    const visibleNode = container.querySelector('[data-konva="Text"]');
    expect(visibleNode?.getAttribute('data-visible')).toBe('true');

    rerender(<TextShape element={e} vp={VP} textEditingElementId="t1" />);
    const hiddenNode = container.querySelector('[data-konva="Text"]');
    expect(hiddenNode?.getAttribute('data-visible')).toBe('false');
  });

  test('ArrowShape draws between bbox edges of from and to', () => {
    const from = rect('a', 0, 0, 100, 100);
    const to = rect('b', 200, 0, 100, 100);
    const arrow: Arrow = { id: 'x', fromElementId: 'a', toElementId: 'b' };
    const { container } = render(<ArrowShape arrow={arrow} from={from} to={to} vp={VP} />);
    const node = container.querySelector('[data-konva="Arrow"]');
    expect(node?.getAttribute('data-points')).toBe('[100,50,200,50]');
    expect(node?.getAttribute('data-pointeratbeginning')).toBe('false');
  });
});
