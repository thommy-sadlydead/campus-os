import "server-only";
import { prisma } from "@/lib/prisma";
import type { PlanContext, WeeklyBlock } from "@/lib/exam-prep";
import type { FeatureId } from "@/lib/features";

/**
 * What an exam prep plan has to fit around (src/lib/exam-prep.ts): the
 * student's class meetings, their commitments when that feature is on,
 * the sessions already planned, and the latest time they want to study.
 */
export async function planContextFor(
  user: { id: string; timezone: string; studyCutoffMinute: number | null },
  features: Set<FeatureId>,
  now: Date = new Date()
): Promise<PlanContext> {
  const [meetings, commitments, taken] = await Promise.all([
    prisma.scheduleEvent.findMany({
      where: { class: { userId: user.id, archived: false } },
      select: { dayOfWeek: true, startMinute: true, endMinute: true, startsOn: true, endsOn: true },
    }),
    features.has("commitments")
      ? prisma.commitment.findMany({
          where: { userId: user.id },
          select: { dayOfWeek: true, startMinute: true, endMinute: true, startsOn: true, endsOn: true },
        })
      : Promise.resolve([]),
    prisma.studySession.findMany({
      where: { userId: user.id, status: "PLANNED", startsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      select: { startsAt: true, minutes: true },
    }),
  ]);
  const weekly: WeeklyBlock[] = [...meetings, ...commitments];
  return { now, tz: user.timezone, weekly, taken, cutoffMinute: features.has("commitments") ? user.studyCutoffMinute : null };
}
