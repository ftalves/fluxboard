import { randomBytes } from 'node:crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates a URL-safe base62 room id (A-Z, a-z, 0-9).
 *
 * @param length character count; defaults to 8 (ROOM_ID_LENGTH).
 * @returns a freshly random id string.
 */
export function generateRoomId(length: number = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARSET[bytes[i] % 62];
  }
  return out;
}
