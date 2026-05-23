export function shouldEmit(now: number, lastEmittedAt: number | null, throttleMs: number): boolean {
  if (lastEmittedAt === null) return true;
  return now - lastEmittedAt >= throttleMs;
}
