import type { Arrow, Element } from '@fluxboard/domain';

import { arrowEndpoints } from './arrow';
import { STYLE } from './style';
import type { Viewport } from './viewport';

export type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RectKonvaProps = {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  draggable?: boolean;
  listening: boolean;
  dash?: number[];
};

export type EllipseKonvaProps = {
  id?: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  listening: boolean;
  dash?: number[];
};

export type TextKonvaProps = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  wrap: 'none' | 'word' | 'char';
  listening: boolean;
  visible: boolean;
};

export type ArrowKonvaProps = {
  id: string;
  points: number[];
  stroke: string;
  strokeWidth: number;
  fill: string;
  pointerLength: number;
  pointerWidth: number;
  pointerAtBeginning: boolean;
  hitStrokeWidth: number;
  listening: boolean;
};

export type LineKonvaProps = {
  points: number[];
  stroke: string;
  strokeWidth: number;
  dash: number[];
  listening: boolean;
};

export type TransformerKonvaProps = {
  rotateEnabled: boolean;
  flipEnabled: boolean;
  anchorSize: number;
  anchorStroke: string;
  anchorFill: string;
  borderEnabled: boolean;
  ignoreStroke: boolean;
};

function strokeForVp(vp: Viewport, width: number): number {
  return width / vp.scale;
}

export function rectShapeProps(element: Element, vp: Viewport): RectKonvaProps {
  return {
    id: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    fill: STYLE.fill,
    stroke: STYLE.stroke,
    strokeWidth: strokeForVp(vp, STYLE.strokeWidth),
    draggable: false,
    listening: true,
  };
}

export function ellipseShapeProps(element: Element, vp: Viewport): EllipseKonvaProps {
  return {
    id: element.id,
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
    radiusX: element.width / 2,
    radiusY: element.height / 2,
    fill: STYLE.fill,
    stroke: STYLE.stroke,
    strokeWidth: strokeForVp(vp, STYLE.strokeWidth),
    listening: true,
  };
}

export function textShapeProps(
  element: Element,
  vp: Viewport,
  textEditingElementId: string | null,
): TextKonvaProps {
  void vp;
  return {
    id: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    text: element.text ?? '',
    fontFamily: STYLE.fontFamily,
    fontSize: STYLE.fontSize,
    fill: STYLE.textFill,
    wrap: 'none',
    listening: true,
    visible: textEditingElementId !== element.id,
  };
}

export function arrowProps(
  arrow: Arrow,
  from: Element,
  to: Element,
  vp: Viewport,
  options: { selected?: boolean } = {},
): ArrowKonvaProps {
  const { x1, y1, x2, y2 } = arrowEndpoints(from, to);
  const stroke = options.selected ? STYLE.selectionStroke : STYLE.stroke;
  const baseWidth = options.selected ? STYLE.selectedArrowStrokeWidth : STYLE.strokeWidth;
  return {
    id: arrow.id,
    points: [x1, y1, x2, y2],
    stroke,
    strokeWidth: strokeForVp(vp, baseWidth),
    fill: stroke,
    pointerLength: strokeForVp(vp, STYLE.arrowPointerLength),
    pointerWidth: strokeForVp(vp, STYLE.arrowPointerWidth),
    pointerAtBeginning: false,
    hitStrokeWidth: strokeForVp(vp, STYLE.arrowHitStrokeWidth),
    listening: true,
  };
}

export function rectSelectionProps(element: Element, vp: Viewport): RectKonvaProps {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    fill: 'transparent',
    stroke: STYLE.selectionStroke,
    strokeWidth: strokeForVp(vp, STYLE.selectionStrokeWidth),
    dash: [...STYLE.selectionDash],
    listening: false,
  };
}

export function ellipseSelectionProps(element: Element, vp: Viewport): EllipseKonvaProps {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
    radiusX: element.width / 2,
    radiusY: element.height / 2,
    fill: 'transparent',
    stroke: STYLE.selectionStroke,
    strokeWidth: strokeForVp(vp, STYLE.selectionStrokeWidth),
    dash: [...STYLE.selectionDash],
    listening: false,
  };
}

export function transformerProps(vp: Viewport): TransformerKonvaProps {
  return {
    rotateEnabled: false,
    flipEnabled: false,
    anchorSize: strokeForVp(vp, STYLE.transformerAnchorSize),
    anchorStroke: STYLE.selectionStroke,
    anchorFill: 'white',
    borderEnabled: false,
    ignoreStroke: true,
  };
}

export function hoverTargetProps(
  element: Element,
  vp: Viewport,
  options: { reject: boolean },
): RectKonvaProps {
  const stroke = options.reject ? STYLE.hoverTargetRejectStroke : STYLE.hoverTargetStroke;
  const dash = options.reject ? STYLE.hoverTargetRejectDash : STYLE.hoverTargetDash;
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    fill: 'transparent',
    stroke,
    strokeWidth: strokeForVp(vp, STYLE.hoverTargetStrokeWidth),
    dash: [...dash],
    listening: false,
  };
}

export function ghostRectProps(geom: Geometry, vp: Viewport): RectKonvaProps {
  return {
    x: geom.x,
    y: geom.y,
    width: geom.width,
    height: geom.height,
    fill: 'transparent',
    stroke: STYLE.ghostStroke,
    strokeWidth: strokeForVp(vp, STYLE.ghostStrokeWidth),
    dash: [...STYLE.ghostDash],
    listening: false,
  };
}

export function ghostEllipseProps(geom: Geometry, vp: Viewport): EllipseKonvaProps {
  return {
    x: geom.x + geom.width / 2,
    y: geom.y + geom.height / 2,
    radiusX: geom.width / 2,
    radiusY: geom.height / 2,
    fill: 'transparent',
    stroke: STYLE.ghostStroke,
    strokeWidth: strokeForVp(vp, STYLE.ghostStrokeWidth),
    dash: [...STYLE.ghostDash],
    listening: false,
  };
}

export function rubberBandProps(
  source: { x: number; y: number },
  cursor: { x: number; y: number },
  vp: Viewport,
): LineKonvaProps {
  return {
    points: [source.x, source.y, cursor.x, cursor.y],
    stroke: STYLE.ghostStroke,
    strokeWidth: strokeForVp(vp, STYLE.ghostStrokeWidth),
    dash: [...STYLE.ghostDash],
    listening: false,
  };
}
