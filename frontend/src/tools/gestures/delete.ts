import type { Selection } from '../../store/store';
import type { GestureEffect } from './types';

export function deleteEffectsFor(selection: Selection): GestureEffect[] {
  if (selection.kind === 'element') {
    return [
      {
        type: 'submitEvent',
        event: {
          id: '',
          timestamp: 0,
          userId: '',
          type: 'ElementDeleted',
          payload: { id: selection.id },
        },
      },
      { type: 'setSelection', selection: { kind: 'none' } },
    ];
  }
  if (selection.kind === 'arrow') {
    return [
      {
        type: 'submitEvent',
        event: {
          id: '',
          timestamp: 0,
          userId: '',
          type: 'ArrowDeleted',
          payload: { id: selection.id },
        },
      },
      { type: 'setSelection', selection: { kind: 'none' } },
    ];
  }
  return [];
}
