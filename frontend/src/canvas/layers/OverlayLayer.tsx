import { Layer, Rect } from 'react-konva';
import type { Element } from '@fluxboard/domain';

import { Ghost } from '../overlays/Ghost';
import type { GhostShape } from '../overlays/Ghost';
import { HoverTarget } from '../overlays/HoverTarget';
import { RubberBand } from '../overlays/RubberBand';
import { rectSelectionProps } from '../shapeProps';
import type { Geometry } from '../shapeProps';
import type { Viewport } from '../viewport';

export type OverlayLayerProps = {
  vp: Viewport;
  ghost?: { shape: GhostShape; geom: Geometry } | null;
  rubberBand?: {
    source: { x: number; y: number };
    cursor: { x: number; y: number };
  } | null;
  hoverTarget?: { element: Element; reject: boolean } | null;
  arrowSourceMarker?: Element | null;
};

export function OverlayLayer({
  vp,
  ghost = null,
  rubberBand = null,
  hoverTarget = null,
  arrowSourceMarker = null,
}: OverlayLayerProps) {
  return (
    <Layer name="overlay">
      {arrowSourceMarker && <Rect {...rectSelectionProps(arrowSourceMarker, vp)} />}
      {hoverTarget && (
        <HoverTarget element={hoverTarget.element} reject={hoverTarget.reject} vp={vp} />
      )}
      {ghost && <Ghost shape={ghost.shape} geom={ghost.geom} vp={vp} />}
      {rubberBand && <RubberBand source={rubberBand.source} cursor={rubberBand.cursor} vp={vp} />}
    </Layer>
  );
}
