import "server-only";
import { prisma } from "@/lib/prisma";
import { dayKey } from "@/lib/time";
import { semesterToReuse, type MeetingDates } from "@/lib/meetings";

/** The semester dates the add-a-meeting forms start with (see semesterToReuse). */
export async function semesterForNewMeetings(userId: string, tz: string): Promise<MeetingDates | null> {
  const last = await prisma.scheduleEvent.findFirst({
    where: { class: { userId }, OR: [{ startsOn: { not: null } }, { endsOn: { not: null } }] },
    orderBy: { createdAt: "desc" },
    select: { startsOn: true, endsOn: true },
  });
  return semesterToReuse(last, dayKey(new Date(), tz));
}
