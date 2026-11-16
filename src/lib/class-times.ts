// The one-time ask on Today for class meeting times. Record opens on the
// right class, and Schedule and "next class" fill in, only once a student
// has typed their meeting times in, and no LMS reports them. So once a
// student has classes but no times at all, Today asks once, with a way to
// say "not now". Pure; tested in tests/class-times.test.ts.

/** Set by "Not now" on that card, so it stays away for a year. */
export const CLASS_TIMES_NOT_NOW_COOKIE = "campusos_times_not_now";

/**
 * Whether Today should ask for class times: classes have come in (a sync
 * ran), none of them has a meeting time, and the student hasn't said "not
 * now". Adding any one meeting time ends the ask for good.
 */
export function asksForClassTimes({ classCount, meetingCount, dismissed }: { classCount: number; meetingCount: number; dismissed: boolean }): boolean {
  return classCount > 0 && meetingCount === 0 && !dismissed;
}
