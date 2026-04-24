import { DiagramState, DiagramEvent } from './types';

export function applyEvent(state: DiagramState, event: DiagramEvent): DiagramState {
  if (state.processedEventIds[event.id]) {
    return state;
  }

  const markProcessed = (s: DiagramState): DiagramState => ({
    ...s,
    processedEventIds: { ...s.processedEventIds, [event.id]: true },
  });

  switch (event.type) {
    case 'ElementCreated': {
      return markProcessed({
        ...state,
        elements: { ...state.elements, [event.payload.id]: event.payload },
      });
    }

    case 'ElementMoved': {
      const { id, x, y } = event.payload;
      if (!state.elements[id]) return markProcessed(state);
      return markProcessed({
        ...state,
        elements: {
          ...state.elements,
          [id]: { ...state.elements[id], x, y },
        },
      });
    }

    case 'ElementResized': {
      const { id, width, height } = event.payload;
      if (!state.elements[id]) return markProcessed(state);
      return markProcessed({
        ...state,
        elements: {
          ...state.elements,
          [id]: { ...state.elements[id], width, height },
        },
      });
    }

    case 'ElementTextUpdated': {
      const { id, text } = event.payload;
      if (!state.elements[id]) return markProcessed(state);
      return markProcessed({
        ...state,
        elements: {
          ...state.elements,
          [id]: { ...state.elements[id], text },
        },
      });
    }

    case 'ElementDeleted': {
      const { id } = event.payload;
      if (!state.elements[id]) return markProcessed(state);

      const elements = { ...state.elements };
      delete elements[id];

      const arrows = Object.fromEntries(
        Object.entries(state.arrows).filter(
          ([, arrow]) => arrow.fromElementId !== id && arrow.toElementId !== id,
        ),
      );

      return markProcessed({ ...state, elements, arrows });
    }

    case 'ArrowCreated': {
      const arrow = event.payload;
      if (!state.elements[arrow.fromElementId] || !state.elements[arrow.toElementId]) {
        return markProcessed(state);
      }
      return markProcessed({
        ...state,
        arrows: { ...state.arrows, [arrow.id]: arrow },
      });
    }

    case 'ArrowDeleted': {
      const { id } = event.payload;
      if (!state.arrows[id]) return markProcessed(state);
      const arrows = { ...state.arrows };
      delete arrows[id];
      return markProcessed({ ...state, arrows });
    }

    default:
      return markProcessed(state);
  }
}
