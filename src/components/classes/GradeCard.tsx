"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { setGradeTargetAction } from "@/app/classes/[id]/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { describeNeeded, formatPercent, neededOnFinal } from "@/lib/grades";
import { lmsName } from "@/lib/lms/providers";

export interface GradeInfo {
  percent: number | null;
  letter: string | null;
  source: string | null;
  updatedAt: string | null;
  target: number | null;
  /** The weight of an exam named like a final, when it has one, to start the calculator with. */
  finalWeight: number | null;
  slip: { kind: "dropped"; points: number; from: number; since: string } | { kind: "below-goal"; target: number } | null;
}

/** Grades (src/lib/grades.ts) on a class's Overview: the grade, a goal, and what the final needs to be. */
export function GradeCard({ classId, lmsProvider, grade, tz }: { classId: string; lmsProvider: string | null; grade: GradeInfo; tz: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(grade.target != null ? String(grade.target) : "90");
  const [current, setCurrent] = useState(grade.percent != null ? String(grade.percent) : "");
  const [weight, setWeight] = useState(grade.finalWeight != null ? String(grade.finalWeight) : "20");

  const needed = neededOnFinal({ current: Number(current), target: Number(target), finalWeight: Number(weight) });
  const ready = current.trim() !== "" && target.trim() !== "" && needed !== null && Number.isFinite(needed);
  const from = grade.source === "canvas" ? lmsName(lmsProvider) ?? "Canvas" : "what you typed in";

  function saveGoal() {
    const value = Number(target);
    if (!(value > 0 && value <= 100) || value === grade.target) return;
    startTransition(async () => {
      await setGradeTargetAction(classId, value);
      router.refresh();
    });
  }

  return (
    <div className="card p-5">
      <CardHeader
        title="Grade"
        description={
          grade.percent != null
            ? `From ${from}${grade.updatedAt ? `, ${formatInTimeZone(new Date(grade.updatedAt), tz, "MMM d")}` : ""}.`
            : lmsProvider === "canvas"
              ? "Canvas isn't showing a total for this class. Type your grade under Details, like 88%, to track it here."
              : "Type your grade under Details, like 88% or 45/50, to track it here."
        }
      />
      {grade.percent != null && (
        <p className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-3xl font-semibold text-ink">{formatPercent(grade.percent)}</span>
          {grade.letter && <span className="text-base font-medium text-ink-soft">{grade.letter}</span>}
        </p>
      )}
      {grade.slip && (
        <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink">
          {grade.slip.kind === "dropped"
            ? `Down ${grade.slip.points} points since ${formatInTimeZone(new Date(grade.slip.since), tz, "MMM d")}, from ${formatPercent(grade.slip.from)}.`
            : `Below your goal of ${formatPercent(grade.slip.target)}.`}
        </p>
      )}

      <div className="mt-4 border-t border-border-soft pt-4">
        <p className="text-sm font-semibold text-ink">What do I need on the final?</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <NumberField label="Grade now" value={current} onChange={setCurrent} />
          <NumberField label="Goal" value={target} onChange={setTarget} onBlur={saveGoal} />
          <NumberField label="Final is worth" value={weight} onChange={setWeight} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft" aria-live="polite">
          {ready ? describeNeeded(needed as number, Number(target)) : "Fill in all three, as percents."}
          {pending ? " Saving your goal…" : ""}
        </p>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (v: string) => void; onBlur?: () => void }) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs text-ink-faint">{label} (%)</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="field field-sm w-full"
      />
    </label>
  );
}
