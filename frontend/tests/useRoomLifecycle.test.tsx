import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useRoomLifecycle } from '../src/hooks/useRoomLifecycle';
import { fluxStore } from '../src/store/instance';
import * as wireModule from '../src/net/wire';

type Sent = {
  roomId: string;
  userId: string;
  cb: wireModule.WireCallbacks;
  closes: number[];
};

let captured: Sent[] = [];

beforeEach(() => {
  captured = [];
  vi.spyOn(wireModule, 'connect').mockImplementation(
    (roomId: string, userId: string, cb: wireModule.WireCallbacks): wireModule.WireHandle => {
      const rec: Sent = { roomId, userId, cb, closes: [] };
      captured.push(rec);
      return {
        send: () => {},
        ping: () => {},
        close: (code) => {
          rec.closes.push(code ?? 1000);
        },
      };
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Probe({ roomId }: { roomId: string }) {
  useRoomLifecycle(roomId);
  return null;
}

describe('useRoomLifecycle', () => {
  test('mount opens a socket via wire.connect with the supplied roomId and store userId', () => {
    render(<Probe roomId="room-xyz" />);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.roomId).toBe('room-xyz');
    expect(captured[0]?.userId).toBe(fluxStore.getState().userId);
  });

  test('unmount closes the socket with 1000', () => {
    const { unmount } = render(<Probe roomId="room-xyz" />);
    expect(captured).toHaveLength(1);
    unmount();
    expect(captured[0]?.closes).toEqual([1000]);
  });
});
