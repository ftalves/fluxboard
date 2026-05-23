import type { Vec2 } from '../../canvas/viewport';
import { DEFAULT_CIRCLE_SIZE, DEFAULT_RECT_SIZE, MIN_SIZE } from '../constants';
import type { GhostShape } from '../effects';
import { creationGeometry } from '../ghost';
import type { GestureContext, GestureEffect, GestureResult, PointerInfo } from './types';

export type ShapeCreateState = {
  creating: { shape: GhostShape; start: Vec2; current: Vec2 } | null;
};

export const initialShapeCreateState: ShapeCreateState = { creating: null };

function defaultsFor(shape: GhostShape): { width: number; height: number } {
  return shape === 'circle' ? DEFAULT_CIRCLE_SIZE : DEFAULT_RECT_SIZE;
}

export function shapePointerDown(
  state: ShapeCreateState,
  _ctx: GestureContext,
  ptr: PointerInfo,
  shape: GhostShape,
): GestureResult<ShapeCreateState> {
  void _ctx;
  if (ptr.button !== 0) return { state, effects: [] };
  return {
    state: { creating: { shape, start: { ...ptr.world }, current: { ...ptr.world } } },
    effects: [],
  };
}

export function shapePointerMove(
  state: ShapeCreateState,
  _ctx: GestureContext,
  ptr: PointerInfo,
): GestureResult<ShapeCreateState> {
  void _ctx;
  if (!state.creating) return { state, effects: [] };
  return {
    state: { creating: { ...state.creating, current: { ...ptr.world } } },
    effects: [],
  };
}

export function shapePointerUp(
  state: ShapeCreateState,
  _ctx: GestureContext,
  ptr: PointerInfo,
): GestureResult<ShapeCreateState> {
  void _ctx;
  if (!state.creating) return { state, effects: [] };
  const { shape, start } = state.creating;
  const current = { ...ptr.world };
  const geom = creationGeometry(start, current, defaultsFor(shape), MIN_SIZE);
  const id = crypto.randomUUID();
  const effects: GestureEffect[] = [
    {
      type: 'submitEvent',
      event: {
        id: '',
        timestamp: 0,
        userId: '',
        type: 'ElementCreated',
        payload: { id, type: shape, x: geom.x, y: geom.y, width: geom.width, height: geom.height },
      },
    },
    { type: 'setSelection', selection: { kind: 'element', id } },
  ];
  return { state: { creating: null }, effects };
}

export function shapePointerCancel(state: ShapeCreateState): GestureResult<ShapeCreateState> {
  if (!state.creating) return { state, effects: [] };
  return { state: { creating: null }, effects: [] };
}
