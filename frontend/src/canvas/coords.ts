import type Konva from 'konva';

import type { Vec2, Viewport } from './viewport';

export function screenToWorld(screen: Vec2, vp: Viewport): Vec2 {
  return {
    x: (screen.x - vp.offset.x) / vp.scale,
    y: (screen.y - vp.offset.y) / vp.scale,
  };
}

export function worldToScreen(world: Vec2, vp: Viewport): Vec2 {
  return {
    x: world.x * vp.scale + vp.offset.x,
    y: world.y * vp.scale + vp.offset.y,
  };
}

export function stagePointerWorld(stage: Konva.Stage, vp: Viewport): Vec2 | null {
  const pos = stage.getPointerPosition();
  if (!pos) return null;
  return screenToWorld(pos, vp);
}
