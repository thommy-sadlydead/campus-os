// Standalone Canvas sync. Run with `npm run canvas:sync`, or wire it up to
// a cron job / scheduled task for recurring syncs — it's idempotent
// (upserts on canvasCourseId / canvasAssignmentId) so running it often is
// safe.
//
// Requires CANVAS_BASE_URL and CANVAS_ACCESS_TOKEN in .env. Optionally set
// SYNC_USER_EMAIL to target a specific user; otherwise it uses the first
// user in the database (fine for a single-user/personal deployment).

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  fetchActiveCourses,
  fetchCourseAssignments,
  isExamLikeName,
  canvasSubmissionIsDone,
  type CanvasConfig,
} from "../src/lib/canvas";
import { heuristicEstimateMinutes } from "../src/lib/priority-engine";

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

  const courses = await fetchActiveCourses(cfg);
  console.log(`Found ${courses.length} active course(s).`);

  let assignmentCount = 0;
  let examCount = 0;
  let colorIdx = 0;

  for (const course of courses) {
    colorIdx += 1;
    const cls = await prisma.class.upsert({
      where: { canvasCourseId: String(course.id) },
      update: { name: course.name, code: course.course_code },
      create: {
        userId: user.id,
        canvasCourseId: String(course.id),
        name: course.name,
        code: course.course_code,
        color: ((colorIdx - 1) % 8) + 1,
      },
    });

    const assignments = await fetchCourseAssignments(cfg, course.id);
    for (const a of assignments) {
      const canvasAssignmentId = String(a.id);
      const estimatedMinutes = heuristicEstimateMinutes({
        name: a.name,
        pointsPossible: a.points_possible,
        description: a.description,
      });

      const existing = await prisma.assignment.findUnique({ where: { canvasAssignmentId } });
      // Canvas is authoritative once IT says the work is submitted. Short of
      // that, never downgrade a status the student (or a prior sync) already
      // set — e.g. a manual "in progress" or "submitted" mark should stick
      // around even if this particular sync can't yet see it on Canvas's side.
      const status = canvasSubmissionIsDone(a) ? "SUBMITTED" : existing?.status ?? "NOT_STARTED";
      await prisma.assignment.upsert({
        where: { canvasAssignmentId },
        update: {
          name: a.name,
          description: a.description,
          dueAt: a.due_at ? new Date(a.due_at) : null,
          pointsPossible: a.points_possible,
          status,
        },
        create: {
          classId: cls.id,
          canvasAssignmentId,
          name: a.name,
          description: a.description,
          dueAt: a.due_at ? new Date(a.due_at) : null,
          pointsPossible: a.points_possible,
          status: canvasSubmissionIsDone(a) ? "SUBMITTED" : "NOT_STARTED",
          // Heuristic estimate so the dashboard is useful immediately;
          // phase 3's AI breakdown (or the student) can refine it later.
          estimatedMinutes,
        },
      });
      assignmentCount += 1;

      if (isExamLikeName(a.name)) {
        await prisma.exam.upsert({
          where: { canvasAssignmentId },
          update: { name: a.name, examAt: a.due_at ? new Date(a.due_at) : null },
          create: {
            classId: cls.id,
            canvasAssignmentId,
            name: a.name,
            examAt: a.due_at ? new Date(a.due_at) : null,
          },
        });
        examCount += 1;
      }
    }
  }

  console.log(`Synced ${assignmentCount} assignment(s), ${examCount} exam(s) across ${courses.length} course(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
