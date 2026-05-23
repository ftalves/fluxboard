import { Rect } from 'react-konva';
import type { Element } from '@fluxboard/domain';

import { rectShapeProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type RectangleShapeProps = { element: Element; vp: Viewport };

export function RectangleShape({ element, vp }: RectangleShapeProps) {
  return <Rect {...rectShapeProps(element, vp)} />;
}
