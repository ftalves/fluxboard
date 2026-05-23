export type Vec2 = { x: number; y: number };

export type Viewport = {
  scale: number;
  offset: Vec2;
};

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5.0;
export const ZOOM_FACTOR = 1.1;

export const DEFAULT_VIEWPORT: Viewport = {
  scale: 1,
  offset: { x: 0, y: 0 },
};

export function clampScale(scale: number): number {
  if (scale < MIN_SCALE) return MIN_SCALE;
  if (scale > MAX_SCALE) return MAX_SCALE;
  return scale;
}

export function zoomAt(screenPoint: Vec2, nextScale: number, current: Viewport): Viewport {
  const worldX = (screenPoint.x - current.offset.x) / current.scale;
  const worldY = (screenPoint.y - current.offset.y) / current.scale;
  return {
    scale: nextScale,
    offset: {
      x: screenPoint.x - worldX * nextScale,
      y: screenPoint.y - worldY * nextScale,
    },
  };
}
