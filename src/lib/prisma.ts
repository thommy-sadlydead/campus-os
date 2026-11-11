import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { CONNECT_TIMEOUT_MS, IDLE_TIMEOUT_MS, POOL_SIZE, runtimeDatabaseUrl } from "@/lib/db-url";
import { withDbRetry } from "@/lib/db-retry";

// Standard Next.js dev-mode singleton so hot reload doesn't open a new
// connection pool on every edit. Queries go through node-postgres with a
// small pool per instance; see src/lib/db-url.ts. Every query is retried
// when the database couldn't be reached at all (src/lib/db-retry.ts).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const pool = new Pool({
    connectionString: runtimeDatabaseUrl(process.env.DATABASE_URL),
    max: POOL_SIZE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    keepAlive: true,
  });
  // An idle connection the server closed reports here; without a listener
  // Node would treat it as an uncaught error. The pool replaces it on the
  // next query.
  pool.on("error", (err) => console.warn("Idle database connection closed:", err.message));
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  // A query extension doesn't change any call's shape, so the client keeps
  // its plain type for the helpers that take a PrismaClient.
  return client.$extends({
    query: {
      $allOperations({ args, query }) {
        return withDbRetry(() => query(args));
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
