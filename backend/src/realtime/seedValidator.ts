import { Element, Arrow } from '@fluxboard/domain';
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
const fail = (detail: string): ValidateSeedResult => ({ valid: false, detail });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function validateElement(key: string, raw: unknown): Element | string {
  if (!isObject(raw)) return `element "${key}" must be an object`;
  if (!isNonEmptyString(raw.id)) return `element "${key}".id must be a non-empty string`;
  if (raw.id !== key) return `element key "${key}" does not match id "${String(raw.id)}"`;
  if (raw.type !== 'rectangle' && raw.type !== 'circle' && raw.type !== 'text') {
    return `element "${key}".type must be one of rectangle | circle | text`;
  }
  for (const f of ['x', 'y', 'width', 'height'] as const) {
    if (!isFiniteNumber(raw[f])) {
      return `element "${key}".${f} must be a finite number`;
    }
  }
  if (raw.text !== undefined && typeof raw.text !== 'string') {
    return `element "${key}".text must be a string when present`;
  }
  const el: Element = {
    id: raw.id,
    type: raw.type,
    x: raw.x as number,
    y: raw.y as number,
    width: raw.width as number,
    height: raw.height as number,
  };
  if (typeof raw.text === 'string') el.text = raw.text;
  return el;
}

function validateArrow(
  key: string,
  raw: unknown,
  elements: Record<string, Element>,
): Arrow | string {
  if (!isObject(raw)) return `arrow "${key}" must be an object`;
  if (!isNonEmptyString(raw.id)) return `arrow "${key}".id must be a non-empty string`;
  if (raw.id !== key) return `arrow key "${key}" does not match id "${String(raw.id)}"`;
  if (!isNonEmptyString(raw.fromElementId)) {
    return `arrow "${key}".fromElementId must be a non-empty string`;
  }
  if (!isNonEmptyString(raw.toElementId)) {
    return `arrow "${key}".toElementId must be a non-empty string`;
  }
  if (!elements[raw.fromElementId]) {
    return `arrow "${key}".fromElementId references unknown element "${raw.fromElementId}"`;
  }
  if (!elements[raw.toElementId]) {
    return `arrow "${key}".toElementId references unknown element "${raw.toElementId}"`;
  }
  if (raw.fromElementId === raw.toElementId) {
    return `arrow "${key}" connects an element to itself`;
  }
  return {
    id: raw.id,
    fromElementId: raw.fromElementId,
    toElementId: raw.toElementId,
  };
}

export function validateSeed(input: unknown): ValidateSeedResult {
  if (!isObject(input)) return fail('seed must be a non-null object');
  if (!isObject(input.elements)) return fail('seed.elements must be an object');
  if (!isObject(input.arrows)) return fail('seed.arrows must be an object');

  const elements: Record<string, Element> = {};
  for (const key of Object.keys(input.elements)) {
    if (key.length === 0) return fail('element keys must be non-empty strings');
    const res = validateElement(key, input.elements[key]);
    if (typeof res === 'string') return fail(res);
    elements[key] = res;
  }

  const arrows: Record<string, Arrow> = {};
  for (const key of Object.keys(input.arrows)) {
    if (key.length === 0) return fail('arrow keys must be non-empty strings');
    const res = validateArrow(key, input.arrows[key], elements);
    if (typeof res === 'string') return fail(res);
    arrows[key] = res;
  }

  return { valid: true, seed: { elements, arrows } };
}
