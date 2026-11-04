import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dayKey } from "@/lib/time";
import { addDays } from "@/lib/spaced-review";
import { meetingRunsOn, type MeetingDates } from "@/lib/meetings";

// Exam prep plans (src/lib/features.ts): a few short self-quiz sessions
// spread over the days before an exam, fit around class meetings and the
// student's commitments, and never later than the time they set. Pure, so
// it's easy to test.
//
// Why this shape: testing yourself and spacing it out are the two study
// techniques with the strongest evidence (Dunlosky et al., 2013), and
// students study hours less each week than they plan to (Oreopoulos and
// Petronijevic, 2019), so the plan is specific (when, and on what) and
// shows what got done.

export type StudySessionStatus = "PLANNED" | "DONE" | "SKIPPED";

/** Days before the exam to put a session on. Fewer when the exam is close. */
export const PLAN_OFFSETS = [7, 5, 3, 2, 1];
export const SESSION_MINUTES = 30;
/** The latest a session may end, by default: 10 PM. */
export const DEFAULT_STUDY_CUTOFF = 22 * 60;
/** Sessions go after classes when they can (4 PM on), otherwise from 9 AM. */
const PREFERRED_START = 16 * 60;
const EARLIEST_START = 9 * 60;
/** Room left around classes and work. */
const BUFFER = 10;
const STEP = 15;

/** A weekly block of time that's taken: a class meeting or a commitment, one per weekday. */
export interface WeeklyBlock extends MeetingDates {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface PlanContext {
  now: Date;
  tz: string;
  weekly: WeeklyBlock[];
  /** Sessions already planned (for any exam), so two don't land at once. */
  taken: { startsAt: Date; minutes: number }[];
  cutoffMinute?: number | null;
  sessionMinutes?: number;
}

/** 0 = Sunday .. 6 = Saturday, for "2026-11-04". */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

function minuteOfDay(instant: Date, tz: string): number {
  const [h, m] = formatInTimeZone(instant, tz, "HH:mm").split(":").map(Number);
  return h * 60 + m;
}

function atMinute(day: string, minute: number, tz: string): Date {
  const h = String(Math.floor(minute / 60)).padStart(2, "0");
  const m = String(minute % 60).padStart(2, "0");
  return fromZonedTime(`${day}T${h}:${m}:00`, tz);
}

function busyOn(day: string, ctx: PlanContext): [number, number][] {
  const dow = weekdayOf(day);
  const weekly = ctx.weekly
    .filter((b) => b.dayOfWeek === dow && meetingRunsOn(b, day))
    .map((b): [number, number] => [b.startMinute - BUFFER, b.endMinute + BUFFER]);
  const sessions = ctx.taken
    .filter((s) => dayKey(s.startsAt, ctx.tz) === day)
    .map((s): [number, number] => {
      const start = minuteOfDay(s.startsAt, ctx.tz);
      return [start - BUFFER, start + s.minutes + BUFFER];
    });
  return [...weekly, ...sessions];
}

/**
 * The start minute of the first free session on `day`: from 4 PM up to
 * the cutoff, then from 9 AM, never before `notBefore`. Null when the day
 * is full.
 */
export function firstFreeSlot(day: string, ctx: PlanContext, notBefore = 0): number | null {
  const length = ctx.sessionMinutes ?? SESSION_MINUTES;
  const cutoff = ctx.cutoffMinute ?? DEFAULT_STUDY_CUTOFF;
  const busy = busyOn(day, ctx);
  const from = Math.ceil(notBefore / STEP) * STEP;
  const candidates: number[] = [];
  for (let t = Math.max(PREFERRED_START, from); t + length <= cutoff; t += STEP) candidates.push(t);
  for (let t = Math.max(EARLIEST_START, from); t < PREFERRED_START && t + length <= cutoff; t += STEP) candidates.push(t);
  return candidates.find((t) => busy.every(([s, e]) => t + length <= s || t >= e)) ?? null;
}

/** The first moment a session may start today: half an hour from now. */
function notBeforeOn(day: string, ctx: PlanContext): number {
  return day === dayKey(ctx.now, ctx.tz) ? minuteOfDay(ctx.now, ctx.tz) + 30 : 0;
}

/**
 * A plan for an exam: one session on each of the PLAN_OFFSETS days before
 * it that are still ahead (so 5 for an exam a week out, 1 for an exam
 * tomorrow, none for one today), each at the first free time that day.
 * A day with no free time is left out rather than squeezed.
 */
export function planExamPrep(examAt: Date, ctx: PlanContext): { startsAt: Date; minutes: number }[] {
  const examDay = dayKey(examAt, ctx.tz);
  const today = dayKey(ctx.now, ctx.tz);
  const days = PLAN_OFFSETS.map((o) => addDays(examDay, -o)).filter((d) => d >= today);
  const taken = [...ctx.taken];
  const minutes = ctx.sessionMinutes ?? SESSION_MINUTES;
  const plan: { startsAt: Date; minutes: number }[] = [];
  for (const day of days) {
    const slot = firstFreeSlot(day, { ...ctx, taken }, notBeforeOn(day, ctx));
    if (slot === null) continue;
    const session = { startsAt: atMinute(day, slot, ctx.tz), minutes };
    plan.push(session);
    taken.push(session);
  }
  return plan;
}

/**
 * Where a missed session goes: the first free time from now until the day
 * before the exam, on a day that doesn't already have one of this exam's
 * sessions. Null when there's no room left before the exam.
 */
export function rescheduleMissed(
  examAt: Date,
  planDays: string[],
  ctx: PlanContext
): Date | null {
  const examDay = dayKey(examAt, ctx.tz);
  for (let day = dayKey(ctx.now, ctx.tz); day < examDay; day = addDays(day, 1)) {
    if (planDays.includes(day)) continue;
    const slot = firstFreeSlot(day, ctx, notBeforeOn(day, ctx));
    if (slot !== null) return atMinute(day, slot, ctx.tz);
  }
  return null;
}

/** A planned session whose time has passed without being marked done or skipped. */
export function isMissed(session: { startsAt: Date; minutes: number; status: string }, now: Date): boolean {
  return session.status === "PLANNED" && session.startsAt.getTime() + session.minutes * 60_000 < now.getTime();
}

/** This week, Monday 00:00 to the next Monday, in the student's time zone. */
export function weekBounds(now: Date, tz: string): { start: Date; end: Date } {
  const today = dayKey(now, tz);
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  return { start: atMinute(monday, 0, tz), end: atMinute(addDays(monday, 7), 0, tz) };
}

/** "2 of 5 done", counting what's done against everything not skipped. */
export function planProgress(sessions: { status: string }[]): { done: number; total: number } {
  const kept = sessions.filter((s) => s.status !== "SKIPPED");
  return { done: kept.filter((s) => s.status === "DONE").length, total: kept.length };
}
