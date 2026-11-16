// Which LMS items are exams, and the date in an exam's name. Pure; tested in
// tests/lms-exams.test.ts.

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Whether an assignment or calendar item is an exam, from its name. Plain
 * "final" used to count, which made "Final Draft: Rhetorical Analysis" and
 * "Final Presentation" exams; now it takes "exam", "midterm" or "final
 * exam" ("Final Exam" contains "exam"). Things about an exam that aren't
 * the exam itself (a review, a practice exam, an exam wrapper) don't count.
 */
export function isExamLikeName(name: string): boolean {
  if (!/\b(exams?|examination|midterms?|mid-terms?)\b/i.test(name)) return false;
  return !/\b(review|prep|practice|study guide|wrapper|reflection|corrections?)\b/i.test(name);
}

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The calendar's exams that aren't already an exam assignment. Professors
 * often put an exam in the gradebook and on the calendar under the same
 * name ("Exam 2"), which would otherwise list it twice.
 */
export function calendarOnlyExams<T extends { name: string }>(calendarExams: T[], assignmentExamNames: string[]): T[] {
  const taken = new Set(assignmentExamNames.map(normalized));
  return calendarExams.filter((exam) => !taken.has(normalized(exam.name)));
}

const MONTH_NUMBERS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_DAY_YEAR =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+((?:19|20)\d{2})\b)?/gi;
const NUMERIC_DATE = /(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;

interface NamedDate {
  month: number;
  day: number;
  year: number | null;
}

function validDay(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * The date written in an exam's name, for an exam the LMS gave no date:
 * "Exam #2 – October 30th", "Midterm (Oct. 14)", "Exam 3 10/30". The time
 * is the end of that day in the student's time zone (23:59), the same as
 * every other date that comes with no time of day.
 *
 * It only answers when the name holds exactly one date, and says null
 * otherwise ("Oct 30 or Nov 1 makeup" is two). With no year in the name,
 * the year is whichever puts the date closest to `now`: an October 30 exam
 * seen in November is last month's, one seen in late December whose name
 * says "January 15" is next month's. Pure; tested in tests/lms-exams.test.ts.
 */
export function examDateFromName(name: string, now: Date, tz: string): Date | null {
  const found: NamedDate[] = [];
  for (const m of name.matchAll(MONTH_DAY_YEAR)) {
    found.push({ month: MONTH_NUMBERS[m[1].toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  for (const m of name.matchAll(NUMERIC_DATE)) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    found.push({ month: Number(m[1]), day: Number(m[2]), year });
  }
  const distinct = new Map(found.map((d) => [`${d.year ?? "-"}-${d.month}-${d.day}`, d]));
  if (distinct.size !== 1) return null;
  const { month, day, year } = [...distinct.values()][0];
  if (month < 1 || month > 12 || day < 1) return null;

  const thisYear = Number(formatInTimeZone(now, tz, "yyyy"));
  const years = year ? [year] : [thisYear - 1, thisYear, thisYear + 1];
  let best: Date | null = null;
  for (const y of years) {
    if (!validDay(y, month, day)) continue;
    const at = fromZonedTime(`${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:00`, tz);
    if (!best || Math.abs(at.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = at;
  }
  return best;
}
