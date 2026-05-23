import { useStore } from 'zustand';

import { useRoomLifecycle } from '../hooks/useRoomLifecycle';
import { fluxStore } from '../store/instance';
import type { TerminalReason } from '../store/store';
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

export function RoomView({ roomId }: RoomViewProps) {
  useRoomLifecycle(roomId);
  const connection = useStore(fluxStore, (s) => s.connection);

  if (connection.kind === 'disconnected_terminal') {
    return <ErrorView kind={REASON_TO_KIND[connection.reason]} />;
  }

  return (
    <div data-testid="room-view" data-room-id={roomId} data-connection={connection.kind}>
      Room: {decodeURIComponent(roomId)}
      {connection.kind === 'connecting' && <div role="status">Connecting…</div>}
      {connection.kind === 'reconnecting' && <div role="alert">Reconnecting…</div>}
    </div>
  );
}
