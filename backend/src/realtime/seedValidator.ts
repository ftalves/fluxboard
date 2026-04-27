import { Seed } from '@/realtime/rooms/roomRegistry';

export type ValidateSeedResult = { valid: true; seed: Seed } | { valid: false; detail: string };

/**
 * Validates an untrusted seed payload submitted via `POST /rooms`.
 *
 * Rules (per [`wire-protocol.md`](backend/specs/wire-protocol.md) §"Seed validation"):
 *  1. Top-level value is a non-null, non-array object with `elements` and
 *     `arrows` fields, both non-null, non-array objects.
 *  2. Every key in `seed.elements` is a non-empty string equal to the
 *     contained element's `id`.
 *  3. Every value in `seed.elements` matches the `Element` shape: `id`
 *     non-empty string; `type` is one of `rectangle | circle | text`;
 *     `x`, `y`, `width`, `height` are finite numbers; optional `text` is
 *     a string when present.
 *  4. Every key in `seed.arrows` is a non-empty string equal to the
 *     contained arrow's `id`.
 *  5. Every value in `seed.arrows` matches the `Arrow` shape: `id`,
 *     `fromElementId`, `toElementId` are all non-empty strings.
 *  6. For every arrow, both `fromElementId` and `toElementId` exist as
 *     keys in `seed.elements`.
 *  7. For every arrow, `fromElementId !== toElementId` — arrows must
 *     connect two distinct elements (matches `applyEvent`'s runtime
 *     rejection of self-referencing `ArrowCreated`).
 *
 * Numeric ranges are NOT validated: negative coordinates and zero/
 * negative dimensions are accepted (matches `apply-event.md`'s "no
 * validation" stance).
 *
 * On the first rule violation, returns `{ valid: false, detail }` with
 * a human-readable description of the failure. On success, returns
 * `{ valid: true, seed }` with the seed re-typed as `Seed`.
 */
export function validateSeed(_input: unknown): ValidateSeedResult {
  throw new Error('validateSeed: not yet implemented');
}
