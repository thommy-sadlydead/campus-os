import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { RecordLecture } from "@/components/lectures/RecordLecture";
import { defaultLectureTitle, suggestClassToRecord } from "@/lib/record-class";
import { hasAiConsent } from "@/lib/ai-consent";
import { AiConsentCard } from "@/components/account/AiConsent";
import { PageHeader } from "@/components/ui/PageHeader";
import { featuresFor } from "@/lib/features-server";
import Link from "next/link";

export default async function RecordPage() {
  const user = await requireUser();
  if (!(await featuresFor(user)).has("lectures")) {
    return (
      <AppShell active="/record" userName={user.name ?? user.email}>
        <PageHeader title="Record a lecture" />
        <div className="empty">
          Lecture recording is turned off.{" "}
          <Link href="/account#features" className="font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
            Turn it on under Account → Features
          </Link>{" "}
          to record or upload lectures.
        </div>
      </AppShell>
    );
  }
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
      startsOn: e.startsOn,
      endsOn: e.endsOn,
    }))
  );
  const suggestion = suggestClassToRecord(slots, now, user.timezone);

  return (
    <AppShell active="/record" userName={user.name ?? user.email}>
      <header className="mb-6">
        <p className="eyebrow">Transcript and notes, filed under the class</p>
        <h1 className="mt-1.5 font-display text-[40px] font-bold leading-[1.02] text-ink">Record</h1>
      </header>
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
