import { Arrow as KonvaArrow } from 'react-konva';
import type { Arrow, Element } from '@fluxboard/domain';

import { arrowProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type ArrowShapeProps = {
  arrow: Arrow;
  from: Element;
  to: Element;
  vp: Viewport;
  selected?: boolean;
};

export function ArrowShape({ arrow, from, to, vp, selected = false }: ArrowShapeProps) {
  return <KonvaArrow {...arrowProps(arrow, from, to, vp, { selected })} />;
}
