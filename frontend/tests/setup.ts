import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

vi.mock('react-konva', () => import('./mocks/react-konva'));

function makeMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: makeMemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  // leave the stub in place between tests; beforeEach will reset it
});
