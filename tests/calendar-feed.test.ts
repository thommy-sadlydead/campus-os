import { describe, expect, it } from "vitest";
import {
  buildCalendarFeed,
  escapeText,
  firstOccurrence,
  foldLine,
  offsetChanges,
  vtimezone,
  type FeedMeeting,
} from "../src/lib/calendar-feed";
import { parseIcs } from "../src/lib/lms/ics";

const TZ = "America/New_York";
const NOW = new Date("2026-11-03T17:00:00Z");

const meeting = (extra: Partial<FeedMeeting> = {}): FeedMeeting => ({
  id: "ev1",
  className: "Calculus I",
  classCode: "MATH-1710-01",
  classUrl: "https://app.campus-os.net/classes/c1",
  dayOfWeek: 1,
  startMinute: 10 * 60,
  endMinute: 10 * 60 + 50,
  location: "Science Center 210",
  label: "Lecture",
  startsOn: "2026-08-24",
  endsOn: "2026-12-11",
  createdAt: new Date("2026-08-20T12:00:00Z"),
  ...extra,
});

/** The feed's lines with folded lines joined back up. */
const linesOf = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("firstOccurrence", () => {
  it("finds the first weekday on or after a date", () => {
    expect(firstOccurrence(1, "2026-08-25")).toBe("2026-08-31"); // Tue → next Mon
    expect(firstOccurrence(2, "2026-08-25")).toBe("2026-08-25"); // the same day
    expect(firstOccurrence(0, "2026-12-31")).toBe("2027-01-03"); // across a year
  });
});

describe("buildCalendarFeed", () => {
  it("repeats a meeting weekly in the student's time zone until the semester's last day", () => {
    const lines = linesOf(buildCalendarFeed({ meetings: [meeting()], tz: TZ, now: NOW }));
    expect(lines).toContain("DTSTART;TZID=America/New_York:20260824T100000");
    expect(lines).toContain("DTEND;TZID=America/New_York:20260824T105000");
    // The end of Dec 11 in New York (EST) is 04:59:59 on Dec 12 in UTC.
    expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261212T045959Z");
    expect(lines).toContain("SUMMARY:Calculus I (Lecture)");
    expect(lines).toContain("LOCATION:Science Center 210");
    expect(lines).toContain("URL:https://app.campus-os.net/classes/c1");
    expect(lines).toContain("UID:meeting-ev1@campus-os");
  });

  it("starts the week it was added when there's no first day, and never ends without a last day", () => {
    // Nov 3, 03:00 UTC is still Monday Nov 2 in New York.
    const lines = linesOf(
      buildCalendarFeed({ meetings: [meeting({ startsOn: null, endsOn: null, createdAt: new Date("2026-11-03T03:00:00Z") })], tz: TZ, now: NOW })
    );
    expect(lines).toContain("DTSTART;TZID=America/New_York:20261102T100000");
    expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
  });

  it("leaves out a meeting that never happens", () => {
    // Its only possible Monday is after the last day.
    const ics = buildCalendarFeed({ meetings: [meeting({ startsOn: "2026-12-08", endsOn: "2026-12-11" })], tz: TZ, now: NOW });
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("escapes text and uses CRLF line endings, folding long lines", () => {
    const ics = buildCalendarFeed({
      meetings: [meeting({ className: "Bio, Lab; A\\B", label: null, classCode: "X".repeat(120) })],
      tz: TZ,
      now: NOW,
    });
    expect(linesOf(ics)).toContain("SUMMARY:Bio\\, Lab\\; A\\\\B");
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("reads back as the same weekly meeting", () => {
    const calendar = parseIcs(buildCalendarFeed({ meetings: [meeting()], tz: TZ, now: NOW }), "UTC");
    expect(calendar.events).toHaveLength(1);
    expect(calendar.events[0].summary).toBe("Calculus I (Lecture)");
    expect(calendar.events[0].location).toBe("Science Center 210");
  });

  it("names the calendar and its time zone, with no events when there are no meetings", () => {
    const lines = linesOf(buildCalendarFeed({ meetings: [], tz: TZ, now: NOW }));
    expect(lines).toContain("X-WR-CALNAME:Campus OS classes");
    expect(lines).toContain("X-WR-TIMEZONE:America/New_York");
    expect(lines).not.toContain("BEGIN:VTIMEZONE");
  });

  it("includes the time zone's rules from a year before the first meeting", () => {
    const lines = linesOf(buildCalendarFeed({ meetings: [meeting()], tz: TZ, now: NOW }));
    expect(lines).toContain("TZID:America/New_York");
    expect(lines).toContain("DTSTART:20250309T020000");
  });
});

describe("vtimezone", () => {
  it("describes US daylight saving as yearly rules", () => {
    const lines = vtimezone(TZ, 2025);
    expect(lines.join("\n")).toContain(
      ["BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "DTSTART:20250309T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT"].join("\n")
    );
    expect(lines.join("\n")).toContain(
      ["BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "DTSTART:20251102T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD"].join("\n")
    );
  });

  it("uses the last Sunday for European rules", () => {
    const text = vtimezone("Europe/London", 2025).join("\n");
    expect(text).toContain("DTSTART:20250330T010000\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
    expect(text).toContain("DTSTART:20251026T020000\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
  });

  it("handles the southern hemisphere, where daylight saving ends in April", () => {
    const changes = offsetChanges("Australia/Sydney", 2025);
    expect(changes.map((c) => [c.from, c.to])).toEqual([
      [660, 600],
      [600, 660],
    ]);
    const text = vtimezone("Australia/Sydney", 2025).join("\n");
    expect(text).toContain("BEGIN:STANDARD\nTZOFFSETFROM:+1100\nTZOFFSETTO:+1000\nDTSTART:20250406T030000");
    expect(text).toContain("BEGIN:DAYLIGHT\nTZOFFSETFROM:+1000\nTZOFFSETTO:+1100\nDTSTART:20251005T020000");
  });

  it("gives a zone without daylight saving one fixed offset", () => {
    expect(vtimezone("Asia/Tokyo", 2025)).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Tokyo",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
    ]);
  });
});

describe("escapeText and foldLine", () => {
  it("escapes the characters iCalendar reserves", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds by bytes without splitting a character", () => {
    const folded = foldLine(`DESCRIPTION:${"é".repeat(60)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"é".repeat(60)}`);
  });
});
