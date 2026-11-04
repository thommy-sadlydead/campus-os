// Grades (src/lib/features.ts): reading a typed grade, what's needed on the
// final, and whether a grade is slipping. Pure, so it's easy to test.
//
// Students tend to think they're doing better than they are, and the ones
// doing worst overestimate the most, so they study less than they would
// with an accurate picture. Showing the real number, and saying when it
// drops, is the point.

/** A grade source: synced from Canvas, or typed in by the student. */
export type GradeSource = "canvas" | "manual";

/** How many points down from its recent high counts as slipping. */
export const SLIP_POINTS = 3;
/** How far back "recent" goes. */
export const SLIP_WINDOW_DAYS = 21;

/**
 * The percent in what a student typed as their grade: "92%", "88.5",
 * "B+ (88%)", "45/50". Null for a letter alone ("A-"), which doesn't say
 * where in the range it is, or anything that isn't a plausible grade.
 */
export function parseGradePercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const fraction = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(text);
  if (fraction) {
    const total = Number(fraction[2]);
    if (total <= 0) return null;
    return round1((Number(fraction[1]) / total) * 100);
  }
  const number = /(\d+(?:\.\d+)?)\s*%?/.exec(text);
  if (!number) return null;
  const value = Number(number[1]);
  return value >= 0 && value <= 150 ? round1(value) : null;
}

/** "92.5%", "88%". */
export function formatPercent(value: number): string {
  return `${Number.isInteger(round1(value)) ? round1(value).toFixed(0) : round1(value).toFixed(1)}%`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The score needed on the final to finish with `target`, when the final
 * is `finalWeight` percent of the grade and everything before it averages
 * `current`. Null when the weight isn't between 0 and 100.
 */
export function neededOnFinal(input: { current: number; target: number; finalWeight: number }): number | null {
  const w = input.finalWeight / 100;
  if (!(w > 0 && w <= 1)) return null;
  return round1((input.target - input.current * (1 - w)) / w);
}

/** A sentence for the calculator's answer. */
export function describeNeeded(needed: number, target: number): string {
  if (needed > 100) return `Even 100% on the final won't get you to ${formatPercent(target)}: you'd need ${formatPercent(needed)}.`;
  if (needed <= 0) return `You'd keep ${formatPercent(target)} even with a 0 on the final.`;
  return `You need ${formatPercent(needed)} on the final to finish with ${formatPercent(target)}.`;
}

export type GradeSlip =
  | { kind: "dropped"; points: number; from: number; since: Date }
  | { kind: "below-goal"; target: number };

/**
 * Whether a grade needs attention: down SLIP_POINTS or more from its high
 * in the last SLIP_WINDOW_DAYS, or under the student's goal. Built only
 * from grades on file, never guessed.
 */
export function gradeSlip(
  current: number,
  snapshots: { percent: number; takenAt: Date }[],
  now: Date,
  target: number | null
): GradeSlip | null {
  const from = now.getTime() - SLIP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = snapshots.filter((s) => s.takenAt.getTime() >= from && s.takenAt.getTime() <= now.getTime());
  const high = recent.reduce<{ percent: number; takenAt: Date } | null>((best, s) => (!best || s.percent > best.percent ? s : best), null);
  if (high && high.percent - current >= SLIP_POINTS) {
    return { kind: "dropped", points: round1(high.percent - current), from: high.percent, since: high.takenAt };
  }
  if (target !== null && current < target) return { kind: "below-goal", target };
  return null;
}

/**
 * The course grade Canvas reports for the student (courses requested
 * with include[]=total_scores). Null when the course hides totals from
 * students, which many do.
 */
export function canvasCourseGrade(course: {
  enrollments?: { type?: string; computed_current_score?: number | null; computed_current_grade?: string | null }[];
}): { percent: number; letter: string | null } | null {
  const enrollment = (course.enrollments ?? []).find(
    (e) => (e.type === "student" || e.type === "StudentEnrollment") && typeof e.computed_current_score === "number"
  );
  if (!enrollment || typeof enrollment.computed_current_score !== "number") return null;
  return { percent: round1(enrollment.computed_current_score), letter: enrollment.computed_current_grade?.trim() || null };
}
