// Weekly class meetings (ScheduleEvent rows, one per weekday): whether a
// meeting happens on a given date, given its semester dates; a class's rows
// grouped back into "Mon, Wed, Fri 10:00 AM–10:50 AM"; and the labels for
// both. Pure, so it's easy to test.

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekdays in the order a student's week reads: Monday first, Sunday last. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** First and last day a weekly meeting happens ("2026-08-25", the student's calendar date); null for no limit. */
export interface MeetingDates {
  startsOn: string | null;
  endsOn: string | null;
}

export interface MeetingRow extends MeetingDates {
  id: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startMinute: number;
  endMinute: number;
  location: string | null;
  label: string | null;
}

export interface MeetingGroup extends MeetingDates {
  ids: string[];
  days: number[]; // WEEK_ORDER order
  startMinute: number;
  endMinute: number;
  location: string | null;
  label: string | null;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a meeting is on for `day` ("2026-09-14"); the caller checks the weekday. */
export function meetingRunsOn(m: MeetingDates, day: string): boolean {
  return (!m.startsOn || day >= m.startsOn) && (!m.endsOn || day <= m.endsOn);
}

/** A meeting whose last day is before `today` ("2026-12-20"): the semester is over. */
export function meetingHasEnded(m: MeetingDates, today: string): boolean {
  return m.endsOn !== null && today > m.endsOn;
}

const weekIndex = (day: number) => WEEK_ORDER.indexOf(day);

/**
 * A class's meeting rows grouped by everything but the weekday, so the
 * Monday, Wednesday and Friday rows added together read as one meeting.
 * Groups come in week order, then by start time.
 */
export function groupMeetings(rows: MeetingRow[]): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();
  for (const row of rows) {
    const key = JSON.stringify([row.startMinute, row.endMinute, row.location, row.label, row.startsOn, row.endsOn]);
    const group = groups.get(key);
    if (group) {
      group.ids.push(row.id);
      if (!group.days.includes(row.dayOfWeek)) group.days.push(row.dayOfWeek);
    } else {
      groups.set(key, {
        ids: [row.id],
        days: [row.dayOfWeek],
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        location: row.location,
        label: row.label,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      });
    }
  }
  const list = [...groups.values()];
  for (const g of list) g.days.sort((a, b) => weekIndex(a) - weekIndex(b));
  return list.sort((a, b) => weekIndex(a.days[0]) - weekIndex(b.days[0]) || a.startMinute - b.startMinute);
}

/** "Mon, Wed, Fri"; "Mon–Fri" for every weekday; "Every day" for all seven. */
export function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => weekIndex(a) - weekIndex(b));
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Mon–Fri";
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

/** "9:00 AM" from minutes after midnight. */
export function timeLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

function dateLabel(day: string, withYear: boolean): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Aug 25 – Dec 12", "From Aug 25", "Until Dec 12", or null when the meeting has no dates. */
export function formatMeetingDates(m: MeetingDates): string | null {
  if (m.startsOn && m.endsOn) {
    const years = m.startsOn.slice(0, 4) !== m.endsOn.slice(0, 4);
    return `${dateLabel(m.startsOn, years)} – ${dateLabel(m.endsOn, years)}`;
  }
  if (m.startsOn) return `From ${dateLabel(m.startsOn, false)}`;
  if (m.endsOn) return `Until ${dateLabel(m.endsOn, false)}`;
  return null;
}

/**
 * The semester dates to start the next meeting from: the last ones the
 * student used, unless that semester is over (then a new meeting would
 * never show up).
 */
export function semesterToReuse(last: MeetingDates | null, today: string): MeetingDates | null {
  if (!last || (!last.startsOn && !last.endsOn) || meetingHasEnded(last, today)) return null;
  return { startsOn: last.startsOn, endsOn: last.endsOn };
}

/** The weekdays picked in a form (any number of "dayOfWeek" values), deduplicated; invalid ones dropped. */
export function parseMeetingDays(values: unknown[]): number[] {
  const days = values.map((v) => Number(v)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(days)].sort((a, b) => weekIndex(a) - weekIndex(b));
}
