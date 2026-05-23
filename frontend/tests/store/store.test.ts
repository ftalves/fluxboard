import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { DiagramEvent, Element } from '@fluxboard/domain';

import { USER_ID_KEY, loadOrMintUserId, resetIdentityForTests } from '../../src/store/identity';
import { createFluxStore, resetWireBridgeForTests, setWireBridge } from '../../src/store/store';

const rect = (id: string, overrides: Partial<Element> = {}): Element => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 50,
  height: 30,
  ...overrides,
});

const createdEvent = (el: Element, id = `evt-${el.id}`): DiagramEvent => ({
  id,
  type: 'ElementCreated',
  timestamp: 0,
  userId: 'placeholder',
  payload: el,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('identity', () => {
  beforeEach(() => {
    localStorage.clear();
    resetIdentityForTests();
  });

  test('returns existing value when present in localStorage', () => {
    localStorage.setItem(USER_ID_KEY, 'preexisting-id');
    expect(loadOrMintUserId()).toBe('preexisting-id');
  });

  test('mints a UUID and persists it when key is missing', () => {
    const id = loadOrMintUserId();
    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem(USER_ID_KEY)).toBe(id);
  });

  test('returns the same id across consecutive calls', () => {
    const a = loadOrMintUserId();
    const b = loadOrMintUserId();
    expect(a).toBe(b);
  });

  test('falls back to in-memory id when localStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const id = loadOrMintUserId();
    expect(id).toMatch(UUID_RE);
    spy.mockRestore();
  });

  test('does not throw when localStorage.setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => loadOrMintUserId()).not.toThrow();
    expect(loadOrMintUserId()).toMatch(UUID_RE);
    spy.mockRestore();
  });
});

describe('initial state', () => {
  beforeEach(() => {
    localStorage.clear();
    resetIdentityForTests();
  });

  test('starts with empty diagram, no pending events, no selection, connecting status', () => {
    const s = createFluxStore().getState();
    expect(s.diagram).toEqual({ elements: {}, arrows: {}, processedEventIds: {} });
    expect(s.pendingEvents).toEqual({});
    expect(s.textEditingElementId).toBeNull();
    expect(s.selection).toEqual({ kind: 'none' });
    expect(s.roomId).toBeNull();
    expect(s.connection).toEqual({ kind: 'connecting', attempt: 0 });
  });

  test('userId is a UUID and stable across reads', () => {
    const store = createFluxStore();
    const a = store.getState().userId;
    const b = store.getState().userId;
    expect(a).toMatch(UUID_RE);
    expect(a).toBe(b);
  });
});

describe('submitEvent', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });
  afterEach(() => {
    resetWireBridgeForTests();
  });

  test('applies the event optimistically to local diagram', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1')));
    expect(store.getState().diagram.elements['r1']).toMatchObject({ id: 'r1', x: 0, y: 0 });
  });

  test('records the stamped event in pendingEvents under its id with sentAt', () => {
    const store = createFluxStore();
    const before = Date.now();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    const after = Date.now();
    const pending = store.getState().pendingEvents['evt-1'];
    expect(pending).toBeDefined();
    expect(pending!.event.id).toBe('evt-1');
    expect(pending!.sentAt).toBeGreaterThanOrEqual(before);
    expect(pending!.sentAt).toBeLessThanOrEqual(after);
  });

  test('mints an id when the caller omits one', () => {
    const store = createFluxStore();
    const partial = {
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'placeholder',
      payload: rect('r1'),
    } as unknown as DiagramEvent;
    store.getState().submitEvent(partial);
    const ids = Object.keys(store.getState().pendingEvents);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(UUID_RE);
  });

  test('preserves the caller-supplied id verbatim', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'caller-id-xyz'));
    expect(store.getState().pendingEvents['caller-id-xyz']).toBeDefined();
  });

  test('stamps userId from the store onto the outgoing event', () => {
    const store = createFluxStore();
    const sent = vi.fn();
    setWireBridge(sent);
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0].userId).toBe(store.getState().userId);
  });

  test('stamps a fresh timestamp on the outgoing event', () => {
    const store = createFluxStore();
    const sent = vi.fn();
    setWireBridge(sent);
    const before = Date.now();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    const after = Date.now();
    const stamped = sent.mock.calls[0]?.[0];
    expect(stamped.timestamp).toBeGreaterThanOrEqual(before);
    expect(stamped.timestamp).toBeLessThanOrEqual(after);
  });

  test('forwards the stamped event to the wire bridge', () => {
    const store = createFluxStore();
    const sent = vi.fn();
    setWireBridge(sent);
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({ id: 'evt-1', type: 'ElementCreated' });
  });

  test('two submits in the same tick produce two pending entries', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().submitEvent(createdEvent(rect('r2'), 'evt-2'));
    expect(Object.keys(store.getState().pendingEvents).sort()).toEqual(['evt-1', 'evt-2']);
    expect(Object.keys(store.getState().diagram.elements).sort()).toEqual(['r1', 'r2']);
  });

  test('silently drops the wire send when no bridge is set', () => {
    const store = createFluxStore();
    expect(() => store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'))).not.toThrow();
    // local apply still happens — bridge is fire-and-forget
    expect(store.getState().diagram.elements['r1']).toBeDefined();
    expect(store.getState().pendingEvents['evt-1']).toBeDefined();
  });
});

