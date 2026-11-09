import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dayKey } from "@/lib/time";
import { addDays } from "@/lib/spaced-review";
import { weekdayOf } from "@/lib/exam-prep";
import { meetingRunsOn, type MeetingDates } from "@/lib/meetings";
import type { UrgencyBucket } from "@/lib/priority-engine";

// Small date helpers for Today (src/components/dashboard/TodayBoard), the
// Classes page and Schedule: each row's short due text, the date line, when
// a class next meets and the free gaps between meetings. Pure, so it's
// tested directly (tests/today.test.ts).

/** The due part of a row's meta line: "11:59 PM" today or tomorrow, "Fri 11:59 PM" this week, "Nov 20" later. */
export function dueShort(bucket: UrgencyBucket, dueAt: Date | null, tz: string): string | null {
  if (!dueAt) return null;
  switch (bucket) {
    case "TODAY":
    case "TOMORROW":
      return formatInTimeZone(dueAt, tz, "h:mm a");
    case "THIS_WEEK":
      return formatInTimeZone(dueAt, tz, "EEE h:mm a");
    default:
      return formatInTimeZone(dueAt, tz, "MMM d");
  }
}

/** "Friday, Nov 6", for the top of Today. */
export function heroDate(now: Date, tz: string): string {
  return formatInTimeZone(now, tz, "EEEE, MMM d");
}

/** When a class next meets, from its weekly meetings: the soonest start in the next two weeks that hasn't begun yet. */
export function nextMeetingAt(
  meetings: (MeetingDates & { dayOfWeek: number; startMinute: number })[],
  now: Date,
  tz: string
): Date | null {
  const today = dayKey(now, tz);
  let best: Date | null = null;
  for (let i = 0; i < 14 && !best; i++) {
    const day = addDays(today, i);
    const dow = weekdayOf(day);
    for (const m of meetings) {
      if (m.dayOfWeek !== dow || !meetingRunsOn(m, day)) continue;
      const at = new Date(fromZonedTime(`${day}T00:00:00`, tz).getTime() + m.startMinute * 60_000);
      if (at > now && (!best || at < best)) best = at;
    }
  }
  return best;
}

/** "Today 2:00 PM", "Tomorrow 9:30 AM", "Mon 11:00 AM". */
export function meetingLabel(at: Date, now: Date, tz: string): string {
  const day = dayKey(at, tz);
  const today = dayKey(now, tz);
  const prefix = day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : formatInTimeZone(at, tz, "EEE");
  return `${prefix} ${formatInTimeZone(at, tz, "h:mm a")}`;
}

/**
 * The open stretches in a day between its blocks (classes, commitments,
 * study sessions), inside `from`–`to`, at least `minGap` minutes long. Only
 * for days that have something on them; for today, nothing before `notBefore`.
 */
export function freeGaps(
  blocks: { start: number; end: number }[],
  { from = 8 * 60, to = 20 * 60, minGap = 60, notBefore = 0 }: { from?: number; to?: number; minGap?: number; notBefore?: number } = {}
): { start: number; end: number }[] {
  if (blocks.length === 0) return [];
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = Math.max(from, Math.ceil(notBefore / 15) * 15);
  for (const b of sorted) {
    if (b.start - cursor >= minGap && b.start <= to) gaps.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
  }
  if (to - cursor >= minGap) gaps.push({ start: cursor, end: to });
  return gaps.filter((g) => g.end - g.start >= minGap);
}

/** "1:00–2:30", "11:30–1:00". */
export function shortRange(start: number, end: number): string {
  const fmt = (m: number) => `${(Math.floor(m / 60) % 12) || 12}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(start)}–${fmt(end)}`;
}
