export type Config = {
  PORT: number;
  GRACE_PERIOD_MS: number;
  ROOM_ID_LENGTH: number;
  JOIN_TIMEOUT_MS: number;
  WS_HEARTBEAT_MS: number;
  MAX_SEED_BYTES: number;
  MAX_WS_MESSAGE_BYTES: number;
};

const DEFAULTS: Config = {
  PORT: 8080,
  GRACE_PERIOD_MS: 30_000,
  ROOM_ID_LENGTH: 8,
  JOIN_TIMEOUT_MS: 5_000,
  WS_HEARTBEAT_MS: 30_000,
  MAX_SEED_BYTES: 1_048_576,
  MAX_WS_MESSAGE_BYTES: 262_144,
};

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result: Config = { ...DEFAULTS };

  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const raw = env[key];
    if (raw === undefined) continue;

    const n = Number(raw);
    const invalidPort = key === 'PORT' && n > 65_535;
    if (!Number.isInteger(n) || n <= 0 || invalidPort) {
      console.error(`[config] ${key}="${raw}" must be a positive integer${key === 'PORT' ? ' ≤ 65535' : ''}`);
      process.exit(1);
      // unreachable — satisfies TypeScript's control-flow analysis
      return result;
    }
    result[key] = n;
  }

  return Object.freeze(result) as Config;
}

export const config: Config = parseConfig(process.env);
