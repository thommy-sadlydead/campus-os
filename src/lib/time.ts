import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Timezone-aware date helpers. IMPORTANT: plain `Date` getters
// (getFullYear/getDate/etc.) reflect the *server process's* local
// timezone, which on most hosts (and in this project's dev sandbox) is
// UTC — not the student's timezone. "Is this due today?" must be answered
// in the student's timezone (User.timezone), not the server's, or a
// homework due at 11:59pm Eastern shows up as due "tomorrow" on a UTC
// server. Every day-boundary calculation below takes `tz` explicitly.

/** "2026-08-21" — the calendar date `instant` falls on, in `tz`. */
export function dayKey(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

export function isSameTzDay(a: Date, b: Date, tz: string): boolean {
  return dayKey(a, tz) === dayKey(b, tz);
}

/** The Date instant corresponding to local midnight of `instant`'s calendar day, in `tz`. */
export function startOfTzDay(instant: Date, tz: string): Date {
  return fromZonedTime(`${dayKey(instant, tz)}T00:00:00`, tz);
}

export function hoursUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export function minutesUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / (1000 * 60);
}

export function formatDueLabel(due: Date | null, now: Date, tz: string): string {
  if (!due) return "No due date";
  if (isSameTzDay(due, now, tz)) {
    return `Due today at ${formatTzTime(due, tz)}`;
  }
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (isSameTzDay(due, tomorrow, tz)) {
    return `Due tomorrow at ${formatTzTime(due, tz)}`;
  }
  if (due < now) {
    return `Was due ${formatInTimeZone(due, tz, "MMM d")}`;
  }
  return `Due ${formatInTimeZone(due, tz, "EEEE, MMM d")} at ${formatTzTime(due, tz)}`;
}

export function formatTzTime(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "h:mm a");
}

/**
 * A moment that already happened, like a last sync, in the student's
 * timezone: "today at 9:41 PM", "yesterday at 9:41 PM", "Sep 28 at 9:41 PM"
 * (with the year when it isn't this year). Never the server's clock.
 */
export function formatPastMoment(d: Date, now: Date, tz: string): string {
  const time = formatTzTime(d, tz);
  if (isSameTzDay(d, now, tz)) return `today at ${time}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isSameTzDay(d, yesterday, tz)) return `yesterday at ${time}`;
  const sameYear = formatInTimeZone(d, tz, "yyyy") === formatInTimeZone(now, tz, "yyyy");
  return `${formatInTimeZone(d, tz, sameYear ? "MMM d" : "MMM d, yyyy")} at ${time}`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
