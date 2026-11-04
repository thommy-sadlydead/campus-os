"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { rescheduleStudySessionAction, setStudySessionStatusAction } from "@/app/classes/[id]/exam-prep-actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { CardsIcon } from "@/components/icons";
import { isMissed } from "@/lib/exam-prep";
import { isSameTzDay } from "@/lib/time";

export interface PlanSessionItem {
  id: string;
  classId: string;
  className: string;
  examName: string;
  startsAt: string;
  minutes: number;
  status: string;
}

/**
 * Exam prep on Today: what's planned for the coming week, anything missed,
 * and how much of this week's plan is done.
 */
export function StudyPlanCard({ sessions, doneThisWeek, plannedThisWeek, tz }: { sessions: PlanSessionItem[]; doneThisWeek: number; plannedThisWeek: number; tz: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  function run(fn: () => Promise<{ error?: string } | void | undefined>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <section className="card card-pad">
      <CardHeader
        icon={<CardsIcon className="h-[18px] w-[18px]" />}
        title="Exam prep"
        description={plannedThisWeek > 0 ? `This week: ${doneThisWeek} of ${plannedThisWeek} sessions done.` : undefined}
      />
      <ul className="mt-4 flex flex-col divide-y divide-border-soft">
        {sessions.map((s) => {
          const start = new Date(s.startsAt);
          const missed = isMissed({ startsAt: start, minutes: s.minutes, status: s.status }, now);
          const when = isSameTzDay(start, now, tz) ? `Today, ${formatInTimeZone(start, tz, "h:mm a")}` : formatInTimeZone(start, tz, "EEE, h:mm a");
          return (
            <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-ink">
                {s.minutes}-minute quiz for {s.examName}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                {missed ? <span className="text-warn">Missed · </span> : null}
                {when} · {s.className}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                <Link href={`/classes/${s.classId}?tab=study`} className="font-medium text-accent-ink hover:underline">
                  Start
                </Link>
                <button type="button" disabled={pending} onClick={() => run(() => setStudySessionStatusAction(s.id, "DONE"))} className="font-medium text-ink-soft hover:underline">
                  Done
                </button>
                {missed ? (
                  <button type="button" disabled={pending} onClick={() => run(() => rescheduleStudySessionAction(s.id))} className="font-medium text-ink-soft hover:underline">
                    Move to next free time
                  </button>
                ) : (
                  <button type="button" disabled={pending} onClick={() => run(() => setStudySessionStatusAction(s.id, "SKIPPED"))} className="font-medium text-ink-faint hover:underline">
                    Skip
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
    </section>
  );
}
