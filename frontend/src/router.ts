import { useSyncExternalStore } from 'react';

export type Route = { kind: 'home' } | { kind: 'room'; roomId: string } | { kind: 'not_found' };

const ROUTE_CHANGE_EVENT = 'route-change';

export function parse(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (match && match[1]) return { kind: 'room', roomId: match[1] };
  return { kind: 'not_found' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_CHANGE_EVENT, onChange);
  };
}

function snapshot(): string {
  return window.location.pathname;
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, snapshot, snapshot);
  return parse(pathname);
}

function dispatchRouteChange(): void {
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

export function navigateReplace(path: string): void {
  window.history.replaceState(null, '', path);
  dispatchRouteChange();
}

export function navigatePush(path: string): void {
  window.history.pushState(null, '', path);
  dispatchRouteChange();
}
