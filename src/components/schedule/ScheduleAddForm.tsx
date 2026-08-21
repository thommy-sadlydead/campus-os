"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { addScheduleEventAction } from "@/app/classes/[id]/actions";

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
      className="h-fit rounded-xl2 border border-border-soft bg-surface p-4 shadow-card"
    >
      <h3 className="font-display text-base font-semibold">Add a meeting time</h3>
      <div className="mt-3 flex flex-col gap-2">
        <select name="classId" required className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent">
          <option value="">Choose a class…</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="dayOfWeek" defaultValue="1" className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent">
          {DAY_LABELS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input type="time" name="start" required className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
          <input type="time" name="end" required className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
        </div>
        <input type="text" name="location" placeholder="Room (optional)" className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
        <input type="text" name="label" placeholder="Lecture / Lab / Discussion (optional)" className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
        <button type="submit" disabled={pending} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60">
          Add
        </button>
      </div>
    </form>
  );
}
