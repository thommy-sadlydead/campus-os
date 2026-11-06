// The database URL Prisma Client connects with at runtime.
//
// Every Vercel function instance opens its own connection pool, and Prisma's
// default size (CPU count × 2 + 1) ran Prisma Postgres out of connections
// when five students opened the app at once on Nov 5, 2026 ("too many
// connections for role"). So each instance gets a small pool, and waits a
// little longer for a free connection instead of failing.
//
// Prisma Postgres gives every database two hosts with the same user and
// password: db.prisma.io (direct, a handful of connections) and
// pooled.db.prisma.io (pooled, many more). DATABASE_URL stays on the direct
// host, which the build's schema changes need (scripts/db-push.sh), and the
// app itself runs on the pooled one. That pools by transaction, so Prisma 5
// also needs pgbouncer=true there: prepared statements don't survive from one
// transaction to the next. DATABASE_POOLING=off keeps the app on the direct
// host, in case the pooled one ever misbehaves.

export const POOL_SIZE = "3";
export const POOL_TIMEOUT_SECONDS = "20";
// Prisma's default is 5 s to open a connection; a slow moment on the
// database shouldn't fail a page load (Nov 6, 2026).
export const CONNECT_TIMEOUT_SECONDS = "10";
const DIRECT_HOST = "db.prisma.io";
const POOLED_HOST = "pooled.db.prisma.io";

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
  const params = url.searchParams;
  if (!params.has("connection_limit")) params.set("connection_limit", POOL_SIZE);
  if (!params.has("pool_timeout")) params.set("pool_timeout", POOL_TIMEOUT_SECONDS);
  if (!params.has("connect_timeout")) params.set("connect_timeout", CONNECT_TIMEOUT_SECONDS);
  if (url.hostname === POOLED_HOST && !params.has("pgbouncer")) params.set("pgbouncer", "true");
  return url.toString();
}
