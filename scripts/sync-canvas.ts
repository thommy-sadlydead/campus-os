// Standalone Canvas sync. Run with `npm run canvas:sync`, or wire it up to
// a cron job / scheduled task for recurring syncs — it's idempotent
// (matches on the account plus Canvas's course and assignment ids) so
// running it often is safe.
//
// This is the env-var/CLI path for anyone who prefers it (e.g. a cron job).
// Most users don't need this at all — the in-app "Connect Canvas" page
// (/connect/canvas) does the same sync from a token pasted into the app, with no
// terminal access required. Both paths share the same sync logic
// (src/lib/canvas-sync.ts) so they can't drift apart.
//
// Requires CANVAS_BASE_URL and CANVAS_ACCESS_TOKEN in .env. Optionally set
// SYNC_USER_EMAIL to target a specific user; otherwise it uses the first
// user in the database (fine for a single-user/personal deployment).

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncCanvasForUser } from "../src/lib/canvas-sync";
import type { CanvasConfig } from "../src/lib/canvas";
import { summarizeReport } from "../src/lib/lms/report";

const prisma = new PrismaClient();

async function main() {
  const baseUrl = process.env.CANVAS_BASE_URL;
  const token = process.env.CANVAS_ACCESS_TOKEN;
  if (!baseUrl || !token) {
    console.error(
      "CANVAS_BASE_URL and CANVAS_ACCESS_TOKEN must be set in .env — see .env.example."
    );
    process.exit(1);
  }
  const cfg: CanvasConfig = { baseUrl, token };

  const user = process.env.SYNC_USER_EMAIL
    ? await prisma.user.findUniqueOrThrow({ where: { email: process.env.SYNC_USER_EMAIL } })
    : await prisma.user.findFirstOrThrow();

  console.log(`Syncing Canvas (${baseUrl}) for ${user.email}...`);

  const report = await syncCanvasForUser(prisma, user.id, cfg);

  console.log(summarizeReport(report));
  for (const c of report.classes) {
    console.log(`  ${c.name}: ${c.assignments} assignment(s), ${c.exams} exam(s)${c.problem ? ` — ${c.problem}` : ""}`);
  }
  for (const s of report.skipped) console.log(`  Skipped ${s.name}: ${s.reason}`);
  for (const r of report.reopened) console.log(`  Reopened ${r.className}: ${r.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
