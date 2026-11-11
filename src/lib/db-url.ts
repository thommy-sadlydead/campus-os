// How the app connects to the database at runtime.
//
// Every Vercel function instance opens its own connection pool, and Prisma's
// default size (CPU count × 2 + 1) ran Prisma Postgres out of connections
// when five students opened the app at once on Nov 5, 2026 ("too many
// connections for role"). So each instance gets a small pool, and waits a
// little for a free connection instead of failing.
//
// Prisma Postgres gives every database two hosts with the same user and
// password: db.prisma.io (direct, only 5 connections for the app on the
// Starter plan) and pooled.db.prisma.io (PgBouncer in transaction mode, 100).
// DATABASE_URL stays on the direct host, which the build's schema changes
// need (scripts/db-push.sh), and the app itself runs on the pooled one.
// DATABASE_POOLING=off keeps the app on the direct host, in case the pooled
// one ever misbehaves.
//
// The app reaches it through node-postgres (src/lib/prisma.ts), which sends
// each query in one round trip with an unnamed statement, so nothing it
// prepares has to outlive a transaction. Until Nov 9, 2026 Prisma's own
// engine ran with pgbouncer=true instead, which took about four round trips
// a query: 40-48 ms each from Vercel, against 8 ms now.

export const POOL_SIZE = 3;
// Prisma's default was 5 s to open a connection; a slow moment on the
// database shouldn't fail a page load (Nov 6, 2026). It's also how long a
// query waits for a free connection when all of this instance's are busy.
export const CONNECT_TIMEOUT_MS = 10_000;
// Opening a connection costs several round trips (about 100 ms), so idle
// ones stay open a little while for the student's next tap; half a minute
// covers a pause between pages. (Vercel's attachDatabasePool, which keeps an
// instance awake until they close, can't see the request when node-postgres
// releases a connection here, so it only logged a warning per query; it
// came out on Nov 10, 2026.)
export const IDLE_TIMEOUT_MS = 30_000;

const DIRECT_HOST = "db.prisma.io";
const POOLED_HOST = "pooled.db.prisma.io";
// Prisma engine settings that older DATABASE_URLs carry; node-postgres
// doesn't use them, so they're dropped rather than sent to the server.
const PRISMA_ONLY_PARAMS = ["connection_limit", "pool_timeout", "connect_timeout", "pgbouncer", "schema"];

export function runtimeDatabaseUrl(
  raw: string | undefined,
  { pooling = process.env.DATABASE_POOLING !== "off" }: { pooling?: boolean } = {}
): string | undefined {
  if (!raw) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return raw;
  if (pooling && url.hostname === DIRECT_HOST) url.hostname = POOLED_HOST;
  for (const key of PRISMA_ONLY_PARAMS) url.searchParams.delete(key);
  // node-postgres already checks the certificate and host name for "require"
  // (and "prefer", "verify-ca"), and warns on every cold start that this
  // changes in pg 9. Saying verify-full keeps today's check without the warning.
  if (["require", "prefer", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "")) url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
