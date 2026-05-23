import { useCallback, useRef, useState } from 'react';

import { DEFAULT_VIEWPORT, ZOOM_FACTOR, clampScale, zoomAt } from './viewport';
import type { Vec2, Viewport } from './viewport';

const MIDDLE_BUTTON = 1;

type PanState = {
  startClient: Vec2;
  startOffset: Vec2;
};

type AnyMouseEvent = {
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  currentTarget: { getBoundingClientRect: () => DOMRect };
};

type AnyWheelEvent = {
  deltaY: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
  currentTarget: { getBoundingClientRect: () => DOMRect };
};

export type ViewportController = {
  viewport: Viewport;
  reset: () => void;
  onMouseDown: (event: AnyMouseEvent) => void;
  onMouseMove: (event: AnyMouseEvent) => void;
  onMouseUp: (event: AnyMouseEvent) => void;
  onMouseLeave: (event: AnyMouseEvent) => void;
  onWheel: (event: AnyWheelEvent) => void;
};

export function useViewport(): ViewportController {
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const panRef = useRef<PanState | null>(null);

  const onMouseDown = useCallback((event: AnyMouseEvent) => {
    if (event.button !== MIDDLE_BUTTON) return;
    event.preventDefault();
    panRef.current = {
      startClient: { x: event.clientX, y: event.clientY },
      startOffset: { ...viewportRef.current.offset },
    };
  }, []);

  const onMouseMove = useCallback((event: AnyMouseEvent) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.startClient.x;
    const dy = event.clientY - pan.startClient.y;
    setViewport((current) => ({
      scale: current.scale,
      offset: { x: pan.startOffset.x + dx, y: pan.startOffset.y + dy },
    }));
  }, []);

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const onMouseUp = useCallback(
    (event: AnyMouseEvent) => {
      if (event.button !== MIDDLE_BUTTON) return;
      endPan();
    },
    [endPan],
  );

  const onMouseLeave = useCallback(() => {
    endPan();
  }, [endPan]);

  const onWheel = useCallback((event: AnyWheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (event.deltaY === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const screenPoint: Vec2 = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    setViewport((current) => {
      const nextScale = clampScale(current.scale * factor);
      if (nextScale === current.scale) return current;
      return zoomAt(screenPoint, nextScale, current);
    });
  }, []);

  const reset = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  return { viewport, reset, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onWheel };
}
