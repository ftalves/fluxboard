import { Text as KonvaText } from 'react-konva';
import type { Element } from '@fluxboard/domain';

import { textShapeProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type TextShapeProps = {
  element: Element;
  vp: Viewport;
  textEditingElementId: string | null;
};

export function TextShape({ element, vp, textEditingElementId }: TextShapeProps) {
  return <KonvaText {...textShapeProps(element, vp, textEditingElementId)} />;
}
