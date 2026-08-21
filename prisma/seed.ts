// Seeds a demo user with real Fall 2026 Cedarville course/assignment data
// (the same snapshot the Fall Ledger artifact used) so the app is useful
// to explore immediately, without needing Canvas credentials first. Once
// you have a Canvas token, `npm run canvas:sync` takes over as the live
// source of truth for the same classes (matched by canvasCourseId, so it
// updates these rows rather than duplicating them).
//
// Deliberately does NOT seed any AvailabilityBlock rows — "today's free
// time" must come from the student, never be invented — so the demo
// dashboard also shows the honest "not tracked yet" state for that stat.

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { heuristicEstimateMinutes } from "../src/lib/priority-engine";
import { isExamLikeName } from "../src/lib/canvas";

const prisma = new PrismaClient();

const DEMO_EMAIL = "student@example.com";
const DEMO_PASSWORD = "campusos-demo";

const COURSES: Record<string, { name: string; canvasCourseId: string; color: number }> = {
  "ENG-1400-06": { name: "Composition", canvasCourseId: "29642", color: 1 },
  "ENG-0900-02": { name: "Composition Workshop", canvasCourseId: "29583", color: 2 },
  "ACCT-3110-01": { name: "Intermediate Financial Accounting I", canvasCourseId: "29086", color: 3 },
  "ECON-2330-03": { name: "Microeconomics", canvasCourseId: "29448", color: 4 },
  "BTGE-2730-02": { name: "Old Testament Literature", canvasCourseId: "29264", color: 5 },
  "BUS-2150-01": { name: "Statistics for Business", canvasCourseId: "29285", color: 6 },
};

type Row = [string, string, string | null, number | null, 0 | 1, number, number];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash, name: "Demo Student" },
  });

  const classByCode: Record<string, { id: string }> = {};
  for (const [code, info] of Object.entries(COURSES)) {
    const cls = await prisma.class.upsert({
      where: { canvasCourseId: info.canvasCourseId },
      update: { name: info.name, code },
      create: {
        userId: user.id,
        code,
        name: info.name,
        canvasCourseId: info.canvasCourseId,
        color: info.color,
      },
    });
    classByCode[code] = cls;

    // One starter note section per class so the notes UI has somewhere to
    // land. Re-running the seed shouldn't create duplicates.
    const existingSection = await prisma.noteSection.findFirst({
      where: { classId: cls.id, name: "General" },
    });
    if (!existingSection) {
      await prisma.noteSection.create({ data: { classId: cls.id, name: "General", order: 0 } });
    }
  }

  const dataPath = path.join(__dirname, "seed-data", "cedarville-fall-2026.json");
  const rows: Row[] = JSON.parse(readFileSync(dataPath, "utf8"));

  let assignmentCount = 0;
  let examCount = 0;

  for (const [code, name, dueAtIso, points, submittedFlag, , assignmentId] of rows) {
    const cls = classByCode[code];
    if (!cls) continue;

    const canvasAssignmentId = String(assignmentId);
    const estimatedMinutes = heuristicEstimateMinutes({ name, pointsPossible: points });

    await prisma.assignment.upsert({
      where: { canvasAssignmentId },
      update: {},
      create: {
        classId: cls.id,
        canvasAssignmentId,
        name,
        dueAt: dueAtIso ? new Date(dueAtIso) : null,
        pointsPossible: points,
        status: submittedFlag === 1 ? "SUBMITTED" : "NOT_STARTED",
        estimatedMinutes,
      },
    });
    assignmentCount += 1;

    if (isExamLikeName(name)) {
      await prisma.exam.upsert({
        where: { canvasAssignmentId },
        update: {},
        create: {
          classId: cls.id,
          canvasAssignmentId,
          name,
          examAt: dueAtIso ? new Date(dueAtIso) : null,
        },
      });
      examCount += 1;
    }
  }

  console.log("Seed complete.");
  console.log(`  User:        ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Classes:     ${Object.keys(COURSES).length}`);
  console.log(`  Assignments: ${assignmentCount}`);
  console.log(`  Exams:       ${examCount}`);
  console.log("  Change the demo password after first login.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
