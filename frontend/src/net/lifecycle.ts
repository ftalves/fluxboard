import type { StoreApi } from 'zustand/vanilla';

import { setWireBridge } from '../store/store';
import type { StoreState, TerminalReason } from '../store/store';
import { connect } from './wire';
import type { WireCallbacks, WireHandle } from './wire';

export type LifecycleDeps = {
  roomId: string;
  userId: string;
  store: StoreApi<StoreState>;
  wireConnect?: (roomId: string, userId: string, cb: WireCallbacks) => WireHandle;
};

export type LifecycleHandle = {
  stop: () => void;
};

export const ACK_TIMEOUT_MS = 10_000;
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const MAX_ATTEMPTS = 5;

export function backoffFor(attempt: number): number {
  const i = Math.min(attempt, BACKOFF_MS.length - 1);
  return BACKOFF_MS[i] ?? 30_000;
}

export function startLifecycle(deps: LifecycleDeps): LifecycleHandle {
  const wireConnect = deps.wireConnect ?? connect;
  const ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let attempt = 0;
  let currentHandle: WireHandle | null = null;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let preStagedTerminal: TerminalReason | null = null;
  let ackTimeoutClose = false;
  let stopped = false;

  function clearAckTimer(eventId: string): void {
    const t = ackTimers.get(eventId);
    if (t !== undefined) {
      clearTimeout(t);
      ackTimers.delete(eventId);
    }
  }

  function clearAllAckTimers(): void {
    for (const t of ackTimers.values()) clearTimeout(t);
    ackTimers.clear();
  }

  function clearBackoffTimer(): void {
    if (backoffTimer !== null) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
  }

  function scheduleReconnect(): void {
    const next = attempt + 1;
    if (next >= MAX_ATTEMPTS) {
      transitionTerminal('max_retries');
      return;
    }
    const delay = backoffFor(attempt);
    const retryAt = Date.now() + delay;
    attempt = next;
    deps.store.getState().setConnection({
      kind: 'reconnecting',
      attempt: next,
      retryAt,
    });
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      openSocket();
    }, delay);
  }

  function transitionTerminal(reason: TerminalReason): void {
    clearBackoffTimer();
    clearAllAckTimers();
    currentHandle = null;
    deps.store.getState().setConnection({
      kind: 'disconnected_terminal',
      reason,
    });
  }

  function bridge(event: import('@fluxboard/domain').DiagramEvent): void {
    const handle = currentHandle;
    if (!handle) return;
    handle.send(event);
    const t = setTimeout(() => {
      console.warn('[lifecycle] ack timeout for event', event.id);
      ackTimers.delete(event.id);
      ackTimeoutClose = true;
      handle.close(1000);
    }, ACK_TIMEOUT_MS);
    ackTimers.set(event.id, t);
  }

  const cb: WireCallbacks = {
    onOpen: () => {},
    onSync: ({ roomId: rid, state }) => {
      deps.store.getState().hydrateFromSync(rid, state);
      deps.store.getState().setConnection({ kind: 'connected' });
    },
    onPeerEvent: (event) => {
      deps.store.getState().applyPeerEvent(event);
    },
    onAck: (eventId, status) => {
      clearAckTimer(eventId);
      deps.store.getState().applyAck(eventId, status);
    },
    onError: () => {},
    onRoomDestroyed: (reason) => {
      preStagedTerminal = reason === 'shutdown' ? 'server_shutdown' : 'room_destroyed';
    },
    onClose: ({ code }) => {
      currentHandle = null;
      clearAllAckTimers();
      if (stopped) return;
      if (preStagedTerminal !== null) {
        const r = preStagedTerminal;
        preStagedTerminal = null;
        transitionTerminal(r);
        return;
      }
      if (ackTimeoutClose) {
        ackTimeoutClose = false;
        scheduleReconnect();
        return;
      }
      if (code === 1000) return;
      if (code === 1001) {
        transitionTerminal('server_shutdown');
        return;
      }
      if (code === 4404) {
        transitionTerminal('not_found');
        return;
      }
      if (code === 4408) {
        if (attempt === 0) {
          scheduleReconnect();
        } else {
          transitionTerminal('client_bug');
        }
        return;
      }
      if (code === 1003 || code === 1009) {
        transitionTerminal('client_bug');
        return;
      }
      if (code >= 4000 && code < 5000) {
        transitionTerminal('client_bug');
        return;
      }
      scheduleReconnect();
    },
  };

  function openSocket(): void {
    let handle: WireHandle;
    try {
      handle = wireConnect(deps.roomId, deps.userId, cb);
    } catch (err) {
      console.warn('[lifecycle] wireConnect threw', err);
      transitionTerminal('network');
      return;
    }
    currentHandle = handle;
    deps.store.getState().setConnection({ kind: 'connecting', attempt });
  }

  setWireBridge(bridge);
  openSocket();

  return {
    stop: () => {
      stopped = true;
      clearBackoffTimer();
      clearAllAckTimers();
      if (currentHandle) {
        currentHandle.close(1000);
        currentHandle = null;
      }
    },
  };
}
