import { Rect } from 'react-konva';
import type { Element } from '@fluxboard/domain';

import { hoverTargetProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type HoverTargetProps = { element: Element; reject: boolean; vp: Viewport };

export function HoverTarget({ element, reject, vp }: HoverTargetProps) {
  return <Rect {...hoverTargetProps(element, vp, { reject })} />;
}
