import type { Element } from '@fluxboard/domain';

import type { Viewport } from '../viewport';
import { CircleShape } from './CircleShape';
import { RectangleShape } from './RectangleShape';
import { TextShape } from './TextShape';

export type ShapeProps = {
  element: Element;
  vp: Viewport;
  textEditingElementId: string | null;
};

export function Shape({ element, vp, textEditingElementId }: ShapeProps) {
  switch (element.type) {
    case 'rectangle':
      return <RectangleShape element={element} vp={vp} />;
    case 'circle':
      return <CircleShape element={element} vp={vp} />;
    case 'text':
      return <TextShape element={element} vp={vp} textEditingElementId={textEditingElementId} />;
  }
}
