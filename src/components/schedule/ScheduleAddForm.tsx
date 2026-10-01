"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { addScheduleEventAction } from "@/app/classes/[id]/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { PlusIcon } from "@/components/icons";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleAddForm({ classes }: { classes: Array<{ id: string; name: string; color: number }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        const classId = String(fd.get("classId") || "");
        if (!classId) return;
        startTransition(async () => {
          await addScheduleEventAction(classId, fd);
          router.refresh();
        });
      }}
      className="card card-pad h-fit lg:sticky lg:top-10"
    >
      <CardHeader
        icon={<PlusIcon className="h-[18px] w-[18px]" />}
        title="Add a meeting time"
        description="Repeats every week on the day you pick."
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
        <label>
          <span className="field-label">Day</span>
          <select name="dayOfWeek" defaultValue="1" className="field">
            {DAY_LABELS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
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
        <button type="submit" disabled={pending} className="btn btn-primary mt-1">
          {pending ? "Adding…" : "Add meeting time"}
        </button>
      </div>
    </form>
  );
}
