"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addScheduleEventAction } from "@/app/classes/[id]/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { PlusIcon } from "@/components/icons";
import { DayPicker, SemesterDates } from "@/components/schedule/RepeatFields";
import type { MeetingDates } from "@/lib/meetings";

export function ScheduleAddForm({
  classes,
  semester,
}: {
  classes: Array<{ id: string; name: string; color: number }>;
  /** The dates of the last meeting added with some, to start from. */
  semester: MeetingDates | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<number[]>([]);

  return (
    <form
      action={(fd) => {
        const classId = String(fd.get("classId") || "");
        if (!classId || days.length === 0) return;
        startTransition(async () => {
          await addScheduleEventAction(classId, fd);
          setDays([]);
          router.refresh();
        });
      }}
      className="card card-pad h-fit"
    >
      <CardHeader
        icon={<PlusIcon className="h-[18px] w-[18px]" />}
        title="Add a meeting time"
        description="Repeats every week on the days you pick."
      />
      <div className="mt-4 flex flex-col gap-3">
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
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="field-label">Start</span>
            <input type="time" name="start" required className="field" />
          </label>
          <label>
            <span className="field-label">End</span>
            <input type="time" name="end" required className="field" />
          </label>
        </div>
        <label>
          <span className="field-label">Room (optional)</span>
          <input type="text" name="location" placeholder="Engineering Hall 210" className="field" />
        </label>
        <label>
          <span className="field-label">Type (optional)</span>
          <input type="text" name="label" placeholder="Lecture / Lab / Discussion" className="field" />
        </label>
        <SemesterDates initial={semester} />
        <button type="submit" disabled={pending || days.length === 0} className="btn btn-primary mt-1">
          {pending ? "Adding…" : days.length > 1 ? `Add on ${days.length} days` : "Add meeting time"}
        </button>
      </div>
    </form>
  );
}
