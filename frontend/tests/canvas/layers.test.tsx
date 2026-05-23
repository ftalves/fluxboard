import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { OverlayLayer } from '../../src/canvas/layers/OverlayLayer';
import { ShapesLayer } from '../../src/canvas/layers/ShapesLayer';
import { STYLE } from '../../src/canvas/style';
import type { Arrow, DiagramState, Element } from '@fluxboard/domain';

const VP = { scale: 1, offset: { x: 0, y: 0 } };

function rectEl(id: string, x = 0, y = 0): Element {
  return { id, type: 'rectangle', x, y, width: 100, height: 100 };
}

function circleEl(id: string): Element {
  return { id, type: 'circle', x: 200, y: 0, width: 60, height: 60 };
}

function textEl(id: string): Element {
  return { id, type: 'text', x: 0, y: 300, width: 150, height: 30, text: 'hi' };
}

function diagram(els: Element[], arrows: Arrow[] = []): DiagramState {
  return {
    elements: Object.fromEntries(els.map((e) => [e.id, e])),
    arrows: Object.fromEntries(arrows.map((a) => [a.id, a])),
    processedEventIds: {},
  };
}

describe('ShapesLayer', () => {
  test('renders one node per element grouped by type', () => {
    const d = diagram([rectEl('r'), circleEl('c'), textEl('t')]);
    const { container } = render(
      <ShapesLayer diagram={d} selection={{ kind: 'none' }} textEditingElementId={null} vp={VP} />,
    );
    expect(container.querySelectorAll('[data-konva="Rect"]').length).toBe(1);
    expect(container.querySelectorAll('[data-konva="Ellipse"]').length).toBe(1);
    expect(container.querySelectorAll('[data-konva="Text"]').length).toBe(1);
  });

  test('renders arrows whose endpoints exist', () => {
    const d = diagram(
      [rectEl('a', 0, 0), rectEl('b', 200, 0)],
      [{ id: 'x', fromElementId: 'a', toElementId: 'b' }],
    );
    const { container } = render(
      <ShapesLayer diagram={d} selection={{ kind: 'none' }} textEditingElementId={null} vp={VP} />,
    );
    expect(container.querySelectorAll('[data-konva="Arrow"]').length).toBe(1);
  });

  test('skips arrows whose endpoints are missing', () => {
    const d = diagram(
      [rectEl('a', 0, 0)],
      [{ id: 'x', fromElementId: 'a', toElementId: 'missing' }],
    );
    const { container } = render(
      <ShapesLayer diagram={d} selection={{ kind: 'none' }} textEditingElementId={null} vp={VP} />,
    );
    expect(container.querySelectorAll('[data-konva="Arrow"]').length).toBe(0);
  });

  test('draws a selection ring when an element is selected', () => {
    const d = diagram([rectEl('r')]);
    const { container } = render(
      <ShapesLayer
        diagram={d}
        selection={{ kind: 'element', id: 'r' }}
        textEditingElementId={null}
        vp={VP}
      />,
    );
    const rects = container.querySelectorAll('[data-konva="Rect"]');
    // one for the shape + one for the selection outline
    expect(rects.length).toBe(2);
    const strokes = Array.from(rects).map((n) => n.getAttribute('data-stroke'));
    expect(strokes).toContain(STYLE.selectionStroke);
  });

  test('arrow selection: the arrow itself re-renders with selectionStroke', () => {
    const d = diagram(
      [rectEl('a', 0, 0), rectEl('b', 200, 0)],
      [{ id: 'x', fromElementId: 'a', toElementId: 'b' }],
    );
    const { container } = render(
      <ShapesLayer
        diagram={d}
        selection={{ kind: 'arrow', id: 'x' }}
        textEditingElementId={null}
        vp={VP}
      />,
    );
    const arrow = container.querySelector('[data-konva="Arrow"]');
    expect(arrow?.getAttribute('data-stroke')).toBe(STYLE.selectionStroke);
    // arrow selection has no separate Rect/Ellipse outline; only the two element shapes remain
    const rectStrokes = Array.from(container.querySelectorAll('[data-konva="Rect"]')).map((n) =>
      n.getAttribute('data-stroke'),
    );
    expect(rectStrokes).not.toContain(STYLE.selectionStroke);
  });
});

describe('OverlayLayer', () => {
  test('renders nothing transient by default', () => {
    const { container } = render(<OverlayLayer vp={VP} />);
    expect(container.querySelector('[data-konva="Layer"]')).not.toBeNull();
    expect(container.querySelector('[data-konva="Rect"]')).toBeNull();
    expect(container.querySelector('[data-konva="Ellipse"]')).toBeNull();
    expect(container.querySelector('[data-konva="Line"]')).toBeNull();
  });

  test('renders ghost + rubber band + hover + source marker when provided', () => {
    const source = rectEl('a');
    const hovered = rectEl('b', 200, 0);
    const { container } = render(
      <OverlayLayer
        vp={VP}
        ghost={{ shape: 'rectangle', geom: { x: 0, y: 0, width: 10, height: 10 } }}
        rubberBand={{ source: { x: 0, y: 0 }, cursor: { x: 100, y: 100 } }}
        hoverTarget={{ element: hovered, reject: false }}
        arrowSourceMarker={source}
      />,
    );
    // source marker + hover target + ghost rect = 3 Rect nodes
    expect(container.querySelectorAll('[data-konva="Rect"]').length).toBe(3);
    expect(container.querySelectorAll('[data-konva="Line"]').length).toBe(1);
  });
});
