// Writes what an LMS reported into the student's own classes, assignments
// and exams. Every provider's sync (Canvas, Schoology, the Brightspace and
// Blackboard calendar feeds) turns its data into LmsCourseInput and calls
// applyLmsCourses, so they all follow the same rules:
//
// - Identity is per account: (user, provider, course id) for a class and
//   (class, item id) for an assignment or exam. Classmates get their own
//   rows for a shared course; one student's sync never touches another's.
// - One course failing doesn't stop the rest. Each course is written on its
//   own, and a course whose assignments couldn't be loaded keeps the ones
//   already stored (assignments: null) rather than losing them.
// - Nothing the LMS stops listing is deleted, and a student's own marks
//   stick unless the LMS knows better (src/lib/lms/status.ts).
// - Rows are only written when something changed.
//
// Takes a PrismaClient rather than importing the app's singleton, so the
// CLI script (scripts/sync-canvas.ts) can use it too.

import type { PrismaClient } from "@prisma/client";
import { heuristicEstimateMinutes } from "@/lib/priority-engine";
import { decideAssignmentStatus, type LmsSubmission } from "@/lib/lms/status";
import type { LmsProvider } from "@/lib/lms/providers";
import type { ClassSyncResult } from "@/lib/lms/report";

export interface LmsAssignmentInput {
  /** The LMS's id for it, unique within the course. */
  id: string;
  name: string;
  /** Directions, as HTML or plain text. */
  description: string | null;
  dueAt: Date | null;
  pointsPossible: number | null;
  /** Its page in the LMS. */
  url: string | null;
  /** What the LMS says about the student's own submission; null when it doesn't say. */
  submission: LmsSubmission | null;
  /** Whether the LMS takes submissions for it (see decideAssignmentStatus). */
  tracksSubmissions: boolean;
  /** Also list it on the Exams tab. */
  isExam: boolean;
}

/** An exam the LMS lists apart from any assignment (a calendar event). */
export interface LmsExamInput {
  /** Prefixed so it can't collide with an assignment id, e.g. "event:123". */
  id: string;
  name: string;
  examAt: Date | null;
  location: string | null;
  url: string | null;
}

export interface LmsCourseInput {
  id: string;
  name: string;
  code: string;
  /** Null when they couldn't be loaded this time: what's stored is kept. */
  assignments: LmsAssignmentInput[] | null;
  exams: LmsExamInput[];
  /** Why assignments couldn't be loaded, for the sync report. */
  problem: string | null;
}

export interface ApplyResult {
  classes: ClassSyncResult[];
  reopened: { className: string; name: string }[];
}

const COLORS = 8;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

