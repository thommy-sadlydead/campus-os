import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl } from "@/lib/db-url";
import { withDbRetry } from "@/lib/db-retry";

// Standard Next.js dev-mode singleton so hot reload doesn't open a new
// connection pool on every edit. The URL caps each instance's pool; see
// src/lib/db-url.ts. Every query is retried when the database couldn't be
// reached at all (src/lib/db-retry.ts).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const client = new PrismaClient({ datasourceUrl: runtimeDatabaseUrl(process.env.DATABASE_URL) });
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
