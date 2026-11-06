// Retries a database call when the database couldn't be reached at all
// (src/lib/prisma.ts runs every query through this). On Nov 6, 2026 two
// page loads failed with "Can't reach database server" during a few
// seconds' blip while the requests around them worked. Those queries never
// ran, so trying again is safe. Any other error is thrown straight away.

/** Prisma's codes for "never got a connection": can't reach, timed out connecting, connection closed, no free connection in the pool. */
const TRANSIENT_CODES = new Set(["P1001", "P1002", "P1017", "P2024"]);

export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; errorCode?: string; message?: string };
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e.errorCode && TRANSIENT_CODES.has(e.errorCode)) return true;
  // An initialization error has no code when the server can't be reached.
  return e.name === "PrismaClientInitializationError" && /can't reach database server|timed out/i.test(e.message ?? "");
}

export const RETRY_DELAYS_MS = [300, 1000];

export async function withDbRetry<T>(
  run: () => Promise<T>,
  { delays = RETRY_DELAYS_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= delays.length || !isTransientDbError(err)) throw err;
      console.warn(`Database unreachable; retrying (${attempt + 1}/${delays.length})`);
      await sleep(delays[attempt]);
    }
  }
}
