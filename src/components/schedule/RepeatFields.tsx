"use client";

import { useState } from "react";
import { DAY_LABELS, WEEK_ORDER, type MeetingDates } from "@/lib/meetings";

// The "repeats" part of adding a meeting time, on the Schedule page and a
// class's Overview tab: the weekdays (any number, as "dayOfWeek" values) and
// the semester's first and last day (optional).

export function DayPicker({ days, onChange, compact = false }: { days: number[]; onChange: (days: number[]) => void; compact?: boolean }) {
  // A row of seven circles, M T W T F S S; picked days are black.
  return (
    <fieldset>
      <legend className={compact ? "sr-only" : "field-label"}>Days</legend>
      <div className="flex justify-between gap-1">
        {WEEK_ORDER.map((d) => {
          const on = days.includes(d);
          return (
            <label
              key={d}
              title={DAY_LABELS[d]}
              className={`inline-flex flex-none cursor-pointer select-none items-center justify-center rounded-full border text-[13px] font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent-ring)] ${
                compact ? "h-8 w-8" : "h-10 w-10"
              } ${on ? "border-ink bg-ink text-surface" : "border-border-soft bg-surface text-ink-soft hover:border-ink hover:text-ink"}`}
            >
              <input
                type="checkbox"
                name="dayOfWeek"
                value={d}
                checked={on}
                onChange={() => onChange(on ? days.filter((x) => x !== d) : [...days, d])}
                className="sr-only"
              />
              <span aria-hidden>{DAY_LABELS[d][0]}</span>
              <span className="sr-only">{DAY_LABELS[d]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** First and last day, kept between adds so the next class can use the same semester. */
export function SemesterDates({ initial, compact = false }: { initial: MeetingDates | null; compact?: boolean }) {
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const field = compact ? "field field-sm w-full" : "field";
  return (
    <fieldset>
      <legend className="field-label">Semester (optional)</legend>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1 block text-xs text-ink-faint">First day</span>
          <input
            type="date"
            name="startsOn"
            value={startsOn}
            max={endsOn || undefined}
            onChange={(e) => setStartsOn(e.target.value)}
            className={field}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-faint">Last day</span>
          <input
            type="date"
            name="endsOn"
            value={endsOn}
            min={startsOn || undefined}
            onChange={(e) => setEndsOn(e.target.value)}
            className={field}
          />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-ink-faint">Leave blank to repeat every week with no end.</p>
    </fieldset>
  );
}
