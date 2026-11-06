"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { addScheduleEventAction } from "@/app/classes/[id]/actions";
import { PlusIcon, XIcon } from "@/components/icons";
import { TimeWheel } from "@/components/schedule/TimeWheel";
import { DayPicker, SemesterDates } from "@/components/schedule/RepeatFields";
import { meetingTimeProblem, minutesFromTimeField, type MeetingDates } from "@/lib/meetings";

export function ScheduleAddForm({
  classes,
  semester,
}: {
  classes: Array<{ id: string; name: string; color: number }>;
  /** The dates of the last meeting added with some, to start from. */
  semester: MeetingDates | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState(9 * 60);
  const [end, setEnd] = useState(10 * 60);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a meeting time"
        title="Add a meeting time"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ink text-surface transition-transform active:scale-95"
      >
        <PlusIcon className="h-5 w-5" />
      </button>

      {/* Rendered into <body>, or the floating tab bar would cover the sheet. */}
      {open &&
        createPortal(
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Add a meeting time">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 h-full w-full bg-black/40" />
          {/* A bottom sheet: slides up from the bottom edge on a phone, a
              centered panel on a wide screen. */}
          <form
            // onSubmit, not action: React empties a form after its action runs,
            // which would wipe what the student typed when there's a problem to fix.
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const classId = String(fd.get("classId") || "");
              if (!classId || days.length === 0) return;
              const problem = newMeetingProblem(fd);
              setError(problem);
              if (problem) return;
              startTransition(async () => {
                const result = await addScheduleEventAction(classId, fd);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                setDays([]);
                setOpen(false);
                router.refresh();
              });
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92vh] max-w-lg animate-[sheet-up_220ms_cubic-bezier(0.34,1.2,0.64,1)] flex-col overflow-y-auto rounded-t-[28px] bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-[28px]"
          >
            <div className="mx-auto mb-4 h-1 w-10 flex-none rounded-full bg-border lg:hidden" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Repeats every week</p>
                <h2 className="mt-1 font-display text-[24px] font-bold leading-tight text-ink">Add a meeting time</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink">
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 flex flex-col gap-4">
              <label>
                <span className="field-label">Class</span>
                <select name="classId" required className="field">
                  <option value="">Choose a class…</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <DayPicker days={days} onChange={setDays} />
              <div className="grid grid-cols-2 gap-3">
                <TimeWheel
                  name="start"
                  label="Start"
                  value={start}
                  onChange={(m) => {
                    setStart(m);
                    if (end <= m) setEnd(Math.min(m + 60, 23 * 60 + 55));
                  }}
                />
                <TimeWheel name="end" label="End" value={end} onChange={setEnd} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="field-label">Room</span>
                  <input type="text" name="location" placeholder="Optional" className="field" />
                </label>
                <label>
                  <span className="field-label">Type</span>
                  <input type="text" name="label" placeholder="Lecture, lab…" className="field" />
                </label>
              </div>
              <SemesterDates initial={semester} />
              {error && (
                <p role="alert" className="text-[13px] font-medium text-danger">
                  {error}
                </p>
              )}
              <button type="submit" disabled={pending || days.length === 0} className="btn btn-primary btn-lg">
                {pending ? "Adding…" : days.length > 1 ? `Add on ${days.length} days` : "Add meeting time"}
              </button>
            </div>
          </form>
        </div>,
          document.body
        )}
    </>
  );
}

/** The problem with the form's times or dates, checked before it's sent (the server checks again). */
export function newMeetingProblem(fd: FormData): string | null {
  const startMinute = minutesFromTimeField(String(fd.get("start") ?? ""));
  const endMinute = minutesFromTimeField(String(fd.get("end") ?? ""));
  if (startMinute === null || endMinute === null) return "Add a start and end time.";
  return meetingTimeProblem({
    startMinute,
    endMinute,
    startsOn: String(fd.get("startsOn") ?? "") || null,
    endsOn: String(fd.get("endsOn") ?? "") || null,
  });
}
