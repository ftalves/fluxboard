export type Element = {
  id: string;
  type: 'rectangle' | 'circle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};

export type Arrow = {
  id: string;
  fromElementId: string;
  toElementId: string;
};

export type DiagramState = {
  elements: Record<string, Element>;
  arrows: Record<string, Arrow>;
  processedEventIds: Record<string, true>;
};

type BaseEvent = {
  id: string;
  timestamp: number;
  userId: string;
};

export type ElementCreatedEvent = BaseEvent & {
  type: 'ElementCreated';
  payload: Element;
};

export type ElementMovedEvent = BaseEvent & {
  type: 'ElementMoved';
  payload: { id: string; x: number; y: number };
};

export type ElementResizedEvent = BaseEvent & {
  type: 'ElementResized';
  payload: { id: string; width: number; height: number };
};

export type ElementTextUpdatedEvent = BaseEvent & {
  type: 'ElementTextUpdated';
  payload: { id: string; text: string };
};

export type ElementDeletedEvent = BaseEvent & {
  type: 'ElementDeleted';
  payload: { id: string };
};

export type ArrowCreatedEvent = BaseEvent & {
  type: 'ArrowCreated';
  payload: Arrow;
};

export type ArrowDeletedEvent = BaseEvent & {
  type: 'ArrowDeleted';
  payload: { id: string };
};

export type DiagramEvent =
  | ElementCreatedEvent
  | ElementMovedEvent
  | ElementResizedEvent
  | ElementTextUpdatedEvent
  | ElementDeletedEvent
  | ArrowCreatedEvent
  | ArrowDeletedEvent;
