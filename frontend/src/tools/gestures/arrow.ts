import type { Element } from '@fluxboard/domain';

import type { HoverTargetState, RubberBandState } from '../effects';
import type { GestureContext, GestureEffect, GestureResult, PointerInfo } from './types';

export type ArrowState = { sourceId: string | null };
export const initialArrowState: ArrowState = { sourceId: null };

function centerOf(el: Element): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

export function arrowPointerDown(
  state: ArrowState,
  ctx: GestureContext,
  ptr: PointerInfo,
): GestureResult<ArrowState> {
  if (ptr.button !== 0) return { state, effects: [] };

  if (state.sourceId === null) {
    if (ptr.targetId && ctx.elements[ptr.targetId]) {
      return { state: { sourceId: ptr.targetId }, effects: [] };
    }
    return { state, effects: [] };
  }

  // target phase
  if (ptr.targetId === null) {
    return { state: { sourceId: null }, effects: [] };
  }
  if (ptr.targetId === state.sourceId) {
    return { state, effects: [] }; // self-arrow rejected; source retained
  }
  if (!ctx.elements[ptr.targetId]) {
    return { state, effects: [] };
  }

  const effects: GestureEffect[] = [
    {
      type: 'submitEvent',
      event: {
        id: '',
        timestamp: 0,
        userId: '',
        type: 'ArrowCreated',
        payload: {
          id: crypto.randomUUID(),
          fromElementId: state.sourceId,
          toElementId: ptr.targetId,
        },
      },
    },
  ];
  return { state: { sourceId: null }, effects };
}

export type ArrowHoverResult = {
  rubberBand: RubberBandState | null;
  hoverTarget: HoverTargetState | null;
};

export function arrowHover(
  state: ArrowState,
  ctx: GestureContext,
  ptr: PointerInfo,
): ArrowHoverResult {
  if (state.sourceId === null) return { rubberBand: null, hoverTarget: null };
  const source = ctx.elements[state.sourceId];
  if (!source) return { rubberBand: null, hoverTarget: null };

  const rubberBand: RubberBandState = {
    source: centerOf(source),
    cursor: { ...ptr.world },
  };
  let hoverTarget: HoverTargetState | null = null;
  const hoveredElement = ptr.targetId ? ctx.elements[ptr.targetId] : undefined;
  if (hoveredElement) {
    hoverTarget = {
      element: hoveredElement,
      reject: hoveredElement.id === state.sourceId,
    };
  }
  return { rubberBand, hoverTarget };
}

export function arrowPointerCancel(state: ArrowState): GestureResult<ArrowState> {
  if (state.sourceId === null) return { state, effects: [] };
  return { state: { sourceId: null }, effects: [] };
}
