// Public on purpose: the uptime check (and anyone) can ask "is Campus OS
// working?" without logging in. It touches the database with a single
// `SELECT 1` and returns only { ok } (see src/lib/health.ts).
import { prisma } from "@/lib/prisma";
import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { ok } = await checkHealth(() => prisma.$queryRaw`SELECT 1`);
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
