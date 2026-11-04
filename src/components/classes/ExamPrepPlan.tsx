"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  createExamPrepPlanAction,
  deleteExamPrepPlanAction,
  rescheduleStudySessionAction,
  setStudySessionStatusAction,
} from "@/app/classes/[id]/exam-prep-actions";
import { useFeature } from "@/components/FeaturesProvider";
import { isMissed, planProgress } from "@/lib/exam-prep";
import { CheckIcon, SparkIcon } from "@/components/icons";

export interface StudySessionRow {
  id: string;
  startsAt: string;
  minutes: number;
  status: string;
}

/** An upcoming exam's prep plan (src/lib/exam-prep.ts) on the Exams tab, or the button to make one. */
export function ExamPrepPlan({ examId, sessions, tz, onStudy }: { examId: string; sessions: StudySessionRow[]; tz: string; onStudy?: () => void }) {
  const on = useFeature("exam-prep");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  if (!on) return null;
  const now = new Date();
  const rows = sessions.map((s) => ({ ...s, start: new Date(s.startsAt) }));
  const kept = rows.filter((s) => s.status !== "SKIPPED");

  function run(fn: () => Promise<{ error?: string; notice?: string } | void | undefined>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result && (result.error || result.notice)) setMessage({ text: (result.error ?? result.notice) as string, error: Boolean(result.error) });
      router.refresh();
    });
  }

  if (kept.length === 0) {
    return (
      <div className="mt-3">
        <button type="button" onClick={() => run(() => createExamPrepPlanAction(examId))} disabled={pending} className="btn btn-secondary btn-sm">
          <SparkIcon className="h-3.5 w-3.5" />
          {pending ? "Planning… making flashcards can take a minute" : "Make a prep plan"}
        </button>
        {message && <p className={`mt-2 text-[13px] ${message.error ? "text-danger" : "text-ink-soft"}`}>{message.text}</p>}
      </div>
    );
  }

  const { done, total } = planProgress(rows);
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">
          Prep plan · {done} of {total} done
        </p>
        <button type="button" onClick={() => run(() => deleteExamPrepPlanAction(examId))} disabled={pending} className="text-xs font-medium text-ink-faint hover:text-danger">
          Remove plan
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {kept.map((s) => {
          const missed = isMissed({ ...s, startsAt: s.start }, now);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className={`tabular-nums ${s.status === "DONE" ? "text-ink-faint line-through" : "text-ink"}`}>
                {formatInTimeZone(s.start, tz, "EEE MMM d, h:mm a")} · {s.minutes} min quiz
              </span>
              {s.status === "DONE" ? (
                <span className="inline-flex items-center gap-1 text-ok">
                  <CheckIcon className="h-3.5 w-3.5" />
                  Done
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {missed && <span className="text-warn">Missed</span>}
                  <button type="button" onClick={() => run(() => setStudySessionStatusAction(s.id, "DONE"))} disabled={pending} className="font-medium text-accent-ink hover:underline">
                    Mark done
                  </button>
                  {missed ? (
                    <button type="button" onClick={() => run(() => rescheduleStudySessionAction(s.id))} disabled={pending} className="font-medium text-ink-soft hover:underline">
                      Move to next free time
                    </button>
                  ) : (
                    <button type="button" onClick={() => run(() => setStudySessionStatusAction(s.id, "SKIPPED"))} disabled={pending} className="font-medium text-ink-faint hover:underline">
                      Skip
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {onStudy && (
        <button type="button" onClick={onStudy} className="mt-3 text-[13px] font-medium text-accent-ink hover:underline">
          Quiz yourself now on the Study tab
        </button>
      )}
      {message && <p className={`mt-2 text-[13px] ${message.error ? "text-danger" : "text-ink-soft"}`}>{message.text}</p>}
    </div>
  );
}
