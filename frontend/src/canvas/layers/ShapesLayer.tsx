import { Layer } from 'react-konva';
import type { Arrow, DiagramState, Element } from '@fluxboard/domain';

import { SelectionOverlay } from '../SelectionOverlay';
import { ArrowShape } from '../shapes/ArrowShape';
import { Shape } from '../shapes/Shape';
import type { Selection } from './selection';
import type { Viewport } from '../viewport';

export type ShapesLayerProps = {
  diagram: DiagramState;
  selection: Selection;
  textEditingElementId: string | null;
  vp: Viewport;
};

function getEndpoints(diagram: DiagramState, arrow: Arrow): { from: Element; to: Element } | null {
  const from = diagram.elements[arrow.fromElementId];
  const to = diagram.elements[arrow.toElementId];
  if (!from || !to) return null;
  return { from, to };
}

export function ShapesLayer({ diagram, selection, textEditingElementId, vp }: ShapesLayerProps) {
  const selectedElement = selection.kind === 'element' ? diagram.elements[selection.id] : undefined;
  const selectedArrowId = selection.kind === 'arrow' ? selection.id : null;

  return (
    <Layer name="shapes">
      {Object.values(diagram.elements).map((el) => (
        <Shape key={el.id} element={el} vp={vp} textEditingElementId={textEditingElementId} />
      ))}
      {Object.values(diagram.arrows).map((arrow) => {
        const ends = getEndpoints(diagram, arrow);
        if (!ends) return null;
        return (
          <ArrowShape
            key={arrow.id}
            arrow={arrow}
            from={ends.from}
            to={ends.to}
            vp={vp}
            selected={selectedArrowId === arrow.id}
          />
        );
      })}
      {selectedElement && <SelectionOverlay element={selectedElement} vp={vp} />}
    </Layer>
  );
}
