import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl } from "@/lib/db-url";

// Standard Next.js dev-mode singleton so hot reload doesn't open a new
// connection pool on every edit. The URL caps each instance's pool; see
// src/lib/db-url.ts.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: runtimeDatabaseUrl(process.env.DATABASE_URL) });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
