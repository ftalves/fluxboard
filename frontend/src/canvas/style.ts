export const STYLE = {
  // shapes
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,

  // text
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 16,
  textFill: '#111111',

  // selection
  selectionStroke: '#3b82f6',
  selectionStrokeWidth: 2,
  selectionDash: [] as number[],
  transformerAnchorSize: 8,

  // hover target (arrow creation)
  hoverTargetStroke: '#3b82f6',
  hoverTargetStrokeWidth: 3,
  hoverTargetDash: [6, 4],

  // self-arrow rejection
  hoverTargetRejectStroke: '#dc2626',
  hoverTargetRejectDash: [6, 4],

  // ghost (creation in progress)
  ghostStroke: '#3b82f6',
  ghostStrokeWidth: 2,
  ghostDash: [8, 4],

  // arrow geometry
  arrowPointerLength: 10,
  arrowPointerWidth: 10,
  arrowHitStrokeWidth: 20,

  // selected arrow
  selectedArrowStrokeWidth: 4,
} as const;
