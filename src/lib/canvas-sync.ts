// Shared Canvas sync logic — used by both the standalone CLI script
// (scripts/sync-canvas.ts, for cron jobs / anyone who prefers env vars)
// and the in-app "Connect Canvas" / "Sync now" server actions
// (src/app/canvas/actions.ts). One implementation so the two paths can't
// drift apart. Deliberately not "server only" since the CLI script isn't
// part of the Next.js request lifecycle (see the same note in canvas.ts).
//
// Takes a PrismaClient as a parameter rather than importing the app's
// singleton (src/lib/prisma.ts) — the CLI script uses its own short-lived
// client instead of that dev-mode-cached singleton.

import type { PrismaClient } from "@prisma/client";
import {
  fetchActiveCourses,
  fetchCourseAssignments,
  isExamLikeName,
  canvasSubmissionIsDone,
  type CanvasConfig,
} from "./canvas";
import { heuristicEstimateMinutes } from "./priority-engine";

export interface CanvasSyncResult {
  courses: number;
  assignmentsSynced: number;
  examsSynced: number;
}

export async function syncCanvasForUser(
  prisma: PrismaClient,
  userId: string,
  cfg: CanvasConfig
): Promise<CanvasSyncResult> {
  const courses = await fetchActiveCourses(cfg);

  let assignmentCount = 0;
  let examCount = 0;
  let colorIdx = 0;

  for (const course of courses) {
    colorIdx += 1;
    const cls = await prisma.class.upsert({
      where: { canvasCourseId: String(course.id) },
      update: { name: course.name, code: course.course_code },
      create: {
        userId,
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

  return { courses: courses.length, assignmentsSynced: assignmentCount, examsSynced: examCount };
}
