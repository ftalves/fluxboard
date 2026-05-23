import type { Vec2 } from '../../canvas/viewport';
import { MOVE_THROTTLE_MS } from '../constants';
import { shouldEmit } from '../throttle';
import type { GestureContext, GestureResult } from './types';
import type { GestureEffect, PointerInfo } from './types';

export type SelectState = {
  dragMove: {
    id: string;
    startScreen: Vec2;
    startElementPos: Vec2;
    lastEmittedAt: number | null;
  } | null;
};

export const initialSelectState: SelectState = { dragMove: null };

export function selectPointerDown(
  state: SelectState,
  ctx: GestureContext,
  ptr: PointerInfo,
  _now: number,
): GestureResult<SelectState> {
  void _now;
  if (ptr.button !== 0) return { state, effects: [] };

  const effects: GestureEffect[] = [];
  const targetElement = ptr.targetId ? ctx.elements[ptr.targetId] : undefined;
  if (targetElement) {
    if (ctx.selection.kind !== 'element' || ctx.selection.id !== targetElement.id) {
      effects.push({ type: 'setSelection', selection: { kind: 'element', id: targetElement.id } });
    }
    return {
      state: {
        dragMove: {
          id: targetElement.id,
          startScreen: { ...ptr.screen },
          startElementPos: { x: targetElement.x, y: targetElement.y },
          lastEmittedAt: null,
        },
      },
      effects,
    };
  }

  if (ptr.targetId && ctx.arrows[ptr.targetId]) {
    if (ctx.selection.kind !== 'arrow' || ctx.selection.id !== ptr.targetId) {
      effects.push({ type: 'setSelection', selection: { kind: 'arrow', id: ptr.targetId } });
    }
    return { state: { dragMove: null }, effects };
  }

  // empty canvas
  if (ctx.selection.kind !== 'none') {
    effects.push({ type: 'setSelection', selection: { kind: 'none' } });
  }
  return { state: { dragMove: null }, effects };
}

export function selectPointerMove(
  state: SelectState,
  ctx: GestureContext,
  ptr: PointerInfo,
  now: number,
): GestureResult<SelectState> {
  const drag = state.dragMove;
  if (!drag) return { state, effects: [] };

  const dx = (ptr.screen.x - drag.startScreen.x) / ctx.vp.scale;
  const dy = (ptr.screen.y - drag.startScreen.y) / ctx.vp.scale;
  const nextX = drag.startElementPos.x + dx;
  const nextY = drag.startElementPos.y + dy;

  if (!shouldEmit(now, drag.lastEmittedAt, MOVE_THROTTLE_MS)) {
    return { state, effects: [] };
  }

  return {
    state: { dragMove: { ...drag, lastEmittedAt: now } },
    effects: [
      {
        type: 'submitEvent',
        event: {
          id: '',
          timestamp: 0,
          userId: '',
          type: 'ElementMoved',
          payload: { id: drag.id, x: nextX, y: nextY },
        },
      },
    ],
  };
}

export function selectPointerUp(
  state: SelectState,
  ctx: GestureContext,
  ptr: PointerInfo,
  _now: number,
): GestureResult<SelectState> {
  void _now;
  const drag = state.dragMove;
  if (!drag) return { state, effects: [] };

  const dx = (ptr.screen.x - drag.startScreen.x) / ctx.vp.scale;
  const dy = (ptr.screen.y - drag.startScreen.y) / ctx.vp.scale;
  const finalX = drag.startElementPos.x + dx;
  const finalY = drag.startElementPos.y + dy;

  return {
    state: { dragMove: null },
    effects: [
      {
        type: 'submitEvent',
        event: {
          id: '',
          timestamp: 0,
          userId: '',
          type: 'ElementMoved',
          payload: { id: drag.id, x: finalX, y: finalY },
        },
      },
    ],
  };
}
