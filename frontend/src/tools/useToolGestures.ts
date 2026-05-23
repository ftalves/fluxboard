import { useCallback, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useStore } from 'zustand';

import { ghostGeometry } from './ghost';
import { fluxStore } from '../store/instance';
import { applyEffects } from './applyEffects';
import type { GhostState, HoverTargetState, RubberBandState } from './effects';
import {
  arrowHover,
  arrowPointerCancel,
  arrowPointerDown,
  initialArrowState,
} from './gestures/arrow';
import type { ArrowState } from './gestures/arrow';
import {
  initialSelectState,
  selectPointerDown,
  selectPointerMove,
  selectPointerUp,
} from './gestures/select';
import type { SelectState } from './gestures/select';
import {
  initialShapeCreateState,
  shapePointerCancel,
  shapePointerDown,
  shapePointerMove,
  shapePointerUp,
} from './gestures/shape';
import type { ShapeCreateState } from './gestures/shape';
import { textPointerDown } from './gestures/text';
import type { GestureContext, PointerInfo } from './gestures/types';
import { pointerFromEvent } from './pointer';
import { useTool } from './tool';
import type { Viewport } from '../canvas/viewport';
import type { Element } from '@fluxboard/domain';

export type ToolGestureOverlay = {
  ghost: GhostState | null;
  rubberBand: RubberBandState | null;
  hoverTarget: HoverTargetState | null;
  arrowSourceMarker: Element | null;
};

export type ToolGestureController = {
  overlay: ToolGestureOverlay;
  onMouseDown: (e: unknown) => void;
  onMouseMove: (e: unknown) => void;
  onMouseUp: (e: unknown) => void;
  cancelGesture: () => void;
};

type GestureStateRefs = {
  select: SelectState;
  shape: ShapeCreateState;
  arrow: ArrowState;
};

export type UseToolGesturesOptions = {
  containerRef: RefObject<HTMLElement | null>;
  vp: Viewport;
};