describe('applyAck', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });

  test('"applied" clears the pending entry and leaves diagram untouched', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    const before = store.getState().diagram;

    store.getState().applyAck('evt-1', 'applied');

    expect(store.getState().pendingEvents['evt-1']).toBeUndefined();
    expect(store.getState().diagram.elements['r1']).toEqual(before.elements['r1']);
  });

  test('"duplicate" clears the pending entry and leaves diagram untouched', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    const before = store.getState().diagram;

    store.getState().applyAck('evt-1', 'duplicate');

    expect(store.getState().pendingEvents['evt-1']).toBeUndefined();
    expect(store.getState().diagram.elements['r1']).toEqual(before.elements['r1']);
  });

  test('"rejected" clears the pending entry', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().applyAck('evt-1', 'rejected');
    expect(store.getState().pendingEvents['evt-1']).toBeUndefined();
  });

  test('unknown eventId is a silent no-op', () => {
    const store = createFluxStore();
    const before = store.getState();
    store.getState().applyAck('does-not-exist', 'applied');
    store.getState().applyAck('does-not-exist', 'duplicate');
    store.getState().applyAck('does-not-exist', 'rejected');
    const after = store.getState();
    expect(after.diagram).toEqual(before.diagram);
    expect(after.pendingEvents).toEqual(before.pendingEvents);
    expect(after.selection).toEqual(before.selection);
  });

  test('clearing one ack leaves other pending entries in place', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().submitEvent(createdEvent(rect('r2'), 'evt-2'));

    store.getState().applyAck('evt-1', 'applied');

    expect(store.getState().pendingEvents['evt-1']).toBeUndefined();
    expect(store.getState().pendingEvents['evt-2']).toBeDefined();
  });
});

