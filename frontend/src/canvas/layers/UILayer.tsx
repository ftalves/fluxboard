import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { Layer, Transformer } from 'react-konva';
import type Konva from 'konva';

import { transformerProps } from '../shapeProps';
import type { Selection } from './selection';
import type { Viewport } from '../viewport';

export type UILayerProps = {
  selection: Selection;
  stageRef: RefObject<Konva.Stage | null>;
  vp: Viewport;
};

type TransformerNode = {
  nodes: (nodes: Konva.Node[]) => void;
  getLayer: () => { batchDraw: () => void } | null;
};

function asTransformer(value: unknown): TransformerNode | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TransformerNode>;
  if (typeof candidate.nodes !== 'function') return null;
  return value as TransformerNode;
}

export function UILayer({ selection, stageRef, vp }: UILayerProps) {
  const transformerRef = useRef<Konva.Transformer | null>(null);

  useEffect(() => {
    const transformer = asTransformer(transformerRef.current);
    const stage = stageRef.current;
    if (!transformer) return;
    if (!stage || selection.kind !== 'element') {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    const node = stage.findOne(`#${selection.id}`);
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selection, stageRef]);

  return (
    <Layer name="ui">
      <Transformer ref={transformerRef} {...transformerProps(vp)} />
    </Layer>
  );
}
