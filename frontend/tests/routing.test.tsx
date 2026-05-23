import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/App';
import { ErrorView } from '../src/views/ErrorView';
import { HomeView } from '../src/views/HomeView';
import { navigatePush, navigateReplace, parse, useRoute } from '../src/router';

// Stub the lifecycle hook so RoomView does not open a real WebSocket
// during routing tests. RoomView's connection-driven behavior is covered
// in tests/room-view.test.tsx.
vi.mock('../src/hooks/useRoomLifecycle', () => ({
  useRoomLifecycle: vi.fn(),
}));

function setPath(path: string): void {
  window.history.replaceState(null, '', path);
}

function flushNavigation(): void {
  window.dispatchEvent(new Event('route-change'));
}

beforeEach(() => {
  setPath('/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parse', () => {
  test('"/" → home', () => {
    expect(parse('/')).toEqual({ kind: 'home' });
  });

  test('"" → home', () => {
    expect(parse('')).toEqual({ kind: 'home' });
  });

  test('"/r/abc" → room with roomId', () => {
    expect(parse('/r/abc')).toEqual({ kind: 'room', roomId: 'abc' });
  });

  test('tolerates trailing slash after roomId', () => {
    expect(parse('/r/abc/')).toEqual({ kind: 'room', roomId: 'abc' });
  });

  test('treats further path segments as not_found', () => {
    expect(parse('/r/abc/extra')).toEqual({ kind: 'not_found' });
  });

  test('unrecognized path → not_found', () => {
    expect(parse('/foo')).toEqual({ kind: 'not_found' });
    expect(parse('/r')).toEqual({ kind: 'not_found' });
    expect(parse('/r/')).toEqual({ kind: 'not_found' });
  });

  test('roomId capture is opaque (accepts arbitrary non-slash chars)', () => {
    expect(parse('/r/abc-123_XYZ')).toEqual({ kind: 'room', roomId: 'abc-123_XYZ' });
    expect(parse('/r/%E2%9C%93')).toEqual({ kind: 'room', roomId: '%E2%9C%93' });
  });
});

describe('navigate + useRoute', () => {
  function Probe() {
    const route = useRoute();
    return <div data-testid="probe">{JSON.stringify(route)}</div>;
  }

  test('useRoute returns route derived from window.location.pathname', () => {
    setPath('/r/room-1');
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe(
      JSON.stringify({ kind: 'room', roomId: 'room-1' }),
    );
  });

  test('useRoute updates on popstate', () => {
    setPath('/');
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify({ kind: 'home' }));

    act(() => {
      setPath('/r/room-2');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByTestId('probe').textContent).toBe(
      JSON.stringify({ kind: 'room', roomId: 'room-2' }),
    );
  });

  test('navigateReplace updates the URL via history.replaceState', () => {
    setPath('/');
    const spy = vi.spyOn(window.history, 'replaceState');
    navigateReplace('/r/abc');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/r/abc');
  });

  test('navigateReplace triggers route-change re-render', () => {
    setPath('/');
    render(<Probe />);
    act(() => {
      navigateReplace('/r/abc');
    });
    expect(screen.getByTestId('probe').textContent).toBe(
      JSON.stringify({ kind: 'room', roomId: 'abc' }),
    );
  });

  test('navigatePush updates the URL via history.pushState', () => {
    setPath('/r/abc');
    const spy = vi.spyOn(window.history, 'pushState');
    navigatePush('/');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
  });

  test('navigatePush triggers route-change re-render', () => {
    setPath('/r/abc');
    render(<Probe />);
    act(() => {
      navigatePush('/');
    });
    expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify({ kind: 'home' }));
  });
});

describe('App exhaustive switch', () => {
  test('renders HomeView on "/"', () => {
    setPath('/');
    // Avoid HomeView's POST during this render — mock fetch to never resolve.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<App />);
    // HomeView shows a loading state while POST /rooms is in flight.
    expect(screen.getByTestId('home-loading')).toBeInTheDocument();
  });

  test('renders RoomView with roomId on "/r/:id"', () => {
    setPath('/r/room-xyz');
    render(<App />);
    expect(screen.getByTestId('room-view')).toHaveTextContent('room-xyz');
  });

  test('renders NotFoundView on unrecognized path', () => {
    setPath('/somewhere/else');
    render(<App />);
    expect(screen.getByRole('heading', { name: /board not found/i })).toBeInTheDocument();
  });
});

describe('<HomeView> auto-create flow', () => {
  test('on mount, POSTs /rooms with empty seed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ roomId: 'r-new' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    render(<HomeView />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/rooms$/);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      seed: { elements: {}, arrows: {} },
    });
  });

  test('renders loading state while request is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    setPath('/');
    render(<HomeView />);
    expect(screen.getByTestId('home-loading')).toBeInTheDocument();
  });

  test('on 201 → navigateReplace to /r/:roomId (no extra history entry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ roomId: 'r-new' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    render(<HomeView />);

    await waitFor(() => expect(window.location.pathname).toBe('/r/r-new'));
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  test('on 500 → renders create_failed error view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    render(<HomeView />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /couldn't create a board/i })).toBeInTheDocument(),
    );
  });

  test('on 400 → renders create_failed error view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'bad' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    render(<HomeView />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /couldn't create a board/i })).toBeInTheDocument(),
    );
  });

  test('on 413 → renders create_failed error view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('too large', { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    render(<HomeView />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /couldn't create a board/i })).toBeInTheDocument(),
    );
  });

  test('on network failure → renders network error view', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    render(<HomeView />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /offline/i })).toBeInTheDocument(),
    );
  });

  test('aborts the in-flight request when remounted under StrictMode', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (init.signal) {
            signals.push(init.signal);
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }
          // resolve only the LAST request; earlier ones must be aborted.
          setTimeout(() => {
            if (!init.signal || !init.signal.aborted) {
              resolve(
                new Response(JSON.stringify({ roomId: 'r-strict' }), {
                  status: 201,
                  headers: { 'Content-Type': 'application/json' },
                }),
              );
            }
          }, 0);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    setPath('/');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    render(
      <StrictMode>
        <HomeView />
      </StrictMode>,
    );

    await waitFor(() => expect(window.location.pathname).toBe('/r/r-strict'));
    // Exactly one navigation despite the double-invoke.
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    // The earlier request(s) were aborted.
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('<ErrorView>', () => {
  test('renders the not_found heading', () => {
    render(<ErrorView kind="not_found" />);
    expect(screen.getByRole('heading', { name: /board not found/i })).toBeInTheDocument();
  });

  test('renders the room_destroyed heading', () => {
    render(<ErrorView kind="room_destroyed" />);
    expect(screen.getByRole('heading', { name: /board ended/i })).toBeInTheDocument();
  });

  test('renders the create_failed heading', () => {
    render(<ErrorView kind="create_failed" />);
    expect(screen.getByRole('heading', { name: /couldn't create a board/i })).toBeInTheDocument();
  });

  test('renders the network heading', () => {
    render(<ErrorView kind="network" />);
    expect(screen.getByRole('heading', { name: /offline/i })).toBeInTheDocument();
  });

  test('renders the server_shutdown heading', () => {
    render(<ErrorView kind="server_shutdown" />);
    expect(screen.getByRole('heading', { name: /server restarting/i })).toBeInTheDocument();
  });

  test('"Create new board" button navigates via push to "/"', async () => {
    const user = userEvent.setup();
    setPath('/r/room-was-here');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    render(<ErrorView kind="room_destroyed" />);
    await user.click(screen.getByRole('button', { name: /create new board/i }));

    expect(pushSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });
});

describe('error → create-new round trip via App', () => {
  test('clicking CTA on NotFound mounts HomeView, which starts a new create', async () => {
    const user = userEvent.setup();
    setPath('/unknown');
    // First render: NotFoundView. Then after click, HomeView should POST.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(screen.getByRole('heading', { name: /board not found/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create new board/i }));
    flushNavigation();

    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
