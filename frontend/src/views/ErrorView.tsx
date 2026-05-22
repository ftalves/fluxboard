import { navigatePush } from '../router';

export type ErrorViewKind =
  | 'not_found'
  | 'room_destroyed'
  | 'create_failed'
  | 'network'
  | 'server_shutdown';

type Copy = { heading: string; message: string };

const COPY: Record<ErrorViewKind, Copy> = {
  not_found: {
    heading: 'Board not found',
    message: 'This board no longer exists or never did. Create a new one to start over.',
  },
  room_destroyed: {
    heading: 'Board ended',
    message: 'The collaboration session is over. Create a new board to keep going.',
  },
  create_failed: {
    heading: "Couldn't create a board",
    message: 'Something went wrong on the server. Try again.',
  },
  network: {
    heading: 'Offline',
    message: "You're not connected to the server. Check your connection and try again.",
  },
  server_shutdown: {
    heading: 'Server restarting',
    message: 'The server is shutting down for maintenance. Try again in a moment.',
  },
};

export type ErrorViewProps = { kind: ErrorViewKind };

export function ErrorView({ kind }: ErrorViewProps) {
  const { heading, message } = COPY[kind];
  return (
    <div role="alert" data-testid="error-view" data-kind={kind}>
      <h1>{heading}</h1>
      <p>{message}</p>
      <button type="button" onClick={() => navigatePush('/')}>
        Create new board
      </button>
    </div>
  );
}

export function NotFoundView() {
  return <ErrorView kind="not_found" />;
}