describe('rollback (rejected ack)', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });

  const arrowCreated = (
    id: string,
    from: string,
    to: string,
    evtId = `evt-${id}`,
  ): DiagramEvent => ({
    id: evtId,
    type: 'ArrowCreated',
    timestamp: 0,
    userId: 'p',
    payload: { id, fromElementId: from, toElementId: to },
  });

  test('ElementCreated rollback removes the element', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().applyAck('evt-1', 'rejected');
    expect(store.getState().diagram.elements['r1']).toBeUndefined();
  });

  test('ElementCreated rollback cascades arrows that reference the element', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-r1'));
    store.getState().submitEvent(arrowCreated('a1', 'r0', 'r1'));
    store.getState().applyAck('evt-r1', 'rejected');
    expect(store.getState().diagram.elements['r1']).toBeUndefined();
    expect(store.getState().diagram.arrows['a1']).toBeUndefined();
    expect(store.getState().diagram.elements['r0']).toBeDefined();
  });

  test('ElementCreated rollback clears selection that pointed at the element', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.setState({ selection: { kind: 'element', id: 'r1' } });
    store.getState().applyAck('evt-1', 'rejected');
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('ElementCreated rollback clears arrow selection when that arrow cascades', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-r1'));
    store.getState().submitEvent(arrowCreated('a1', 'r0', 'r1'));
    store.setState({ selection: { kind: 'arrow', id: 'a1' } });
    store.getState().applyAck('evt-r1', 'rejected');
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('ElementCreated rollback preserves selection when it points elsewhere', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-r1'));
    store.setState({ selection: { kind: 'element', id: 'r0' } });
    store.getState().applyAck('evt-r1', 'rejected');
    expect(store.getState().selection).toEqual({ kind: 'element', id: 'r0' });
  });

  test('ElementMoved rollback removes the element (zombie)', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().submitEvent({
      id: 'evt-m',
      type: 'ElementMoved',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', x: 99, y: 99 },
    });
    store.getState().applyAck('evt-m', 'rejected');
    expect(store.getState().diagram.elements['r1']).toBeUndefined();
  });

  test('ElementResized rollback removes the element', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().submitEvent({
      id: 'evt-r',
      type: 'ElementResized',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', width: 10, height: 10 },
    });
    store.getState().applyAck('evt-r', 'rejected');
    expect(store.getState().diagram.elements['r1']).toBeUndefined();
  });

  test('ElementTextUpdated rollback removes the element', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent({ ...rect('t1'), type: 'text', text: 'a' }, 'evt-1'));
    store.getState().submitEvent({
      id: 'evt-t',
      type: 'ElementTextUpdated',
      timestamp: 0,
      userId: 'p',
      payload: { id: 't1', text: 'b' },
    });
    store.getState().applyAck('evt-t', 'rejected');
    expect(store.getState().diagram.elements['t1']).toBeUndefined();
  });

  test('ElementDeleted rollback is a no-op', () => {
    const store = createFluxStore();
    store.getState().submitEvent({
      id: 'evt-d',
      type: 'ElementDeleted',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'ghost' },
    });
    const before = store.getState().diagram;
    store.getState().applyAck('evt-d', 'rejected');
    expect(store.getState().diagram.elements).toEqual(before.elements);
    expect(store.getState().diagram.arrows).toEqual(before.arrows);
  });

  test('ArrowCreated rollback removes the arrow', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-r1'));
    store.getState().submitEvent(arrowCreated('a1', 'r0', 'r1'));
    store.getState().applyAck('evt-a1', 'rejected');
    expect(store.getState().diagram.arrows['a1']).toBeUndefined();
    expect(store.getState().diagram.elements['r0']).toBeDefined();
    expect(store.getState().diagram.elements['r1']).toBeDefined();
  });

  test('ArrowCreated rollback clears arrow selection when it matches', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-r1'));
    store.getState().submitEvent(arrowCreated('a1', 'r0', 'r1'));
    store.setState({ selection: { kind: 'arrow', id: 'a1' } });
    store.getState().applyAck('evt-a1', 'rejected');
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('ArrowDeleted rollback is a no-op', () => {
    const store = createFluxStore();
    store.getState().submitEvent({
      id: 'evt-d',
      type: 'ArrowDeleted',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'ghost' },
    });
    const before = store.getState().diagram;
    store.getState().applyAck('evt-d', 'rejected');
    expect(store.getState().diagram.elements).toEqual(before.elements);
    expect(store.getState().diagram.arrows).toEqual(before.arrows);
  });
});

