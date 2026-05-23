import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { RoomView } from '../src/views/RoomView';
import { fluxStore } from '../src/store/instance';

vi.mock('../src/hooks/useRoomLifecycle', () => ({
  useRoomLifecycle: vi.fn(),
}));

import type { ConnectionStatus } from '../src/store/store';

function setConn(c: ConnectionStatus): void {
  act(() => {
    fluxStore.getState().setConnection(c);
  });
}

beforeEach(() => {
  act(() => {
    fluxStore.getState().hydrateFromSync('test-room', { elements: {}, arrows: {} });
    fluxStore.getState().setConnection({ kind: 'connecting', attempt: 0 });
  });
});

afterEach(() => {
  setConn({ kind: 'connecting', attempt: 0 });
});

describe('RoomView connection-driven rendering', () => {
  test('connecting → shows roomId and a Connecting… status', () => {
    setConn({ kind: 'connecting', attempt: 0 });
    render(<RoomView roomId="room-abc" />);
    expect(screen.getByTestId('room-view')).toHaveTextContent('room-abc');
    expect(screen.getByRole('status')).toHaveTextContent(/connecting/i);
  });

  test('connected → roomId shown, no Connecting or Reconnecting banner', () => {
    setConn({ kind: 'connected' });
    render(<RoomView roomId="room-abc" />);
    expect(screen.getByTestId('room-view')).toHaveTextContent('room-abc');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
  });

  test('reconnecting → shows Reconnecting… alert', () => {
    setConn({
      kind: 'reconnecting',
      attempt: 2,
      retryAt: Date.now() + 2000,
    });
    render(<RoomView roomId="room-abc" />);
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});

describe('RoomView terminal → ErrorView mapping', () => {
  const cases: Array<{
    reason:
      | 'not_found'
      | 'room_destroyed'
      | 'server_shutdown'
      | 'client_bug'
      | 'max_retries'
      | 'network';
    heading: RegExp;
  }> = [
    { reason: 'not_found', heading: /board not found/i },
    { reason: 'room_destroyed', heading: /board ended/i },
    { reason: 'server_shutdown', heading: /server restarting/i },
    { reason: 'client_bug', heading: /couldn't create a board/i },
    { reason: 'max_retries', heading: /offline/i },
    { reason: 'network', heading: /offline/i },
  ];

  for (const { reason, heading } of cases) {
    test(`reason "${reason}" → renders ErrorView with matching heading`, () => {
      setConn({ kind: 'disconnected_terminal', reason });
      render(<RoomView roomId="room-abc" />);
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.queryByTestId('room-view')).toBeNull();
    });
  }
});
