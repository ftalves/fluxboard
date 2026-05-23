import { screenToWorld } from '../canvas/coords';
import type { Vec2, Viewport } from '../canvas/viewport';
import type { PointerInfo } from './effects';

type RawEvent = {
  clientX?: number;
  clientY?: number;
  button?: number;
  target?: unknown;
  evt?: { clientX: number; clientY: number; button: number };
};

function extractTargetId(target: unknown): string | null {
  if (!target || typeof target !== 'object') return null;

  const idFn = (target as { id?: unknown }).id;
  if (typeof idFn === 'function') {
    const className = (target as { getClassName?: () => string }).getClassName?.();
    if (className === 'Stage') return null;
    const id = (idFn as () => string).call(target);
    return id && id.length > 0 ? id : null;
  }

  const getAttr = (target as { getAttribute?: unknown }).getAttribute;
  if (typeof getAttr === 'function') {
    const konva = (getAttr as (n: string) => string | null).call(target, 'data-konva');
    if (konva === 'Stage') return null;
    const dataId = (getAttr as (n: string) => string | null).call(target, 'data-id');
    return dataId && dataId.length > 0 ? dataId : null;
  }

  return null;
}

export function pointerFromEvent(
  e: RawEvent,
  containerRect: { left: number; top: number },
  vp: Viewport,
): PointerInfo {
  const clientX = e.evt?.clientX ?? e.clientX ?? 0;
  const clientY = e.evt?.clientY ?? e.clientY ?? 0;
  const screen: Vec2 = {
    x: clientX - containerRect.left,
    y: clientY - containerRect.top,
  };
  const world = screenToWorld(screen, vp);
  return {
    button: e.evt?.button ?? e.button ?? 0,
    targetId: extractTargetId(e.target),
    world,
    screen,
  };
}
