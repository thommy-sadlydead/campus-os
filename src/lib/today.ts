import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dayKey } from "@/lib/time";
import { addDays } from "@/lib/spaced-review";
import { weekdayOf } from "@/lib/exam-prep";
import { meetingRunsOn, type MeetingDates } from "@/lib/meetings";
import type { PriorityResult, UrgencyBucket } from "@/lib/priority-engine";

// The numbers behind the top of Today (src/components/dashboard/TodayBoard):
// the week strip's per-day counts, the big "due this week" number, the day
// timeline's class and free-time blocks, and each card's short due text.
// Pure, so it's tested directly (tests/today.test.ts).

export interface WeekDay {
  /** "2026-11-06", the day in the student's time zone. */
  key: string;
  /** "Mon" … "Sun". */
  label: string;
  /** Day of the month. */
  date: number;
  /** Open assignments due that day (an assignment broken into steps counts once). */
  due: number;
  isToday: boolean;
  isPast: boolean;
}

const LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Monday to Sunday of the week that has `now` in it, with what's due each day. */
export function weekDays(ranked: PriorityResult[], now: Date, tz: string): WeekDay[] {
  const today = dayKey(now, tz);
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const dueByDay = new Map<string, Set<string>>();
  for (const r of ranked) {
    if (!r.item.dueAt) continue;
    const key = dayKey(r.item.dueAt, tz);
    const set = dueByDay.get(key) ?? new Set<string>();
    set.add(r.item.assignmentId);
    dueByDay.set(key, set);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(monday, i);
    return {
      key,
      label: LABELS[weekdayOf(key)],
      date: Number(key.slice(8)),
      due: dueByDay.get(key)?.size ?? 0,
      isToday: key === today,
      isPast: key < today,
    };
  });
}

/** Open assignments due from today through Sunday (not the ones already overdue). */
export function dueThisWeek(ranked: PriorityResult[], now: Date, tz: string): number {
  const days = weekDays(ranked, now, tz).filter((d) => !d.isPast);
  return days.reduce((sum, d) => sum + d.due, 0);
}

export interface TimelineSegment {
  kind: "class" | "free";
  start: number;
  end: number;
  /** The class's code or the free block's label, for screen readers and hover. */
  label: string;
}

export interface DayTimeline {
  /** Minutes after midnight the strip starts and ends at (whole hours). */
  start: number;
  end: number;
  segments: TimelineSegment[];
}

/**
 * Today's strip: class meetings as solid blocks and the free time the
 * student logged as hatched ones, from 7 AM to 10 PM or wider if something
 * runs outside that.
 */
export function dayTimeline(
  meetings: { startMinute: number; endMinute: number; label: string }[],
  free: { startMinute: number; endMinute: number; label: string | null }[]
): DayTimeline {
  const segments: TimelineSegment[] = [
    ...meetings.map((m) => ({ kind: "class" as const, start: m.startMinute, end: m.endMinute, label: m.label })),
    ...free.map((f) => ({ kind: "free" as const, start: f.startMinute, end: f.endMinute, label: f.label || "Free time" })),
  ]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const earliest = Math.min(7 * 60, ...segments.map((s) => s.start));
  const latest = Math.max(22 * 60, ...segments.map((s) => s.end));
  return { start: Math.floor(earliest / 60) * 60, end: Math.min(24 * 60, Math.ceil(latest / 60) * 60), segments };
}

export interface DueBadge {
  text: string;
  /** urgent: red pill; soon: outlined; later: gray. */
  tone: "urgent" | "soon" | "later";
}

const BADGES: Record<UrgencyBucket, DueBadge> = {
  OVERDUE: { text: "Overdue", tone: "urgent" },
  TODAY: { text: "Due today", tone: "urgent" },
  TOMORROW: { text: "Due tomorrow", tone: "urgent" },
  THIS_WEEK: { text: "This week", tone: "soon" },
  LATER: { text: "Later", tone: "later" },
  NO_DATE: { text: "No date", tone: "later" },
};

export function dueBadge(bucket: UrgencyBucket): DueBadge {
  return BADGES[bucket];
}

/** The due part of a card's one meta line: "11:59 PM" today or tomorrow, "Fri 11:59 PM" this week, "Nov 20" later. */
export function dueShort(bucket: UrgencyBucket, dueAt: Date | null, tz: string): string | null {
  if (!dueAt) return null;
  switch (bucket) {
    case "TODAY":
    case "TOMORROW":
      return formatInTimeZone(dueAt, tz, "h:mm a");
    case "THIS_WEEK":
      return formatInTimeZone(dueAt, tz, "EEE h:mm a");
    case "OVERDUE":
      // The badge already says "Overdue".
      return formatInTimeZone(dueAt, tz, "MMM d");
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
