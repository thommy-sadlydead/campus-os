import { formatInTimeZone } from "date-fns-tz";

// Picks the class a student is most likely recording right now, from their
// weekly schedule (ScheduleEvent), so "Record" can start with the right
// class already chosen. Pure and dependency-light so it's easy to test.

export interface ScheduleSlot {
  classId: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday, like ScheduleEvent
  startMinute: number; // minutes after local midnight
  endMinute: number;
}

export type SuggestionReason = "in-session" | "starting-soon" | "just-ended";

export interface ClassSuggestion {
  classId: string;
  reason: SuggestionReason;
}

// Students open the recorder a little before class starts, or remember to
// stop a little after it ends; either should still find the right class.
export const EARLY_WINDOW_MINUTES = 15;
export const LATE_WINDOW_MINUTES = 15;

/** Day of week (0 = Sunday) and minute of the day for `now` in the student's time zone. */
export function localDayAndMinute(now: Date, tz: string): { dayOfWeek: number; minute: number } {
  const [isoDay, hh, mm] = formatInTimeZone(now, tz, "i HH mm").split(" ").map(Number);
  return { dayOfWeek: isoDay % 7, minute: hh * 60 + mm };
}

export function suggestClassToRecord(slots: ScheduleSlot[], now: Date, tz: string): ClassSuggestion | null {
  const { dayOfWeek, minute } = localDayAndMinute(now, tz);
  const today = slots.filter((s) => s.dayOfWeek === dayOfWeek);

  const inSession = today.find((s) => minute >= s.startMinute && minute <= s.endMinute);
  if (inSession) return { classId: inSession.classId, reason: "in-session" };

  const startingSoon = today
    .filter((s) => minute < s.startMinute && s.startMinute - minute <= EARLY_WINDOW_MINUTES)
    .sort((a, b) => a.startMinute - b.startMinute)[0];
  if (startingSoon) return { classId: startingSoon.classId, reason: "starting-soon" };

  const justEnded = today
    .filter((s) => minute > s.endMinute && minute - s.endMinute <= LATE_WINDOW_MINUTES)
    .sort((a, b) => b.endMinute - a.endMinute)[0];
  if (justEnded) return { classId: justEnded.classId, reason: "just-ended" };

  return null;
}

/** A default lecture title like "Lecture — Tue, Sep 30", in the student's time zone. */
export function defaultLectureTitle(now: Date, tz: string): string {
  return `Lecture — ${formatInTimeZone(now, tz, "EEE, MMM d")}`;
}
