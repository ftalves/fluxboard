import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { Canvas } from '../canvas/Canvas';
import { useRoomLifecycle } from '../hooks/useRoomLifecycle';
import { fluxStore } from '../store/instance';
import type { TerminalReason } from '../store/store';
import { Toolbar } from '../tools/Toolbar';
import { ToolProvider } from '../tools/ToolProvider';
import { ErrorView } from './ErrorView';
import type { ErrorViewKind } from './ErrorView';

export type RoomViewProps = { roomId: string };

const REASON_TO_KIND: Record<TerminalReason, ErrorViewKind> = {
  not_found: 'not_found',
  room_destroyed: 'room_destroyed',
  server_shutdown: 'server_shutdown',
  client_bug: 'create_failed',
  max_retries: 'network',
  network: 'network',
};

function readViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(readViewportSize);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setSize(readViewportSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export function RoomView({ roomId }: RoomViewProps) {
  useRoomLifecycle(roomId);
  const connection = useStore(fluxStore, (s) => s.connection);
  const { width, height } = useWindowSize();

  if (connection.kind === 'disconnected_terminal') {
    return <ErrorView kind={REASON_TO_KIND[connection.reason]} />;
  }

  const disabled = connection.kind !== 'connected';

  return (
    <ToolProvider>
      <div data-testid="room-view" data-room-id={roomId} data-connection={connection.kind}>
        <div data-testid="room-chrome" style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}>
          Room: {decodeURIComponent(roomId)}
          {connection.kind === 'connecting' && <div role="status">Connecting…</div>}
          {connection.kind === 'reconnecting' && <div role="alert">Reconnecting…</div>}
        </div>
        <Toolbar disabled={disabled} />
        <Canvas width={width} height={height} />
      </div>
    </ToolProvider>
  );
}
