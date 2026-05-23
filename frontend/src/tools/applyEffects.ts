import { fluxStore } from '../store/instance';
import type { GestureEffect } from './effects';

export function applyEffects(effects: GestureEffect[]): void {
  const state = fluxStore.getState();
  for (const effect of effects) {
    switch (effect.type) {
      case 'submitEvent':
        state.submitEvent(effect.event);
        break;
      case 'setSelection':
        state.setSelection(effect.selection);
        break;
      case 'beginTextEdit':
        state.beginTextEdit(effect.id);
        break;
      case 'endTextEdit':
        state.endTextEdit();
        break;
    }
  }
}
