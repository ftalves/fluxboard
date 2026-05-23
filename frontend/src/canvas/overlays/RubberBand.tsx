import { Line } from 'react-konva';

import { rubberBandProps } from '../shapeProps';
import type { Viewport } from '../viewport';

export type RubberBandProps = {
  source: { x: number; y: number };
  cursor: { x: number; y: number };
  vp: Viewport;
};

export function RubberBand({ source, cursor, vp }: RubberBandProps) {
  return <Line {...rubberBandProps(source, cursor, vp)} />;
}
