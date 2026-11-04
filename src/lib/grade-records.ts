// Saving a class's grade (src/lib/grades.ts), from a Canvas sync or what
// the student typed. Not "server only", since the standalone Canvas sync
// script (scripts/sync-canvas.ts) uses it too.
import type { PrismaClient } from "@prisma/client";
import { enabledFeatures } from "@/lib/features";
import { isDemoAccount } from "@/lib/sample-classes";
import type { GradeSource } from "@/lib/grades";

/** Whether the account has Grades on, so syncs only keep grades for students who asked for them. */
export async function gradesOn(prisma: PrismaClient, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, features: true, featuresChosenAt: true } });
  return user ? enabledFeatures(user, { demo: isDemoAccount(user.email) }).has("grades") : false;
}

/**
 * Stores a class's current grade, and a snapshot when it changed, which
 * is what tells the dashboard a grade is slipping.
 */
export async function recordGrade(
  prisma: PrismaClient,
  classId: string,
  grade: { percent: number; letter: string | null },
  source: GradeSource,
  now: Date = new Date()
): Promise<void> {
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { gradePercent: true } });
  if (!cls) return;
  await prisma.class.update({
    where: { id: classId },
    data: { gradePercent: grade.percent, gradeLetter: grade.letter, gradeSource: source, gradeUpdatedAt: now },
  });
  if (cls.gradePercent === null || Math.abs(cls.gradePercent - grade.percent) >= 0.05) {
    await prisma.gradeSnapshot.create({ data: { classId, percent: grade.percent, takenAt: now } });
  }
}
