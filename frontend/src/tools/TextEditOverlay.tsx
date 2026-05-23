import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { STYLE } from '../canvas/style';
import { worldToScreen } from '../canvas/coords';
import type { Viewport } from '../canvas/viewport';
import { fluxStore } from '../store/instance';
import { TEXT_DEBOUNCE_MS } from './constants';

export type TextEditOverlayProps = { vp: Viewport };

export function TextEditOverlay({ vp }: TextEditOverlayProps) {
  const editingId = useStore(fluxStore, (s) => s.textEditingElementId);
  const element = useStore(fluxStore, (s) =>
    s.textEditingElementId ? s.diagram.elements[s.textEditingElementId] : undefined,
  );

  const [text, setText] = useState<string>(element?.text ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    setText(element?.text ?? '');
    pendingRef.current = null;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [editingId, element?.text]);

  if (!editingId || !element) return null;

  const screen = worldToScreen({ x: element.x, y: element.y }, vp);
  const width = element.width * vp.scale;
  const height = element.height * vp.scale;

  function flush(value: string) {
    pendingRef.current = null;
    if (!editingId) return;
    fluxStore.getState().submitEvent({
      id: '',
      timestamp: 0,
      userId: '',
      type: 'ElementTextUpdated',
      payload: { id: editingId, text: value },
    });
  }

  function scheduleEmit(value: string) {
    pendingRef.current = value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (pendingRef.current !== null) flush(pendingRef.current);
    }, TEXT_DEBOUNCE_MS);
  }

  function commit() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingRef.current !== null) flush(pendingRef.current);
    fluxStore.getState().endTextEdit();
  }

  return (
    <textarea
      data-testid="text-edit-overlay"
      value={text}
      autoFocus
      onChange={(e) => {
        setText(e.target.value);
        scheduleEmit(e.target.value);
      }}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
      style={{
        position: 'absolute',
        left: `${screen.x}px`,
        top: `${screen.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        fontFamily: STYLE.fontFamily,
        fontSize: `${STYLE.fontSize * vp.scale}px`,
        color: STYLE.textFill,
        background: 'transparent',
        border: `1px dashed ${STYLE.selectionStroke}`,
        outline: 'none',
        padding: 0,
        margin: 0,
        resize: 'none',
        zIndex: 3,
      }}
    />
  );
}
