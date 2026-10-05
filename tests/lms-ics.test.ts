import { describe, it, expect } from "vitest";
import { parseIcs, parseIcsDate, unescapeText } from "../src/lib/lms/ics";

const TZ = "America/New_York";

describe("parseIcsDate", () => {
  it("reads UTC, TZID and floating times", () => {
    expect(parseIcsDate("20261015T035900Z", {}, TZ)).toEqual({ date: new Date("2026-10-15T03:59:00Z"), allDay: false });
    expect(parseIcsDate("20261014T235900", { TZID: "America/Chicago" }, TZ)?.date.toISOString()).toBe("2026-10-15T04:59:00.000Z");
    // Floating: the student's own zone.
    expect(parseIcsDate("20261014T235900", {}, TZ)?.date.toISOString()).toBe("2026-10-15T03:59:00.000Z");
  });

  it("reads a TZID it doesn't know (a Windows zone name) in the student's zone", () => {
    expect(parseIcsDate("20261014T235900", { TZID: "Eastern Standard Time" }, TZ)?.date.toISOString()).toBe(
      "2026-10-15T03:59:00.000Z"
    );
  });

  it("makes a date with no time the end of that day", () => {
    expect(parseIcsDate("20261014", { VALUE: "DATE" }, TZ)).toEqual({ date: new Date("2026-10-15T03:59:00Z"), allDay: true });
  });

  it("returns null for something that isn't a date", () => {
    expect(parseIcsDate("next tuesday", {}, TZ)).toBeNull();
  });
});

describe("unescapeText", () => {
  it("undoes iCalendar's text escapes", () => {
    expect(unescapeText("Read ch. 3\\, 4\\; then \\\\ write\\nnotes")).toBe("Read ch. 3, 4; then \\ write\nnotes");
  });
});

describe("parseIcs", () => {
  it("reads events and to-dos, unfolding long lines and skipping alarms", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:My Courses",
      "BEGIN:VEVENT",
      "UID:evt-1@school",
      "SUMMARY:Lab report on cell",
      "  respiration - Due",
      "DESCRIPTION:Upload a PDF\\, two pages.",
      "DTSTART:20261015T035900Z",
      "DTEND:20261015T035900Z",
      "URL;VALUE=URI:https://school.brightspace.com/d2l/le/calendar/123456/event/9/detailsview",
      "LOCATION:BIO 1000 - Biology",
      "BEGIN:VALARM",
      "SUMMARY:Reminder",
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
      "BEGIN:VTODO",
      "UID:todo-1",
      "SUMMARY:Read chapter 4",
      "DUE;VALUE=DATE:20261020",
      "CATEGORIES:HIST 1100,Readings",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");

    const calendar = parseIcs(ics, TZ);

    expect(calendar.name).toBe("My Courses");
    expect(calendar.events).toHaveLength(2);
    const [event, todo] = calendar.events;
    expect(event).toMatchObject({
      kind: "event",
      uid: "evt-1@school",
      summary: "Lab report on cell respiration - Due",
      description: "Upload a PDF, two pages.",
      url: "https://school.brightspace.com/d2l/le/calendar/123456/event/9/detailsview",
      location: "BIO 1000 - Biology",
    });
    expect(event.start?.date.toISOString()).toBe("2026-10-15T03:59:00.000Z");
    expect(todo).toMatchObject({ kind: "todo", uid: "todo-1", categories: ["HIST 1100", "Readings"] });
    expect(todo.due).toEqual({ date: new Date("2026-10-21T03:59:00Z"), allDay: true });
  });

  it("keeps a colon inside a quoted parameter out of the value", () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY;ALTREP="http://x.test/a:b":Midterm Exam\nDTSTART:20261015T140000Z\nEND:VEVENT\nEND:VCALENDAR';
    expect(parseIcs(ics, TZ).events[0].summary).toBe("Midterm Exam");
  });

  it("skips events without a title and doesn't throw on junk", () => {
    const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261015T140000Z\nEND:VEVENT\ngarbage line\nBEGIN:VEVENT\nSUMMARY:Ok\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseIcs(ics, TZ).events.map((e) => e.summary)).toEqual(["Ok"]);
    expect(parseIcs("not a calendar", TZ).events).toEqual([]);
  });
});
