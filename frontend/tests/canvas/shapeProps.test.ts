import { describe, expect, test } from 'vitest';

import { arrowEndpoints } from '../../src/canvas/arrow';
import {
  arrowProps,
  ellipseSelectionProps,
  ellipseShapeProps,
  ghostEllipseProps,
  ghostRectProps,
  hoverTargetProps,
  rectShapeProps,
  rectSelectionProps,
  rubberBandProps,
  textShapeProps,
  transformerProps,
} from '../../src/canvas/shapeProps';
import { STYLE } from '../../src/canvas/style';
import type { Arrow, Element } from '@fluxboard/domain';

const VP = { scale: 2, offset: { x: 10, y: 20 } };

function rect(id: string, x = 0, y = 0, w = 100, h = 100): Element {
  return { id, type: 'rectangle', x, y, width: w, height: h };
}

function circle(id: string, x = 0, y = 0, w = 100, h = 80): Element {
  return { id, type: 'circle', x, y, width: w, height: h };
}

function text(id: string, str?: string): Element {
  const base: Element = { id, type: 'text', x: 5, y: 6, width: 200, height: 30 };
  return str === undefined ? base : { ...base, text: str };
}

describe('rectShapeProps', () => {
  test('maps element geometry to Konva Rect props', () => {
    const r = rect('r1', 10, 20, 30, 40);
    expect(rectShapeProps(r, VP)).toMatchObject({
      id: 'r1',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      fill: STYLE.fill,
      stroke: STYLE.stroke,
      strokeWidth: STYLE.strokeWidth / VP.scale,
      draggable: false,
      listening: true,
    });
  });
});

describe('ellipseShapeProps', () => {
  test('anchors at center and uses half-extents for radii', () => {
    const c = circle('c1', 0, 0, 100, 80);
    expect(ellipseShapeProps(c, VP)).toMatchObject({
      id: 'c1',
      x: 50,
      y: 40,
      radiusX: 50,
      radiusY: 40,
      fill: STYLE.fill,
      stroke: STYLE.stroke,
      strokeWidth: STYLE.strokeWidth / VP.scale,
      listening: true,
    });
  });
});

describe('textShapeProps', () => {
  test('uses element.text or an empty string fallback', () => {
    expect(textShapeProps(text('t1', 'hi'), VP, null).text).toBe('hi');
    expect(textShapeProps(text('t1'), VP, null).text).toBe('');
  });

  test('hides the konva text node while the matching id is in edit mode', () => {
    const e = text('t1', 'hi');
    expect(textShapeProps(e, VP, 't1').visible).toBe(false);
    expect(textShapeProps(e, VP, 'other').visible).toBe(true);
    expect(textShapeProps(e, VP, null).visible).toBe(true);
  });

  test('does not wrap by default', () => {
    expect(textShapeProps(text('t1'), VP, null).wrap).toBe('none');
  });

  test('uses STYLE font + fill', () => {
    const props = textShapeProps(text('t1'), VP, null);
    expect(props.fontFamily).toBe(STYLE.fontFamily);
    expect(props.fontSize).toBe(STYLE.fontSize);
    expect(props.fill).toBe(STYLE.textFill);
  });
});

describe('arrowProps', () => {
  test('points are derived from edge-to-edge intersect, not centers', () => {
    const from = rect('a', 0, 0, 100, 100); // center 50,50; right edge 100
    const to = rect('b', 200, 0, 100, 100); // center 250,50; left edge 200
    const props = arrowProps({ id: 'x', fromElementId: 'a', toElementId: 'b' }, from, to, VP);
    expect(props.points).toEqual([
      ...Object.values(arrowEndpoints(from, to)).map((n) => Number(n)),
    ]);
  });

  test('strokeWidth / pointerLength / pointerWidth / hitStrokeWidth scale by 1 / vp.scale', () => {
    const from = rect('a', 0, 0, 100, 100);
    const to = rect('b', 200, 0, 100, 100);
    const arrow: Arrow = { id: 'x', fromElementId: 'a', toElementId: 'b' };
    const props = arrowProps(arrow, from, to, VP);
    expect(props.strokeWidth).toBe(STYLE.strokeWidth / VP.scale);
    expect(props.pointerLength).toBe(STYLE.arrowPointerLength / VP.scale);
    expect(props.pointerWidth).toBe(STYLE.arrowPointerWidth / VP.scale);
    expect(props.hitStrokeWidth).toBe(STYLE.arrowHitStrokeWidth / VP.scale);
  });

  test('only target end carries an arrowhead, fill matches stroke', () => {
    const arrow: Arrow = { id: 'x', fromElementId: 'a', toElementId: 'b' };
    const props = arrowProps(arrow, rect('a'), rect('b', 200), VP);
    expect(props.pointerAtBeginning).toBe(false);
    expect(props.fill).toBe(STYLE.stroke);
    expect(props.stroke).toBe(STYLE.stroke);
    expect(props.listening).toBe(true);
  });

  test('selected arrow uses selectionStroke and a thicker base stroke width', () => {
    const arrow: Arrow = { id: 'x', fromElementId: 'a', toElementId: 'b' };
    const props = arrowProps(arrow, rect('a'), rect('b', 200), VP, { selected: true });
    expect(props.stroke).toBe(STYLE.selectionStroke);
    expect(props.fill).toBe(STYLE.selectionStroke);
    expect(props.strokeWidth).toBe(STYLE.selectedArrowStrokeWidth / VP.scale);
  });
});

