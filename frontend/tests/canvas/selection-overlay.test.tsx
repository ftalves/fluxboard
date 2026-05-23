import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { Ghost } from '../../src/canvas/overlays/Ghost';
import { HoverTarget } from '../../src/canvas/overlays/HoverTarget';
import { RubberBand } from '../../src/canvas/overlays/RubberBand';
import { SelectionOverlay } from '../../src/canvas/SelectionOverlay';
import { STYLE } from '../../src/canvas/style';
import type { Element } from '@fluxboard/domain';

const VP = { scale: 1, offset: { x: 0, y: 0 } };

function el(type: 'rectangle' | 'circle' | 'text'): Element {
  return { id: 'e1', type, x: 5, y: 6, width: 30, height: 40 };
}

describe('SelectionOverlay', () => {
  test('rectangle uses a Rect outline', () => {
    const { container } = render(<SelectionOverlay element={el('rectangle')} vp={VP} />);
    const node = container.querySelector('[data-konva="Rect"]');
    expect(node).not.toBeNull();
    expect(node?.getAttribute('data-stroke')).toBe(STYLE.selectionStroke);
    expect(node?.getAttribute('data-listening')).toBe('false');
  });

  test('text uses a Rect outline as well', () => {
    const { container } = render(<SelectionOverlay element={el('text')} vp={VP} />);
    expect(container.querySelector('[data-konva="Rect"]')).not.toBeNull();
    expect(container.querySelector('[data-konva="Ellipse"]')).toBeNull();
  });

  test('circle uses an Ellipse outline anchored at center', () => {
    const { container } = render(<SelectionOverlay element={el('circle')} vp={VP} />);
    const node = container.querySelector('[data-konva="Ellipse"]');
    expect(node).not.toBeNull();
    expect(node?.getAttribute('data-radiusx')).toBe('15');
    expect(node?.getAttribute('data-radiusy')).toBe('20');
  });
});

describe('Ghost', () => {
  test('rectangle ghost renders a dashed Rect', () => {
    const { container } = render(
      <Ghost shape="rectangle" geom={{ x: 0, y: 0, width: 10, height: 10 }} vp={VP} />,
    );
    const node = container.querySelector('[data-konva="Rect"]');
    expect(node?.getAttribute('data-stroke')).toBe(STYLE.ghostStroke);
    expect(node?.getAttribute('data-dash')).toBe(JSON.stringify(STYLE.ghostDash));
  });

  test('circle ghost renders a dashed Ellipse', () => {
    const { container } = render(
      <Ghost shape="circle" geom={{ x: 0, y: 0, width: 10, height: 10 }} vp={VP} />,
    );
    expect(container.querySelector('[data-konva="Ellipse"]')).not.toBeNull();
  });
});

describe('RubberBand', () => {
  test('renders a non-listening dashed Line from source to cursor', () => {
    const { container } = render(
      <RubberBand source={{ x: 1, y: 2 }} cursor={{ x: 3, y: 4 }} vp={VP} />,
    );
    const node = container.querySelector('[data-konva="Line"]');
    expect(node?.getAttribute('data-points')).toBe('[1,2,3,4]');
    expect(node?.getAttribute('data-listening')).toBe('false');
  });
});

describe('HoverTarget', () => {
  test('blue dashed outline when reject is false', () => {
    const { container } = render(<HoverTarget element={el('rectangle')} reject={false} vp={VP} />);
    const node = container.querySelector('[data-konva="Rect"]');
    expect(node?.getAttribute('data-stroke')).toBe(STYLE.hoverTargetStroke);
  });

  test('red dashed outline when reject is true', () => {
    const { container } = render(<HoverTarget element={el('rectangle')} reject={true} vp={VP} />);
    const node = container.querySelector('[data-konva="Rect"]');
    expect(node?.getAttribute('data-stroke')).toBe(STYLE.hoverTargetRejectStroke);
  });
});
