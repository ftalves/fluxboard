import { useRef } from 'react';
import { Stage } from 'react-konva';
import { useStore } from 'zustand';
import type Konva from 'konva';
import type { Element } from '@fluxboard/domain';

import { fluxStore } from '../store/instance';
import { ShapesLayer } from './layers/ShapesLayer';
import { OverlayLayer } from './layers/OverlayLayer';
import type { OverlayLayerProps } from './layers/OverlayLayer';
import { UILayer } from './layers/UILayer';
import { useViewport } from './useViewport';
import type { Viewport } from './viewport';

export type CanvasProps = {
  width: number;
  height: number;
  overlay?: Omit<OverlayLayerProps, 'vp'>;
};

export function Canvas({ width, height, overlay }: CanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const controller = useViewport();
  const vp: Viewport = controller.viewport;

  const diagram = useStore(fluxStore, (s) => s.diagram);
  const selection = useStore(fluxStore, (s) => s.selection);
  const textEditingElementId = useStore(fluxStore, (s) => s.textEditingElementId);

  const hasElements: Element | undefined = Object.values(diagram.elements)[0];

  return (
    <div
      data-testid="canvas-host"
      style={{ position: 'relative', width, height, overflow: 'hidden' }}
      onMouseDown={controller.onMouseDown as never}
      onMouseMove={controller.onMouseMove as never}
      onMouseUp={controller.onMouseUp as never}
      onMouseLeave={controller.onMouseLeave as never}
      onWheel={controller.onWheel as never}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={vp.scale}
        scaleY={vp.scale}
        x={vp.offset.x}
        y={vp.offset.y}
      >
        <ShapesLayer
          diagram={diagram}
          selection={selection}
          textEditingElementId={textEditingElementId}
          vp={vp}
        />
        <OverlayLayer
          vp={vp}
          ghost={overlay?.ghost ?? null}
          rubberBand={overlay?.rubberBand ?? null}
          hoverTarget={overlay?.hoverTarget ?? null}
          arrowSourceMarker={overlay?.arrowSourceMarker ?? null}
        />
        <UILayer selection={selection} stageRef={stageRef} vp={vp} />
      </Stage>
      {!hasElements && (
        <div
          data-testid="empty-hint"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            color: '#6b7280',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 16,
          }}
        >
          Pick a tool to start drawing
        </div>
      )}
    </div>
  );
}
