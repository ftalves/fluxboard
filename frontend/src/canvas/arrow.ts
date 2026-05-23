import type { Element } from '@fluxboard/domain';

export type Point = { x: number; y: number };

export type ArrowGeometry = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export function intersectBbox(inside: Point, outside: Point, box: Element): Point {
  const dx = outside.x - inside.x;
  const dy = outside.y - inside.y;
  if (dx === 0 && dy === 0) return { x: inside.x, y: inside.y };

  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const cx = box.x + halfW;
  const cy = box.y + halfH;

  const tx = halfW / Math.abs(dx || 1e-9);
  const ty = halfH / Math.abs(dy || 1e-9);
  const t = Math.min(tx, ty);

  return { x: cx + dx * t, y: cy + dy * t };
}

export function arrowEndpoints(from: Element, to: Element): ArrowGeometry {
  const fromCenter: Point = {
    x: from.x + from.width / 2,
    y: from.y + from.height / 2,
  };
  const toCenter: Point = {
    x: to.x + to.width / 2,
    y: to.y + to.height / 2,
  };
  const start = intersectBbox(fromCenter, toCenter, from);
  const end = intersectBbox(toCenter, fromCenter, to);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
