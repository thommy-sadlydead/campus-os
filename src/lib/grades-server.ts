import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { fetchActiveCourses } from "@/lib/canvas";
import { canvasCourseGrade } from "@/lib/grades";
import { recordGrade } from "@/lib/grade-records";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit";

/**
 * Canvas grades change between syncs (a quiz gets graded), and syncs only
 * run when the student taps Sync now, so Today refreshes them after it
 * loads (with after(), so the page doesn't wait): one Canvas request for
 * every course's total, at most every six hours. Never throws.
 */
export async function refreshCanvasGrades(userId: string): Promise<void> {
  try {
    const account = await prisma.canvasAccount.findUnique({ where: { userId } });
    if (!account) return;
    if (!(await consumeRateLimit(`grades-refresh:${userId}`, RATE_LIMITS.gradesRefresh))) return;
    const courses = await fetchActiveCourses({ baseUrl: account.baseUrl, token: decryptSecret(account.accessTokenEnc) });
    const now = new Date();
    for (const course of courses) {
      const grade = canvasCourseGrade(course);
      if (!grade) continue;
      const cls = await prisma.class.findUnique({
        where: { userId_lmsProvider_lmsCourseId: { userId, lmsProvider: "canvas", lmsCourseId: String(course.id) } },
        select: { id: true },
      });
      if (cls) await recordGrade(prisma, cls.id, grade, "canvas", now);
    }
  } catch (err) {
    // Usually an expired Canvas token; the Canvas page already asks for a new one.
    console.error(`Canvas grade refresh failed for user ${userId}:`, err instanceof Error ? err.message : err);
  }
}
