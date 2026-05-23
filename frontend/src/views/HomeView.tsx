import { useEffect, useState } from 'react';

import { createRoom } from '../net/wire';
import type { CreateRoomError } from '../net/wire';
import { navigateReplace } from '../router';
import { ErrorView } from './ErrorView';
import type { ErrorViewKind } from './ErrorView';

type Status = { kind: 'loading' } | { kind: 'error'; error: ErrorViewKind };

let inFlight: AbortController | null = null;

function isCreateRoomError(e: unknown): e is CreateRoomError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'kind' in e &&
    ((e as { kind: unknown }).kind === 'create_failed' ||
      (e as { kind: unknown }).kind === 'network')
  );
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export function HomeView() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;

    let cancelled = false;
    void (async () => {
      try {
        const { roomId } = await createRoom({ signal: controller.signal });
        if (cancelled || controller.signal.aborted) return;
        if (inFlight !== controller) return;
        navigateReplace(`/r/${roomId}`);
      } catch (err: unknown) {
        if (cancelled || controller.signal.aborted) return;
        if (isAbortError(err)) return;
        if (isCreateRoomError(err)) {
          setStatus({ kind: 'error', error: err.kind });
          return;
        }
        setStatus({ kind: 'error', error: 'create_failed' });
      } finally {
        if (inFlight === controller) inFlight = null;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (inFlight === controller) inFlight = null;
    };
  }, []);

  if (status.kind === 'error') return <ErrorView kind={status.error} />;
  return (
    <div data-testid="home-loading" role="status" aria-live="polite">
      Creating board…
    </div>
  );
}
