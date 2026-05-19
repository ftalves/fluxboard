import { parseConfig, Config } from '@/config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let exitSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  // Make process.exit throw so tests don't actually exit the Jest process,
  // and so control flow after the call is observable.
  exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe('parseConfig: defaults', () => {
  it('returns all seven defaults when env is empty', () => {
    const cfg = parseConfig({});
    expect(cfg).toEqual<Config>({
      PORT: 8080,
      GRACE_PERIOD_MS: 30_000,
      ROOM_ID_LENGTH: 8,
      JOIN_TIMEOUT_MS: 5_000,
      WS_HEARTBEAT_MS: 30_000,
      MAX_SEED_BYTES: 1_048_576,
      MAX_WS_MESSAGE_BYTES: 262_144,
    });
  });

  it('ignores unknown env vars', () => {
    const cfg = parseConfig({ UNKNOWN_VAR: 'hello', ALSO_UNKNOWN: '999' });
    expect(cfg.PORT).toBe(8080);
  });
});

// ─── Parsing each variable ────────────────────────────────────────────────────

describe('parseConfig: valid values', () => {
  it.each<[keyof Config, string, number]>([
    ['PORT', '3000', 3000],
    ['GRACE_PERIOD_MS', '60000', 60_000],
    ['ROOM_ID_LENGTH', '12', 12],
    ['JOIN_TIMEOUT_MS', '10000', 10_000],
    ['WS_HEARTBEAT_MS', '15000', 15_000],
    ['MAX_SEED_BYTES', '2097152', 2_097_152],
    ['MAX_WS_MESSAGE_BYTES', '524288', 524_288],
  ])('parses %s="%s" as %d', (key, raw, expected) => {
    const cfg = parseConfig({ [key]: raw });
    expect(cfg[key]).toBe(expected);
  });

  it('leaves other defaults untouched when only PORT is set', () => {
    const cfg = parseConfig({ PORT: '9000' });
    expect(cfg.GRACE_PERIOD_MS).toBe(30_000);
    expect(cfg.MAX_SEED_BYTES).toBe(1_048_576);
  });
});

// ─── Validation: non-positive ─────────────────────────────────────────────────

describe('parseConfig: rejects non-positive integers', () => {
  it.each<keyof Config>([
    'PORT',
    'GRACE_PERIOD_MS',
    'ROOM_ID_LENGTH',
    'JOIN_TIMEOUT_MS',
    'WS_HEARTBEAT_MS',
    'MAX_SEED_BYTES',
    'MAX_WS_MESSAGE_BYTES',
  ])('exits 1 when %s is "0"', (key) => {
    expect(() => parseConfig({ [key]: '0' })).toThrow('process.exit(1)');
  });

  it.each<keyof Config>([
    'PORT',
    'GRACE_PERIOD_MS',
    'ROOM_ID_LENGTH',
  ])('exits 1 when %s is "-1"', (key) => {
    expect(() => parseConfig({ [key]: '-1' })).toThrow('process.exit(1)');
  });
});

// ─── Validation: PORT range ───────────────────────────────────────────────────

describe('parseConfig: PORT upper-bound', () => {
  it('accepts PORT=65535', () => {
    const cfg = parseConfig({ PORT: '65535' });
    expect(cfg.PORT).toBe(65_535);
  });

  it('exits 1 when PORT=65536', () => {
    expect(() => parseConfig({ PORT: '65536' })).toThrow('process.exit(1)');
  });

  it('exits 1 when PORT=99999', () => {
    expect(() => parseConfig({ PORT: '99999' })).toThrow('process.exit(1)');
  });
});

// ─── Validation: non-integer ──────────────────────────────────────────────────

describe('parseConfig: rejects non-integer values', () => {
  it('exits 1 for a float', () => {
    expect(() => parseConfig({ PORT: '8080.5' })).toThrow('process.exit(1)');
  });

  it('exits 1 for alphabetic input', () => {
    expect(() => parseConfig({ PORT: 'abc' })).toThrow('process.exit(1)');
  });

  it('exits 1 for an empty string', () => {
    expect(() => parseConfig({ PORT: '' })).toThrow('process.exit(1)');
  });

  it('exits 1 for a number with trailing letters', () => {
    expect(() => parseConfig({ PORT: '8080ms' })).toThrow('process.exit(1)');
  });
});

// ─── Error logging ────────────────────────────────────────────────────────────

describe('parseConfig: error logging', () => {
  it('logs the offending variable name before exiting', () => {
    expect(() => parseConfig({ PORT: 'bad' })).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PORT'));
  });

  it('includes the offending value in the error log', () => {
    expect(() => parseConfig({ GRACE_PERIOD_MS: 'nope' })).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });
});

// ─── Return type ─────────────────────────────────────────────────────────────

describe('parseConfig: return value properties', () => {
  it('returns a frozen object', () => {
    const cfg = parseConfig({});
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