export function useToolGestures({
  containerRef,
  vp,
}: UseToolGesturesOptions): ToolGestureController {
  const { tool } = useTool();
  const diagram = useStore(fluxStore, (s) => s.diagram);
  const selection = useStore(fluxStore, (s) => s.selection);

  const refs = useRef<GestureStateRefs>({
    select: initialSelectState,
    shape: initialShapeCreateState,
    arrow: initialArrowState,
  });

  const [overlay, setOverlay] = useState<ToolGestureOverlay>({
    ghost: null,
    rubberBand: null,
    hoverTarget: null,
    arrowSourceMarker: null,
  });

  const ctx = useMemo<GestureContext>(
    () => ({
      selection,
      elements: diagram.elements,
      arrows: diagram.arrows,
      vp,
    }),
    [selection, diagram.elements, diagram.arrows, vp],
  );

  const isConnected = useCallback(() => fluxStore.getState().connection.kind === 'connected', []);

  const ptrFrom = useCallback(
    (e: unknown): PointerInfo | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return pointerFromEvent(e as never, { left: rect.left, top: rect.top }, vp);
    },
    [containerRef, vp],
  );

  const refreshShapeOverlay = useCallback(() => {
    const creating = refs.current.shape.creating;
    if (!creating) {
      setOverlay((prev) => (prev.ghost === null ? prev : { ...prev, ghost: null }));
      return;
    }
    const geom = ghostGeometry(creating.start, creating.current);
    setOverlay((prev) => ({ ...prev, ghost: { shape: creating.shape, geom } }));
  }, []);

  const refreshArrowOverlay = useCallback(
    (ptr: PointerInfo | null) => {
      const source = refs.current.arrow.sourceId
        ? (fluxStore.getState().diagram.elements[refs.current.arrow.sourceId] ?? null)
        : null;
      if (!source) {
        setOverlay((prev) => {
          if (
            prev.rubberBand === null &&
            prev.hoverTarget === null &&
            prev.arrowSourceMarker === null
          )
            return prev;
          return { ...prev, rubberBand: null, hoverTarget: null, arrowSourceMarker: null };
        });
        return;
      }
      if (!ptr) {
        setOverlay((prev) => ({
          ...prev,
          rubberBand: null,
          hoverTarget: null,
          arrowSourceMarker: source,
        }));
        return;
      }
      const hover = arrowHover(refs.current.arrow, ctx, ptr);
      setOverlay((prev) => ({
        ...prev,
        rubberBand: hover.rubberBand,
        hoverTarget: hover.hoverTarget,
        arrowSourceMarker: source,
      }));
    },
    [ctx],
  );

  const cancelGesture = useCallback(() => {
    const selectCancelled = refs.current.select.dragMove ? { dragMove: null } : refs.current.select;
    refs.current = {
      select: selectCancelled,
      shape: shapePointerCancel(refs.current.shape).state,
      arrow: arrowPointerCancel(refs.current.arrow).state,
    };
    setOverlay({
      ghost: null,
      rubberBand: null,
      hoverTarget: null,
      arrowSourceMarker: null,
    });
  }, []);

  const onMouseDown = useCallback(
    (e: unknown) => {
      if (!isConnected()) return;
      const ptr = ptrFrom(e);
      if (!ptr) return;
      if (ptr.button !== 0) return;
      const now = Date.now();

      if (tool === 'select') {
        const r = selectPointerDown(refs.current.select, ctx, ptr, now);
        refs.current.select = r.state;
        applyEffects(r.effects);
        return;
      }
      if (tool === 'rectangle' || tool === 'circle') {
        const r = shapePointerDown(refs.current.shape, ctx, ptr, tool);
        refs.current.shape = r.state;
        applyEffects(r.effects);
        refreshShapeOverlay();
        return;
      }
      if (tool === 'text') {
        const r = textPointerDown(ctx, ptr);
        applyEffects(r.effects);
        return;
      }
      if (tool === 'arrow') {
        const r = arrowPointerDown(refs.current.arrow, ctx, ptr);
        refs.current.arrow = r.state;
        applyEffects(r.effects);
        refreshArrowOverlay(ptr);
        return;
      }
    },
    [ctx, isConnected, ptrFrom, refreshArrowOverlay, refreshShapeOverlay, tool],
  );

  const onMouseMove = useCallback(
    (e: unknown) => {
      const ptr = ptrFrom(e);
      if (!ptr) return;
      const now = Date.now();

      if (!isConnected()) {
        // cancel any in-progress gesture if connection dropped mid-flight
        if (
          refs.current.select.dragMove ||
          refs.current.shape.creating ||
          refs.current.arrow.sourceId
        ) {
          cancelGesture();
        }
        return;
      }

      if (tool === 'select' && refs.current.select.dragMove) {
        const r = selectPointerMove(refs.current.select, ctx, ptr, now);
        refs.current.select = r.state;
        applyEffects(r.effects);
        return;
      }
      if ((tool === 'rectangle' || tool === 'circle') && refs.current.shape.creating) {
        const r = shapePointerMove(refs.current.shape, ctx, ptr);
        refs.current.shape = r.state;
        refreshShapeOverlay();
        return;
      }
      if (tool === 'arrow' && refs.current.arrow.sourceId) {
        refreshArrowOverlay(ptr);
        return;
      }
    },
    [ctx, cancelGesture, isConnected, ptrFrom, refreshArrowOverlay, refreshShapeOverlay, tool],
  );

  const onMouseUp = useCallback(
    (e: unknown) => {
      if (!isConnected()) return;
      const ptr = ptrFrom(e);
      if (!ptr) return;
      const now = Date.now();

      if (tool === 'select' && refs.current.select.dragMove) {
        const r = selectPointerUp(refs.current.select, ctx, ptr, now);
        refs.current.select = r.state;
        applyEffects(r.effects);
        return;
      }
      if ((tool === 'rectangle' || tool === 'circle') && refs.current.shape.creating) {
        const r = shapePointerUp(refs.current.shape, ctx, ptr);
        refs.current.shape = r.state;
        applyEffects(r.effects);
        refreshShapeOverlay();
        return;
      }
    },
    [ctx, isConnected, ptrFrom, refreshShapeOverlay, tool],
  );

  return { overlay, onMouseDown, onMouseMove, onMouseUp, cancelGesture };
}
