import { generateRoomId } from '@/realtime/rooms/roomId';

// ─── Format ──────────────────────────────────────────────────────────────────

describe('generateRoomId: format', () => {
  it('returns a string', () => {
    expect(typeof generateRoomId()).toBe('string');
  });

  it('defaults to 8 characters', () => {
    expect(generateRoomId()).toHaveLength(8);
  });

  it('honors a custom length', () => {
    expect(generateRoomId(4)).toHaveLength(4);
    expect(generateRoomId(12)).toHaveLength(12);
    expect(generateRoomId(32)).toHaveLength(32);
  });

  it('uses only the base62 charset (A-Z, a-z, 0-9)', () => {
    const id = generateRoomId(64);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('every character of every sample is in the base62 charset', () => {
    const allowed = /^[A-Za-z0-9]+$/;
    for (let i = 0; i < 200; i++) {
      const id = generateRoomId();
      expect(id).toMatch(allowed);
    }
  });
});

// ─── Uniqueness ──────────────────────────────────────────────────────────────

describe('generateRoomId: uniqueness', () => {
  it('produces statistically unique ids across many samples', () => {
    // 8-char base62 → 62^8 ≈ 2.18 × 10^14. Collision probability among
    // 5000 samples is roughly 5000^2 / 62^8 ≈ 1.1 × 10^-7. A duplicate
    // here means the entropy source is broken, not bad luck.
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      ids.add(generateRoomId());
    }
    expect(ids.size).toBe(5000);
  });

  it('does not return the same id on consecutive calls', () => {
    const a = generateRoomId();
    const b = generateRoomId();
    expect(a).not.toBe(b);
  });
});
