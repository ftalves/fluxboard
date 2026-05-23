import type { DiagramEvent, Element } from '@fluxboard/domain';

import type { Geometry } from '../canvas/shapeProps';
import type { Selection } from '../store/store';
import type { Vec2 } from '../canvas/viewport';

export type GhostShape = 'rectangle' | 'circle';

export type GhostState = { shape: GhostShape; geom: Geometry };
export type RubberBandState = { source: Vec2; cursor: Vec2 };
export type HoverTargetState = { element: Element; reject: boolean };

export type GestureEffect =
  | { type: 'submitEvent'; event: DiagramEvent }
  | { type: 'setSelection'; selection: Selection }
  | { type: 'beginTextEdit'; id: string }
  | { type: 'endTextEdit' };

export type PointerInfo = {
  button: number;
  targetId: string | null;
  world: Vec2;
  screen: Vec2;
};
