import { useEffect } from 'react';

import { fluxStore } from '../store/instance';
import { deleteEffectsFor } from './gestures/delete';
import { isTextEditTarget, keyToTool } from './keymap';
import { useTool } from './tool';
import { applyEffects } from './applyEffects';

export type UseToolKeyboardOptions = {
  cancelGesture: () => void;
};

export function useToolKeyboard({ cancelGesture }: UseToolKeyboardOptions): void {
  const { setTool } = useTool();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = (e.target as Element | null) ?? null;
      const editing = isTextEditTarget(
        target
          ? {
              tagName: target.tagName,
              isContentEditable: (target as HTMLElement).isContentEditable,
            }
          : null,
      );
      if (editing) return;

      if (e.key === 'Escape') {
        cancelGesture();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const connection = fluxStore.getState().connection;
        if (connection.kind !== 'connected') return;
        const effects = deleteEffectsFor(fluxStore.getState().selection);
        applyEffects(effects);
        return;
      }

      const tool = keyToTool(e.key);
      if (tool) {
        setTool(tool);
        cancelGesture();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelGesture, setTool]);
}