function sameTime(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/** Later entries with the same id are dropped (a calendar feed can list one event twice). */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/** Gives each new class the color the account uses least, so classes stay easy to tell apart. */
async function colorPicker(prisma: PrismaClient, userId: string): Promise<() => number> {
  const used = await prisma.class.findMany({ where: { userId, archived: false }, select: { color: true } });
  const counts = Array.from({ length: COLORS }, (_, i) => used.filter((c) => c.color === i + 1).length);
  return () => {
    const index = counts.indexOf(Math.min(...counts));
    counts[index] += 1;
    return index + 1;
  };
}

export async function applyLmsCourses(
  prisma: PrismaClient,
  userId: string,
  provider: LmsProvider,
  courses: LmsCourseInput[],
  now: Date
): Promise<ApplyResult> {
  const result: ApplyResult = { classes: [], reopened: [] };
  const nextColor = await colorPicker(prisma, userId);

  for (const course of uniqueById(courses)) {
    const classResult: ClassSyncResult = {
      name: course.name,
      assignments: course.assignments?.length ?? 0,
      newAssignments: 0,
      exams: 0,
      ...(course.problem ? { problem: course.problem } : {}),
    };
    try {
      const cls = await findOrCreateClass(prisma, userId, provider, course, nextColor);
      if (course.assignments) {
        const { created, reopened } = await applyAssignments(prisma, cls.id, course.assignments, now);
        classResult.newAssignments = created;
        result.reopened.push(...reopened.map((name) => ({ className: cls.name, name })));
      }
      classResult.exams = await applyExams(prisma, cls.id, course);
    } catch (err) {
      console.error(`LMS sync (${provider}) couldn't save course ${course.id} for user ${userId}:`, err);
      classResult.problem = "Campus OS couldn't save this class. Sync again to retry.";
    }
    result.classes.push(classResult);
  }
  return result;
}

async function findOrCreateClass(
  prisma: PrismaClient,
  userId: string,
  provider: LmsProvider,
  course: LmsCourseInput,
  nextColor: () => number
) {
  const where = { userId_lmsProvider_lmsCourseId: { userId, lmsProvider: provider, lmsCourseId: course.id } };
  const existing = await prisma.class.findUnique({ where });
  if (existing) {
    if (existing.name === course.name && existing.code === course.code) return existing;
    return prisma.class.update({ where: { id: existing.id }, data: { name: course.name, code: course.code } });
  }
  try {
    return await prisma.class.create({
      data: { userId, lmsProvider: provider, lmsCourseId: course.id, name: course.name, code: course.code, color: nextColor() },
    });
  } catch (err) {
    // Another sync for this account (a double-click) created it a moment ago.
    if (!isUniqueViolation(err)) throw err;
    return prisma.class.findUniqueOrThrow({ where });
  }
}

async function applyAssignments(
  prisma: PrismaClient,
  classId: string,
  assignments: LmsAssignmentInput[],
  now: Date
): Promise<{ created: number; reopened: string[] }> {
  const stored = await prisma.assignment.findMany({
    where: { classId, lmsItemId: { not: null } },
    select: {
      id: true,
      lmsItemId: true,
      name: true,
      description: true,
      dueAt: true,
      pointsPossible: true,
      lmsUrl: true,
      status: true,
      lmsSubmission: true,
    },
  });
  const byItem = new Map(stored.map((a) => [a.lmsItemId as string, a]));
  let created = 0;
  const reopened: string[] = [];

  for (const input of uniqueById(assignments)) {
    const existing = byItem.get(input.id) ?? null;
    const decision = decideAssignmentStatus({
      existing,
      reported: input.submission,
      tracksSubmissions: input.tracksSubmissions,
      dueAt: input.dueAt,
      now,
    });

    if (!existing) {
      try {
        await prisma.assignment.create({
          data: {
            classId,
            lmsItemId: input.id,
            lmsUrl: input.url,
            lmsSubmission: decision.lmsSubmission,
            name: input.name,
            description: input.description,
            dueAt: input.dueAt,
            pointsPossible: input.pointsPossible,
            status: decision.status,
            // A heuristic estimate so the dashboard is useful immediately;
            // the AI breakdown (or the student) can refine it later.
            estimatedMinutes: heuristicEstimateMinutes({
              name: input.name,
              pointsPossible: input.pointsPossible,
              description: input.description,
            }),
          },
        });
        created += 1;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      continue;
    }

    const data: Record<string, unknown> = {};
    if (existing.name !== input.name) data.name = input.name;
    if (existing.description !== input.description) data.description = input.description;
    if (!sameTime(existing.dueAt, input.dueAt)) data.dueAt = input.dueAt;
    if (existing.pointsPossible !== input.pointsPossible) data.pointsPossible = input.pointsPossible;
    if (input.url && existing.lmsUrl !== input.url) data.lmsUrl = input.url;
    if (existing.status !== decision.status) data.status = decision.status;
    if (existing.lmsSubmission !== decision.lmsSubmission) data.lmsSubmission = decision.lmsSubmission;
    if (Object.keys(data).length > 0) await prisma.assignment.update({ where: { id: existing.id }, data });
    if (decision.reopened) reopened.push(input.name);
  }

  return { created, reopened };
}

/**
 * The class's exams from this sync: assignments the LMS treats as exams,
 * plus exams it only lists on its calendar. An exam whose assignment the
 * LMS no longer treats as one (an older name rule caught "Final Draft"
 * once) is removed; the assignment stays, and an email change still
 * waiting on that exam is closed as rejected. Exams added by hand or from
 * an email have no lmsItemId and are never touched.
 */
async function applyExams(prisma: PrismaClient, classId: string, course: LmsCourseInput): Promise<number> {
  const fromAssignments = (course.assignments ?? [])
    .filter((a) => a.isExam)
    .map((a) => ({ id: a.id, name: a.name, examAt: a.dueAt, location: null, url: a.url }));
  const exams = uniqueById([...fromAssignments, ...course.exams]);

  const stored = await prisma.exam.findMany({
    where: { classId, lmsItemId: { not: null } },
    select: { id: true, lmsItemId: true, name: true, examAt: true, location: true, lmsUrl: true },
  });
  const byItem = new Map(stored.map((e) => [e.lmsItemId as string, e]));

  for (const exam of exams) {
    const existing = byItem.get(exam.id);
    if (!existing) {
      try {
        await prisma.exam.create({
          data: { classId, lmsItemId: exam.id, lmsUrl: exam.url, name: exam.name, examAt: exam.examAt, location: exam.location },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      continue;
    }
    const data: Record<string, unknown> = {};
    if (existing.name !== exam.name) data.name = exam.name;
    if (!sameTime(existing.examAt, exam.examAt)) data.examAt = exam.examAt;
    if (exam.url && existing.lmsUrl !== exam.url) data.lmsUrl = exam.url;
    // A room the student typed in stays; the LMS only fills an empty one.
    if (exam.location && !existing.location) data.location = exam.location;
    if (Object.keys(data).length > 0) await prisma.exam.update({ where: { id: existing.id }, data });
  }

  if (course.assignments) {
    const notExams = new Set(course.assignments.filter((a) => !a.isExam).map((a) => a.id));
    const remove = stored.filter((e) => notExams.has(e.lmsItemId as string)).map((e) => e.id);
    if (remove.length > 0) {
      await prisma.pendingChange.updateMany({
        where: { entityType: "Exam", entityId: { in: remove }, status: "PENDING" },
        data: { status: "REJECTED", resolvedAt: new Date() },
      });
      await prisma.exam.deleteMany({ where: { id: { in: remove } } });
    }
  }
  return exams.length;
}
