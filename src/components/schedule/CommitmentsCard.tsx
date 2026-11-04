"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCommitmentAction, deleteCommitmentsAction, setStudyCutoffAction } from "@/app/schedule/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { DayPicker } from "@/components/schedule/RepeatFields";
import { formatDays, groupMeetings, timeLabel, type MeetingRow } from "@/lib/meetings";
import { DEFAULT_STUDY_CUTOFF } from "@/lib/exam-prep";
import { ClockIcon, XIcon } from "@/components/icons";

export interface CommitmentRow {
  id: string;
  label: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

const CUTOFFS = [21 * 60, 22 * 60, 23 * 60, 24 * 60];

/**
 * Work and other commitments (src/lib/features.ts) on the Schedule page:
 * weekly blocks that exam prep plans stay out of, and the latest the
 * student wants to study.
 */
export function CommitmentsCard({ commitments, cutoffMinute }: { commitments: CommitmentRow[]; cutoffMinute: number | null }) {
  const router = useRouter();
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groups = groupMeetings(
    commitments.map((c): MeetingRow => ({ ...c, location: null, label: c.label, startsOn: null, endsOn: null }))
  );

  return (
    <div className="card p-5">
      <CardHeader
        icon={<ClockIcon className="h-[18px] w-[18px]" />}
        title="Work and other commitments"
        description="Shifts, practice, anything weekly. Exam prep plans work around them."
      />

      {groups.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-border-soft">
          {groups.map((g) => (
            <li key={g.ids.join(",")} className="flex items-center gap-3 py-2.5 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{g.label}</p>
                <p className="text-[13px] tabular-nums text-ink-soft">
                  {formatDays(g.days)} · {timeLabel(g.startMinute)}–{timeLabel(g.endMinute)}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${g.label}`}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteCommitmentsAction(g.ids);
                    router.refresh();
                  })
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        // onSubmit, not action: React resets a form after its action, which
        // would clear what was typed when it's rejected.
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setError(null);
          startTransition(async () => {
            const result = await addCommitmentAction(fd);
            if (result.error) {
              setError(result.error);
              return;
            }
            form.reset();
            setDays([]);
            router.refresh();
          });
        }}
        className="mt-4 flex flex-col gap-3 border-t border-border-soft pt-4"
      >
        <label className="flex flex-col">
          <span className="field-label">What</span>
          <input name="label" placeholder="Work" maxLength={60} className="field field-sm" />
        </label>
        <DayPicker days={days} onChange={setDays} compact />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-ink-faint">Starts</span>
            <input type="time" name="start" className="field field-sm w-full" />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-ink-faint">Ends</span>
            <input type="time" name="end" className="field field-sm w-full" />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-secondary btn-sm self-start">
          Add
        </button>
      </form>

      <label className="mt-4 flex items-center justify-between gap-3 border-t border-border-soft pt-4">
        <span className="text-sm text-ink">Don&apos;t plan study after</span>
        <select
          defaultValue={String(cutoffMinute ?? DEFAULT_STUDY_CUTOFF)}
          onChange={(e) =>
            startTransition(async () => {
              await setStudyCutoffAction(Number(e.target.value));
              router.refresh();
            })
          }
          className="field field-sm w-auto"
        >
          {CUTOFFS.map((m) => (
            <option key={m} value={m}>
              {m === 24 * 60 ? "Midnight" : timeLabel(m)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
