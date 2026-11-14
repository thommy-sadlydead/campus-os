// Can the app do its basic job right now? The uptime check
// (.github/workflows/uptime.yml) calls /api/health every ten minutes and
// opens an issue when it stops answering, so this has to be honest: it asks
// the database for one row, and says "not ok" when that fails or takes
// longer than the timeout. It reports only ok / not ok, never the error
// (which could name the database or its user), because the route is public.

export const HEALTH_TIMEOUT_MS = 8000;

export async function checkHealth(
  ping: () => Promise<unknown>,
  timeoutMs: number = HEALTH_TIMEOUT_MS
): Promise<{ ok: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    await Promise.race([ping(), timeout]);
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
