import { Ellipse } from 'react-konva';
import type { Element } from '@fluxboard/domain';

import { ellipseShapeProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type CircleShapeProps = { element: Element; vp: Viewport };

export function CircleShape({ element, vp }: CircleShapeProps) {
  return <Ellipse {...ellipseShapeProps(element, vp)} />;
}
