import { randomBytes } from 'node:crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates a URL-safe base62 room id (A-Z, a-z, 0-9).
 *
 * @param length character count; defaults to 8 (ROOM_ID_LENGTH).
 * @returns a freshly random id string.
 */
export function generateRoomId(length: number = 8): string {
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const byte = bytes[i];
      // Rejection sampling: 248 is the largest multiple of 62 below 256,
      // so accepting only byte < 248 keeps the charset distribution uniform.
      if (byte < 248) {
        out += CHARSET[byte % 62];
      }
    }
  }
  return out;
}
