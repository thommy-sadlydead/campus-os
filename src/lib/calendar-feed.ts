import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dayKey } from "@/lib/time";
import type { MeetingDates } from "@/lib/meetings";

// A student's weekly class meetings as an iCalendar feed (RFC 5545) that
// Apple, Google and Outlook Calendar subscribe to: one VEVENT per meeting
// row, repeating weekly in the student's time zone (so a 9:00 class stays
// at 9:00 across daylight saving), until the meeting's last day. Pure; the
// route and the secret link are in calendar-feed-server.ts.

export interface FeedMeeting extends MeetingDates {
  id: string;
  className: string;
  classCode: string | null;
  /** The class's page in Campus OS, for the event's link. */
  classUrl: string | null;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startMinute: number;
  endMinute: number;
  location: string | null;
  label: string | null;
  /** When it was added: the first week of a meeting with no first day. */
  createdAt: Date;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The first `dayOfWeek` on or after `from` ("2026-08-25"). */
export function firstOccurrence(dayOfWeek: number, from: string): string {
  const start = parseDay(from);
  return formatDay(new Date(start.getTime() + ((dayOfWeek - start.getUTCDay() + 7) % 7) * DAY_MS));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "20260825T090000": a wall-clock time, read in the event's TZID. */
function localStamp(day: string, minute: number): string {
  return `${day.replaceAll("-", "")}T${pad(Math.floor(minute / 60))}${pad(minute % 60)}00`;
}

/** "20260825T130000Z" */
function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 bytes continue on the next line after a space (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // the leading space counts
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** `tz`'s UTC offset in minutes at the moment `t`. (date-fns-tz's getTimezoneOffset reads its date as a wall-clock time, not a moment.) */
function offsetAt(t: number, tz: string): number {
  const [sign, hh, mm] = formatInTimeZone(new Date(t), tz, "xxx").match(/^([+-])(\d{2}):(\d{2})$/)!.slice(1);
  return (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm));
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** The moments in `year` when `tz` changes its UTC offset (daylight saving starting and ending). */
export function offsetChanges(tz: string, year: number): { at: number; from: number; to: number }[] {
  const changes: { at: number; from: number; to: number }[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let previous = offsetAt(Date.UTC(year, 0, 1), tz);
  for (let t = Date.UTC(year, 0, 1); t < end; t += DAY_MS) {
    const next = offsetAt(t + DAY_MS, tz);
    if (next === previous) continue;
    // Narrow the change down to the minute.
    let lo = t;
    let hi = t + DAY_MS;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (offsetAt(mid, tz) === previous) lo = mid;
      else hi = mid;
    }
    changes.push({ at: hi, from: previous, to: next });
    previous = next;
  }
  return changes;
}

/**
 * The VTIMEZONE block for `tz`, with each yearly change as a rule like "the
 * second Sunday of March" taken from `year`'s changes. Apple and Google read
 * the IANA name in TZID anyway; this is for calendars that don't.
 */
export function vtimezone(tz: string, year: number): string[] {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
  const changes = offsetChanges(tz, year);
  if (changes.length === 0) {
    const offset = formatOffset(offsetAt(Date.UTC(year, 0, 1), tz));
    lines.push("BEGIN:STANDARD", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, "DTSTART:19700101T000000", "END:STANDARD");
  }
  for (const change of changes) {
    // The wall-clock moment of the change, on the clock it changes from.
    const local = new Date(change.at + change.from * 60_000);
    const day = local.getUTCDate();
    const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
    const nth = day + 7 > daysInMonth ? -1 : Math.ceil(day / 7);
    const kind = change.to > change.from ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      `TZOFFSETFROM:${formatOffset(change.from)}`,
      `TZOFFSETTO:${formatOffset(change.to)}`,
      `DTSTART:${localStamp(formatDay(local), local.getUTCHours() * 60 + local.getUTCMinutes())}`,
      `RRULE:FREQ=YEARLY;BYMONTH=${local.getUTCMonth() + 1};BYDAY=${nth}${BYDAY[local.getUTCDay()]}`,
      `END:${kind}`
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

function eventLines(m: FeedMeeting, tz: string, now: Date): string[] | null {
  const first = firstOccurrence(m.dayOfWeek, m.startsOn ?? dayKey(m.createdAt, tz));
  if (m.endsOn && first > m.endsOn) return null; // never happens
  const rule = [`FREQ=WEEKLY`, `BYDAY=${BYDAY[m.dayOfWeek]}`];
  // UNTIL is in UTC when DTSTART has a TZID: the end of the last day there.
  if (m.endsOn) rule.push(`UNTIL=${utcStamp(fromZonedTime(`${m.endsOn}T23:59:59`, tz))}`);

  const description = [m.classCode, m.classUrl ? `Open in Campus OS: ${m.classUrl}` : null].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:meeting-${m.id}@campus-os`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=${tz}:${localStamp(first, m.startMinute)}`,
    `DTEND;TZID=${tz}:${localStamp(first, m.endMinute)}`,
    `RRULE:${rule.join(";")}`,
    `SUMMARY:${escapeText(m.label ? `${m.className} (${m.label})` : m.className)}`,
  ];
  if (m.location) lines.push(`LOCATION:${escapeText(m.location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (m.classUrl) lines.push(`URL:${m.classUrl}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendarFeed(input: { meetings: FeedMeeting[]; tz: string; now: Date; name?: string }): string {
  const { tz, now } = input;
  const events = input.meetings.map((m) => eventLines(m, tz, now)).filter((e): e is string[] => e !== null);
  const firstYear = Math.min(
    now.getUTCFullYear(),
    ...input.meetings.map((m) => Number((m.startsOn ?? dayKey(m.createdAt, tz)).slice(0, 4)))
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Campus OS//Class meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name ?? "Campus OS classes")}`,
    `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    // A year before the first meeting, so every event falls inside it.
    ...(events.length ? vtimezone(tz, firstYear - 1) : []),
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