describe('applyPeerEvent', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });

  const peer = {
    elementCreated: (el: Element, id = `peer-${el.id}`): DiagramEvent => ({
      id,
      type: 'ElementCreated',
      timestamp: 0,
      userId: 'peer',
      payload: el,
    }),
    elementMoved: (id: string, x: number, y: number, evtId = `peer-m-${id}`): DiagramEvent => ({
      id: evtId,
      type: 'ElementMoved',
      timestamp: 0,
      userId: 'peer',
      payload: { id, x, y },
    }),
    elementDeleted: (id: string, evtId = `peer-d-${id}`): DiagramEvent => ({
      id: evtId,
      type: 'ElementDeleted',
      timestamp: 0,
      userId: 'peer',
      payload: { id },
    }),
    elementTextUpdated: (id: string, text: string, evtId = `peer-t-${id}`): DiagramEvent => ({
      id: evtId,
      type: 'ElementTextUpdated',
      timestamp: 0,
      userId: 'peer',
      payload: { id, text },
    }),
    arrowCreated: (id: string, from: string, to: string, evtId = `peer-${id}`): DiagramEvent => ({
      id: evtId,
      type: 'ArrowCreated',
      timestamp: 0,
      userId: 'peer',
      payload: { id, fromElementId: from, toElementId: to },
    }),
    arrowDeleted: (id: string, evtId = `peer-d-${id}`): DiagramEvent => ({
      id: evtId,
      type: 'ArrowDeleted',
      timestamp: 0,
      userId: 'peer',
      payload: { id },
    }),
  };

  test('ElementCreated from a peer adds the element', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    expect(store.getState().diagram.elements['r1']).toMatchObject({ id: 'r1' });
  });

  test('ElementMoved from a peer updates coords', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    store.getState().applyPeerEvent(peer.elementMoved('r1', 100, 200));
    expect(store.getState().diagram.elements['r1']).toMatchObject({ x: 100, y: 200 });
  });

  test('ElementDeleted from a peer removes element and cascades arrows', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r0')));
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    store.getState().applyPeerEvent(peer.arrowCreated('a1', 'r0', 'r1'));
    store.getState().applyPeerEvent(peer.elementDeleted('r1'));
    expect(store.getState().diagram.elements['r1']).toBeUndefined();
    expect(store.getState().diagram.arrows['a1']).toBeUndefined();
    expect(store.getState().diagram.elements['r0']).toBeDefined();
  });

  test('ElementDeleted from a peer clears selection that matches', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    store.setState({ selection: { kind: 'element', id: 'r1' } });
    store.getState().applyPeerEvent(peer.elementDeleted('r1'));
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('ElementDeleted from a peer clears arrow selection when arrow cascades', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r0')));
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    store.getState().applyPeerEvent(peer.arrowCreated('a1', 'r0', 'r1'));
    store.setState({ selection: { kind: 'arrow', id: 'a1' } });
    store.getState().applyPeerEvent(peer.elementDeleted('r1'));
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('ArrowDeleted from a peer clears arrow selection that matches', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r0')));
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    store.getState().applyPeerEvent(peer.arrowCreated('a1', 'r0', 'r1'));
    store.setState({ selection: { kind: 'arrow', id: 'a1' } });
    store.getState().applyPeerEvent(peer.arrowDeleted('a1'));
    expect(store.getState().diagram.arrows['a1']).toBeUndefined();
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('peer events preserve element selection when it does not match', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r0')));
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1')));
    store.setState({ selection: { kind: 'element', id: 'r0' } });
    store.getState().applyPeerEvent(peer.elementDeleted('r1'));
    expect(store.getState().selection).toEqual({ kind: 'element', id: 'r0' });
  });

  test('duplicate peer event with same id is a silent no-op', () => {
    const store = createFluxStore();
    store.getState().applyPeerEvent(peer.elementCreated(rect('r1'), 'peer-evt-1'));
    const moveOnce = peer.elementMoved('r1', 50, 60, 'peer-mv-1');
    store.getState().applyPeerEvent(moveOnce);
    const after = store.getState().diagram.elements['r1'];
    store.getState().applyPeerEvent(moveOnce);
    expect(store.getState().diagram.elements['r1']).toEqual(after);
  });

  test('ElementTextUpdated for the in-edit element is suppressed', () => {
    const store = createFluxStore();
    store
      .getState()
      .applyPeerEvent(peer.elementCreated({ ...rect('t1'), type: 'text', text: 'a' }));
    store.setState({ textEditingElementId: 't1' });
    store.getState().applyPeerEvent(peer.elementTextUpdated('t1', 'b'));
    expect(store.getState().diagram.elements['t1']?.text).toBe('a');
  });

  test('ElementTextUpdated for a different element is applied even while another is in edit mode', () => {
    const store = createFluxStore();
    store
      .getState()
      .applyPeerEvent(peer.elementCreated({ ...rect('t1'), type: 'text', text: 'a' }));
    store
      .getState()
      .applyPeerEvent(peer.elementCreated({ ...rect('t2'), type: 'text', text: 'a' }));
    store.setState({ textEditingElementId: 't1' });
    store.getState().applyPeerEvent(peer.elementTextUpdated('t2', 'b'));
    expect(store.getState().diagram.elements['t2']?.text).toBe('b');
  });

  test('peer events do not touch pendingEvents', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'local-1'));
    store.getState().applyPeerEvent(peer.elementCreated(rect('r2'), 'peer-r2'));
    expect(store.getState().pendingEvents['local-1']).toBeDefined();
  });

  test('peer ElementMoved still applies even when the local user is the implied dragger', () => {
    // No special case in applyPeerEvent — last-write-wins applies.
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'local-r1'));
    // local moves submitted but unacked
    store.getState().submitEvent({
      id: 'local-m',
      type: 'ElementMoved',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1', x: 10, y: 10 },
    });
    // peer move arrives
    store.getState().applyPeerEvent(peer.elementMoved('r1', 99, 99, 'peer-m'));
    expect(store.getState().diagram.elements['r1']).toMatchObject({ x: 99, y: 99 });
  });
});

