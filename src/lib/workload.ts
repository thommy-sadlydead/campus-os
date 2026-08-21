import "server-only";
import { prisma } from "@/lib/prisma";
import { startOfTzDay } from "@/lib/time";
import type { WorkItem, WorkStatus } from "@/lib/priority-engine";

/**
 * Loads every open (non-done) assignment/task for a user and flattens them
 * into the priority engine's plain WorkItem shape.
 *
 * Granularity rule: if an assignment has been broken into tasks (phase 3's
 * AI breakdown, or ones the student added by hand), the *tasks* are the
 * actionable units and the parent assignment itself is not also listed
 * (that would double-count the same work). If it has no tasks, the
 * assignment itself is the actionable unit.
 */
export async function loadWorkItemsForUser(userId: string): Promise<WorkItem[]> {
  const [classes, exams] = await Promise.all([
    prisma.class.findMany({
      where: { userId, archived: false },
      include: {
        assignments: {
          include: { tasks: true },
        },
      },
    }),
    prisma.exam.findMany({
      where: { class: { userId } },
      select: { canvasAssignmentId: true },
    }),
  ]);

  const examAssignmentIds = new Set(
    exams.map((e) => e.canvasAssignmentId).filter((id): id is string => !!id)
  );

  const items: WorkItem[] = [];

  for (const cls of classes) {
    for (const assignment of cls.assignments) {
      const isExamLinked = assignment.canvasAssignmentId
        ? examAssignmentIds.has(assignment.canvasAssignmentId)
        : false;

      if (assignment.tasks.length > 0) {
        for (const task of assignment.tasks) {
          if (task.completed) continue;
          items.push({
            id: task.id,
            assignmentId: assignment.id,
            kind: "task",
            title: task.title,
            className: cls.name,
            classColor: cls.color,
            dueAt: assignment.dueAt,
            estimatedMinutes: task.estimatedMinutes,
            pointsPossible: assignment.pointsPossible,
            status: "NOT_STARTED",
            isExamLinked,
          });
        }
        continue;
      }

      if (assignment.status === "SUBMITTED" || assignment.status === "GRADED") continue;
      items.push({
        id: assignment.id,
        assignmentId: assignment.id,
        kind: "assignment",
        title: assignment.name,
        className: cls.name,
        classColor: cls.color,
        dueAt: assignment.dueAt,
        estimatedMinutes: assignment.estimatedMinutes,
        pointsPossible: assignment.pointsPossible,
        status: assignment.status as WorkStatus,
        isExamLinked,
      });
    }
  }

  return items;
}

/**
 * Sum of the user's explicitly-entered free time for today, in minutes.
 * Returns null (not 0) when they haven't logged any blocks for today at
 * all — that's the "we don't know" state, distinct from "you told us you
 * have zero free time today." The dashboard must treat these differently.
 */
export async function getAvailableMinutesToday(
  userId: string,
  now: Date,
  tz: string
): Promise<number | null> {
  const today = startOfTzDay(now, tz);
  const blocks = await prisma.availabilityBlock.findMany({
    where: { userId, date: today },
  });
  if (blocks.length === 0) return null;
  return blocks.reduce((sum, b) => sum + (b.endMinute - b.startMinute), 0);
}
