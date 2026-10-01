import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { RecordLecture } from "@/components/lectures/RecordLecture";
import { defaultLectureTitle, suggestClassToRecord } from "@/lib/record-class";
import { hasAiConsent } from "@/lib/ai-consent";
import { AiConsentCard } from "@/components/account/AiConsent";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function RecordPage() {
  const user = await requireUser();
  const classes = await prisma.class.findMany({
    where: { userId: user.id, archived: false },
    orderBy: { name: "asc" },
    include: { scheduleEvents: true },
  });

  const now = new Date();
  const slots = classes.flatMap((c) =>
    c.scheduleEvents.map((e) => ({
      classId: c.id,
      dayOfWeek: e.dayOfWeek,
      startMinute: e.startMinute,
      endMinute: e.endMinute,
    }))
  );
  const suggestion = suggestClassToRecord(slots, now, user.timezone);

  return (
    <AppShell active="/record" userName={user.name ?? user.email}>
      <PageHeader
        title="Record a lecture"
        description="Campus OS writes the transcript and notes for you, and files them under the class."
      />
      {!hasAiConsent(user) && (
        <AiConsentCard
          dismissible={false}
          reason="Transcripts and notes for your recordings are written by AI, so this needs to be on to record or upload a lecture."
        />
      )}
      <RecordLecture
        classes={classes.map((c) => ({ id: c.id, name: c.name, code: c.code, color: c.color }))}
        suggestion={suggestion}
        defaultTitle={defaultLectureTitle(now, user.timezone)}
        slots={slots}
        timezone={user.timezone}
      />
    </AppShell>
  );
}
