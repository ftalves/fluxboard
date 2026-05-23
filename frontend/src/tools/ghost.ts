import type { Geometry } from '../canvas/shapeProps';
import type { Vec2 } from '../canvas/viewport';

export function ghostGeometry(start: Vec2, current: Vec2): Geometry {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function creationGeometry(
  start: Vec2,
  current: Vec2,
  defaults: { width: number; height: number },
  minSize: number,
): Geometry {
  const g = ghostGeometry(start, current);
  if (g.width < minSize && g.height < minSize) {
    return {
      x: start.x - defaults.width / 2,
      y: start.y - defaults.height / 2,
      width: defaults.width,
      height: defaults.height,
    };
  }
  return g;
}