describe('hydrateFromSync', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });

  const snapshot = {
    elements: {
      r1: rect('r1', { x: 5, y: 5 }),
      r2: rect('r2', { x: 80, y: 80 }),
    },
    arrows: {
      a1: { id: 'a1', fromElementId: 'r1', toElementId: 'r2' },
    },
  };

  test('sets roomId from the argument', () => {
    const store = createFluxStore();
    store.getState().hydrateFromSync('room-abc', snapshot);
    expect(store.getState().roomId).toBe('room-abc');
  });

  test('wholesale-replaces diagram.elements and diagram.arrows', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('stale'), 'stale-1'));
    store.getState().hydrateFromSync('room-1', snapshot);
    expect(store.getState().diagram.elements).toEqual(snapshot.elements);
    expect(store.getState().diagram.arrows).toEqual(snapshot.arrows);
    expect(store.getState().diagram.elements['stale']).toBeUndefined();
  });

  test('resets processedEventIds to an empty record', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().hydrateFromSync('room-1', snapshot);
    expect(store.getState().diagram.processedEventIds).toEqual({});
  });

  test('clears pendingEvents', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r0'), 'evt-r0'));
    store.getState().hydrateFromSync('room-1', snapshot);
    expect(store.getState().pendingEvents).toEqual({});
  });

  test('clears selection', () => {
    const store = createFluxStore();
    store.setState({ selection: { kind: 'element', id: 'whatever' } });
    store.getState().hydrateFromSync('room-1', snapshot);
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('clears textEditingElementId', () => {
    const store = createFluxStore();
    store.setState({ textEditingElementId: 'whatever' });
    store.getState().hydrateFromSync('room-1', snapshot);
    expect(store.getState().textEditingElementId).toBeNull();
  });

  test('preserves userId across hydrate', () => {
    const store = createFluxStore();
    const userId = store.getState().userId;
    store.getState().hydrateFromSync('room-1', snapshot);
    expect(store.getState().userId).toBe(userId);
  });

  test('second hydrate replaces the first wholesale', () => {
    const store = createFluxStore();
    store.getState().hydrateFromSync('room-1', snapshot);
    store.getState().hydrateFromSync('room-2', { elements: {}, arrows: {} });
    expect(store.getState().roomId).toBe('room-2');
    expect(store.getState().diagram.elements).toEqual({});
    expect(store.getState().diagram.arrows).toEqual({});
  });
});

