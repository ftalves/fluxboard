import { DEFAULT_TEXT_SIZE } from '../constants';
import type { GestureContext, GestureEffect, GestureResult, PointerInfo } from './types';

export type TextState = Record<string, never>;
export const initialTextState: TextState = {};

export function textPointerDown(ctx: GestureContext, ptr: PointerInfo): GestureResult<TextState> {
  void ctx;
  if (ptr.button !== 0) return { state: initialTextState, effects: [] };
  if (ptr.targetId !== null) return { state: initialTextState, effects: [] };

  const id = crypto.randomUUID();
  const effects: GestureEffect[] = [
    {
      type: 'submitEvent',
      event: {
        id: '',
        timestamp: 0,
        userId: '',
        type: 'ElementCreated',
        payload: {
          id,
          type: 'text',
          x: ptr.world.x,
          y: ptr.world.y,
          width: DEFAULT_TEXT_SIZE.width,
          height: DEFAULT_TEXT_SIZE.height,
          text: '',
        },
      },
    },
    { type: 'setSelection', selection: { kind: 'element', id } },
    { type: 'beginTextEdit', id },
  ];
  return { state: initialTextState, effects };
}
