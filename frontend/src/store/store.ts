import { createStore as createVanillaStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { applyEvent } from '@fluxboard/domain';
import type { Arrow, DiagramEvent, DiagramState, Element } from '@fluxboard/domain';

import { loadOrMintUserId } from './identity';

type WireSend = (event: DiagramEvent) => void;

const noopSend: WireSend = () => {};
let wireSend: WireSend = noopSend;

export function setWireBridge(send: WireSend): void {
  wireSend = send;
}

export function resetWireBridgeForTests(): void {
  wireSend = noopSend;
}

export type Selection =
  | { kind: 'none' }
  | { kind: 'element'; id: string }
  | { kind: 'arrow'; id: string };

export type PendingEvent = {
  event: DiagramEvent;
  sentAt: number;
};

export type AckStatus = 'applied' | 'duplicate' | 'rejected';

export type TerminalReason =
  | 'not_found'
  | 'room_destroyed'
  | 'server_shutdown'
  | 'client_bug'
  | 'max_retries'
  | 'network';

export type ConnectionStatus =
  | { kind: 'connecting'; attempt: number }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number; retryAt: number }
  | { kind: 'disconnected_terminal'; reason: TerminalReason };

export type StoreState = {
  userId: string;

  diagram: DiagramState;
  pendingEvents: Record<string, PendingEvent>;
  textEditingElementId: string | null;

  selection: Selection;
  roomId: string | null;
  connection: ConnectionStatus;

  submitEvent: (event: DiagramEvent) => void;
  applyAck: (eventId: string, status: AckStatus) => void;
  applyPeerEvent: (event: DiagramEvent) => void;
  hydrateFromSync: (
    roomId: string,
    state: { elements: Record<string, Element>; arrows: Record<string, Arrow> },
  ) => void;
  setSelection: (s: Selection) => void;
  setConnection: (c: ConnectionStatus) => void;
  beginTextEdit: (id: string) => void;
  endTextEdit: () => void;
};

function rollback(store: StoreApi<StoreState>, event: DiagramEvent): void {
  switch (event.type) {
    case 'ElementCreated':
    case 'ElementMoved':
    case 'ElementResized':
    case 'ElementTextUpdated': {
      const id = event.payload.id;
      store.setState((s) => {
        const elements = { ...s.diagram.elements };
        delete elements[id];
        const arrows = Object.fromEntries(
          Object.entries(s.diagram.arrows).filter(
            ([, a]) => a.fromElementId !== id && a.toElementId !== id,
          ),
        );
        const selection = clearSelectionIfMatches(s.selection, id, 'element', arrows);
        return { diagram: { ...s.diagram, elements, arrows }, selection };
      });
      return;
    }
    case 'ArrowCreated': {
      const id = event.payload.id;
      store.setState((s) => {
        const arrows = { ...s.diagram.arrows };
        delete arrows[id];
        const selection = clearSelectionIfMatches(s.selection, id, 'arrow', arrows);
        return { diagram: { ...s.diagram, arrows }, selection };
      });
      return;
    }
    case 'ElementDeleted':
    case 'ArrowDeleted':
      return;
  }
}

function clearSelectionIfDeleted(sel: Selection, after: DiagramState): Selection {
  if (sel.kind === 'element') {
    return after.elements[sel.id] ? sel : { kind: 'none' };
  }
  if (sel.kind === 'arrow') {
    return after.arrows[sel.id] ? sel : { kind: 'none' };
  }
  return sel;
}

function clearSelectionIfMatches(
  sel: Selection,
  id: string,
  kind: 'element' | 'arrow',
  arrowsAfter: Record<string, Arrow>,
): Selection {
  if (sel.kind === 'element' && kind === 'element' && sel.id === id) return { kind: 'none' };
  if (sel.kind === 'arrow' && kind === 'arrow' && sel.id === id) return { kind: 'none' };
  if (sel.kind === 'arrow' && !arrowsAfter[sel.id]) return { kind: 'none' };
  return sel;
}

export function createFluxStore(): StoreApi<StoreState> {
  const store: StoreApi<StoreState> = createVanillaStore<StoreState>((set, get) => ({
    userId: loadOrMintUserId(),

    diagram: { elements: {}, arrows: {}, processedEventIds: {} },
    pendingEvents: {},
    textEditingElementId: null,

    selection: { kind: 'none' },
    roomId: null,
    connection: { kind: 'connecting', attempt: 0 },

    submitEvent: (event) => {
      const stamped: DiagramEvent = {
        ...event,
        id: event.id && event.id.length > 0 ? event.id : crypto.randomUUID(),
        timestamp: Date.now(),
        userId: get().userId,
      } as DiagramEvent;

      const now = Date.now();
      set((s) => ({
        diagram: applyEvent(s.diagram, stamped),
        pendingEvents: {
          ...s.pendingEvents,
          [stamped.id]: { event: stamped, sentAt: now },
        },
      }));

      wireSend(stamped);
    },

    applyAck: (eventId, status) => {
      const pending = get().pendingEvents[eventId];
      if (!pending) return;

      if (status === 'rejected') {
        rollback(store, pending.event);
      }

      set((s) => {
        const next = { ...s.pendingEvents };
        delete next[eventId];
        return { pendingEvents: next };
      });
    },

    applyPeerEvent: (event) => {
      if (event.type === 'ElementTextUpdated' && get().textEditingElementId === event.payload.id) {
        return;
      }

      set((s) => {
        const nextDiagram = applyEvent(s.diagram, event);
        const nextSelection = clearSelectionIfDeleted(s.selection, nextDiagram);
        return { diagram: nextDiagram, selection: nextSelection };
      });
    },
    hydrateFromSync: (roomId, snapshot) => {
      set({
        roomId,
        diagram: {
          elements: { ...snapshot.elements },
          arrows: { ...snapshot.arrows },
          processedEventIds: {},
        },
        pendingEvents: {},
        selection: { kind: 'none' },
        textEditingElementId: null,
      });
    },
    setSelection: (selection) => set({ selection }),
    setConnection: (connection) => set({ connection }),
    beginTextEdit: (id) => set({ textEditingElementId: id }),
    endTextEdit: () => set({ textEditingElementId: null }),
  }));
  return store;
}
