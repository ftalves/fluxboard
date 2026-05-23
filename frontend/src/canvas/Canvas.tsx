import { useMemo, useRef } from 'react';
import { Stage } from 'react-konva';
import { useStore } from 'zustand';
import type Konva from 'konva';
import type { Element } from '@fluxboard/domain';

import { fluxStore } from '../store/instance';
import { TextEditOverlay } from '../tools/TextEditOverlay';
import { useTool } from '../tools/tool';
import { useToolGestures } from '../tools/useToolGestures';
import { useToolKeyboard } from '../tools/useToolKeyboard';
import { ShapesLayer } from './layers/ShapesLayer';
import { OverlayLayer } from './layers/OverlayLayer';
import { UILayer } from './layers/UILayer';
import { useViewport } from './useViewport';

const CURSOR_BY_TOOL: Record<string, string> = {
  select: 'default',
  rectangle: 'crosshair',
  circle: 'crosshair',
  text: 'text',
  arrow: 'crosshair',
};

export type CanvasProps = {
  width: number;
  height: number;
};

export function Canvas({ width, height }: CanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { tool } = useTool();
  const controller = useViewport();
  const vp = controller.viewport;

  const diagram = useStore(fluxStore, (s) => s.diagram);
  const selection = useStore(fluxStore, (s) => s.selection);
  const textEditingElementId = useStore(fluxStore, (s) => s.textEditingElementId);

  const gestures = useToolGestures({ containerRef, vp });
  useToolKeyboard({ cancelGesture: gestures.cancelGesture });

  const hasElements: Element | undefined = Object.values(diagram.elements)[0];

  const cursor = useMemo(() => CURSOR_BY_TOOL[tool] ?? 'default', [tool]);

  return (
    <div
      ref={containerRef}
      data-testid="canvas-host"
      data-tool={tool}
      style={{ position: 'relative', width, height, overflow: 'hidden', cursor }}
      onMouseDown={controller.onMouseDown}
      onMouseMove={controller.onMouseMove}
      onMouseUp={controller.onMouseUp}
      onMouseLeave={controller.onMouseLeave}
      onWheel={controller.onWheel}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={vp.scale}
        scaleY={vp.scale}
        x={vp.offset.x}
        y={vp.offset.y}
        onMouseDown={gestures.onMouseDown}
        onMouseMove={gestures.onMouseMove}
        onMouseUp={gestures.onMouseUp}
      >
        <ShapesLayer
          diagram={diagram}
          selection={selection}
          textEditingElementId={textEditingElementId}
          vp={vp}
        />
        <OverlayLayer
          vp={vp}
          ghost={gestures.overlay.ghost}
          rubberBand={gestures.overlay.rubberBand}
          hoverTarget={gestures.overlay.hoverTarget}
          arrowSourceMarker={gestures.overlay.arrowSourceMarker}
        />
        <UILayer selection={selection} stageRef={stageRef} vp={vp} />
      </Stage>
      <TextEditOverlay vp={vp} />
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
