import type { Arrow, Element } from '@fluxboard/domain';

import type { GestureEffect, PointerInfo } from '../effects';
import type { Selection } from '../../store/store';
import type { Viewport } from '../../canvas/viewport';

export type GestureContext = {
  selection: Selection;
  elements: Record<string, Element>;
  arrows: Record<string, Arrow>;
  vp: Viewport;
};

export type GestureResult<S> = {
  state: S;
  effects: GestureEffect[];
};

export type { GestureEffect, PointerInfo };
