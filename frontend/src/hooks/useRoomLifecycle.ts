import { useEffect } from 'react';

import { startLifecycle } from '../net/lifecycle';
import { fluxStore } from '../store/instance';

export function useRoomLifecycle(roomId: string): void {
  useEffect(() => {
    const userId = fluxStore.getState().userId;
    const handle = startLifecycle({ roomId, userId, store: fluxStore });
    return () => handle.stop();
  }, [roomId]);
}
