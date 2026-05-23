import { Ellipse, Rect } from 'react-konva';
import type { Element } from '@fluxboard/domain';

import { ellipseSelectionProps, rectSelectionProps } from './shapeProps';
import type { Viewport } from './viewport';

export type SelectionOverlayProps = { element: Element; vp: Viewport };

export function SelectionOverlay({ element, vp }: SelectionOverlayProps) {
  if (element.type === 'circle') {
    return <Ellipse {...ellipseSelectionProps(element, vp)} />;
  }
  return <Rect {...rectSelectionProps(element, vp)} />;
}