describe('setSelection / setConnection / text-edit flag', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });

  test('setSelection stores element selection', () => {
    const store = createFluxStore();
    store.getState().setSelection({ kind: 'element', id: 'r1' });
    expect(store.getState().selection).toEqual({ kind: 'element', id: 'r1' });
  });

  test('setSelection stores arrow selection', () => {
    const store = createFluxStore();
    store.getState().setSelection({ kind: 'arrow', id: 'a1' });
    expect(store.getState().selection).toEqual({ kind: 'arrow', id: 'a1' });
  });

  test('setSelection accepts none to clear', () => {
    const store = createFluxStore();
    store.getState().setSelection({ kind: 'element', id: 'r1' });
    store.getState().setSelection({ kind: 'none' });
    expect(store.getState().selection).toEqual({ kind: 'none' });
  });

  test('setSelection does not auto-clear on submit of ElementDeleted (tool layer is responsible)', () => {
    const store = createFluxStore();
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    store.getState().setSelection({ kind: 'element', id: 'r1' });
    store.getState().submitEvent({
      id: 'evt-d',
      type: 'ElementDeleted',
      timestamp: 0,
      userId: 'p',
      payload: { id: 'r1' },
    });
    // selection is preserved at the store level; tool layer must clear.
    expect(store.getState().selection).toEqual({ kind: 'element', id: 'r1' });
  });

  test('setConnection updates connection status', () => {
    const store = createFluxStore();
    store.getState().setConnection({ kind: 'connected' });
    expect(store.getState().connection).toEqual({ kind: 'connected' });

    store.getState().setConnection({ kind: 'reconnecting', attempt: 2, retryAt: 1234 });
    expect(store.getState().connection).toEqual({
      kind: 'reconnecting',
      attempt: 2,
      retryAt: 1234,
    });

    store.getState().setConnection({ kind: 'disconnected_terminal', reason: 'room_destroyed' });
    expect(store.getState().connection).toEqual({
      kind: 'disconnected_terminal',
      reason: 'room_destroyed',
    });
  });

  test('beginTextEdit sets textEditingElementId', () => {
    const store = createFluxStore();
    store.getState().beginTextEdit('t1');
    expect(store.getState().textEditingElementId).toBe('t1');
  });

  test('beginTextEdit overwrites any prior in-edit element', () => {
    const store = createFluxStore();
    store.getState().beginTextEdit('t1');
    store.getState().beginTextEdit('t2');
    expect(store.getState().textEditingElementId).toBe('t2');
  });

  test('endTextEdit clears textEditingElementId', () => {
    const store = createFluxStore();
    store.getState().beginTextEdit('t1');
    store.getState().endTextEdit();
    expect(store.getState().textEditingElementId).toBeNull();
  });
});

describe('wire bridge', () => {
  beforeEach(() => {
    resetIdentityForTests();
    resetWireBridgeForTests();
  });

  test('setWireBridge replaces the active sender', () => {
    const store = createFluxStore();
    const first = vi.fn();
    const second = vi.fn();
    setWireBridge(first);
    setWireBridge(second);
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('resetWireBridgeForTests restores the no-op sender', () => {
    const store = createFluxStore();
    const sent = vi.fn();
    setWireBridge(sent);
    resetWireBridgeForTests();
    expect(() => store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'))).not.toThrow();
    expect(sent).not.toHaveBeenCalled();
  });

  test('bridge sender receives exactly the stamped event the store applied', () => {
    const store = createFluxStore();
    const sent = vi.fn();
    setWireBridge(sent);
    store.getState().submitEvent(createdEvent(rect('r1'), 'evt-1'));

    const pending = store.getState().pendingEvents['evt-1'];
    expect(pending).toBeDefined();
    expect(sent.mock.calls[0]?.[0]).toEqual(pending!.event);
  });
});
