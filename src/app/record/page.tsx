import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { RecordLecture } from "@/components/lectures/RecordLecture";
import { defaultLectureTitle, suggestClassToRecord } from "@/lib/record-class";

export default async function RecordPage() {
  const user = await requireUser();
  const classes = await prisma.class.findMany({
    where: { userId: user.id, archived: false },
    orderBy: { name: "asc" },
    include: { scheduleEvents: true },
  });

  const now = new Date();
  const suggestion = suggestClassToRecord(
    classes.flatMap((c) =>
      c.scheduleEvents.map((e) => ({
        classId: c.id,
        dayOfWeek: e.dayOfWeek,
        startMinute: e.startMinute,
        endMinute: e.endMinute,
      }))
    ),
    now,
    user.timezone
  );

  return (
    <AppShell active="/record" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Record a lecture</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Campus OS writes the transcript and notes for you, and files them under the class.
      </p>
      <RecordLecture
        classes={classes.map((c) => ({ id: c.id, name: c.name, code: c.code, color: c.color }))}
        suggestion={suggestion}
        defaultTitle={defaultLectureTitle(now, user.timezone)}
      />
    </AppShell>
  );
}
