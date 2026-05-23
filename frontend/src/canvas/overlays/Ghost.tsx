import { Ellipse, Rect } from 'react-konva';

import type { Geometry } from '../shapeProps';
import { ghostEllipseProps, ghostRectProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type GhostShape = 'rectangle' | 'circle';
export type GhostProps = { shape: GhostShape; geom: Geometry; vp: Viewport };

export function Ghost({ shape, geom, vp }: GhostProps) {
  if (shape === 'circle') {
    return <Ellipse {...ghostEllipseProps(geom, vp)} />;
  }
  return <Rect {...ghostRectProps(geom, vp)} />;
}
