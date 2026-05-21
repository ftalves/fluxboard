export const USER_ID_KEY = 'fluxboard.userId';

let cached: string | null = null;

function readUserIdFromStorage(): string | null {
  try {
    return localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
}

export function loadOrMintUserId(): string {
  if (cached !== null) return cached;

  const existing = readUserIdFromStorage();
  if (existing && existing.length > 0) {
    cached = existing;
    return existing;
  }

  const fresh = crypto.randomUUID();
  try {
    localStorage.setItem(USER_ID_KEY, fresh);
  } catch {
    // private-browsing or quota: fall back to in-memory cache only
  }
  cached = fresh;
  return fresh;
}

export function resetIdentityForTests(): void {
  cached = null;
}