describe('rectSelectionProps', () => {
  test('mirrors element bbox with no fill, scaled stroke, dashed line, non-listening', () => {
    const e = rect('r1', 10, 20, 30, 40);
    const props = rectSelectionProps(e, VP);
    expect(props).toMatchObject({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      fill: 'transparent',
      stroke: STYLE.selectionStroke,
      strokeWidth: STYLE.selectionStrokeWidth / VP.scale,
      dash: STYLE.selectionDash,
      listening: false,
    });
  });
});

describe('ellipseSelectionProps', () => {
  test('mirrors element bbox as a center-anchored ellipse outline', () => {
    const e = circle('c1', 0, 0, 100, 80);
    const props = ellipseSelectionProps(e, VP);
    expect(props).toMatchObject({
      x: 50,
      y: 40,
      radiusX: 50,
      radiusY: 40,
      fill: 'transparent',
      stroke: STYLE.selectionStroke,
      strokeWidth: STYLE.selectionStrokeWidth / VP.scale,
      dash: STYLE.selectionDash,
      listening: false,
    });
  });
});

describe('transformerProps', () => {
  test('rotation and flipping are disabled; anchor size scales by 1/vp.scale', () => {
    const props = transformerProps(VP);
    expect(props.rotateEnabled).toBe(false);
    expect(props.flipEnabled).toBe(false);
    expect(props.borderEnabled).toBe(false);
    expect(props.ignoreStroke).toBe(true);
    expect(props.anchorSize).toBe(STYLE.transformerAnchorSize / VP.scale);
    expect(props.anchorStroke).toBe(STYLE.selectionStroke);
    expect(props.anchorFill).toBe('white');
  });
});

describe('hoverTargetProps', () => {
  test('blue dashed for non-self target', () => {
    const e = rect('r1', 10, 20, 30, 40);
    const props = hoverTargetProps(e, VP, { reject: false });
    expect(props.stroke).toBe(STYLE.hoverTargetStroke);
    expect(props.dash).toEqual(STYLE.hoverTargetDash);
    expect(props.strokeWidth).toBe(STYLE.hoverTargetStrokeWidth / VP.scale);
    expect(props.listening).toBe(false);
    expect(props.fill).toBe('transparent');
  });

  test('red dashed when the target is the source itself (rejected)', () => {
    const e = rect('r1', 10, 20, 30, 40);
    const props = hoverTargetProps(e, VP, { reject: true });
    expect(props.stroke).toBe(STYLE.hoverTargetRejectStroke);
    expect(props.dash).toEqual(STYLE.hoverTargetRejectDash);
  });
});

describe('ghostRectProps / ghostEllipseProps', () => {
  test('rect ghost mirrors geometry with dashed blue stroke, no fill, non-listening', () => {
    const props = ghostRectProps({ x: 5, y: 6, width: 70, height: 80 }, VP);
    expect(props).toMatchObject({
      x: 5,
      y: 6,
      width: 70,
      height: 80,
      fill: 'transparent',
      stroke: STYLE.ghostStroke,
      strokeWidth: STYLE.ghostStrokeWidth / VP.scale,
      dash: STYLE.ghostDash,
      listening: false,
    });
  });

  test('ellipse ghost anchors at center, half-extent radii, dashed blue', () => {
    const props = ghostEllipseProps({ x: 0, y: 0, width: 100, height: 80 }, VP);
    expect(props).toMatchObject({
      x: 50,
      y: 40,
      radiusX: 50,
      radiusY: 40,
      fill: 'transparent',
      stroke: STYLE.ghostStroke,
      strokeWidth: STYLE.ghostStrokeWidth / VP.scale,
      dash: STYLE.ghostDash,
      listening: false,
    });
  });
});

describe('rubberBandProps', () => {
  test('line from source center to cursor in world coords, dashed blue, non-listening', () => {
    const props = rubberBandProps({ x: 50, y: 50 }, { x: 200, y: 100 }, VP);
    expect(props.points).toEqual([50, 50, 200, 100]);
    expect(props.stroke).toBe(STYLE.ghostStroke);
    expect(props.strokeWidth).toBe(STYLE.ghostStrokeWidth / VP.scale);
    expect(props.dash).toEqual(STYLE.ghostDash);
    expect(props.listening).toBe(false);
  });
});
