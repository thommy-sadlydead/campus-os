import { describe, expect, it } from "vitest";
import {
  formatDays,
  formatMeetingDates,
  groupMeetings,
  meetingHasEnded,
  meetingTimeProblem,
  minutesFromTimeField,
  meetingRunsOn,
  parseMeetingDays,
  semesterToReuse,
  timeLabel,
  type MeetingRow,
} from "../src/lib/meetings";

const row = (id: string, dayOfWeek: number, extra: Partial<MeetingRow> = {}): MeetingRow => ({
  id,
  dayOfWeek,
  startMinute: 10 * 60,
  endMinute: 10 * 60 + 50,
  location: "Science Center 210",
  label: "Lecture",
  startsOn: null,
  endsOn: null,
  ...extra,
});

describe("meetingRunsOn", () => {
  it("runs every week with no dates", () => {
    expect(meetingRunsOn({ startsOn: null, endsOn: null }, "2031-01-01")).toBe(true);
  });

  it("runs from the first day through the last, both included", () => {
    const fall = { startsOn: "2026-08-25", endsOn: "2026-12-12" };
    expect(meetingRunsOn(fall, "2026-08-24")).toBe(false);
    expect(meetingRunsOn(fall, "2026-08-25")).toBe(true);
    expect(meetingRunsOn(fall, "2026-12-12")).toBe(true);
    expect(meetingRunsOn(fall, "2026-12-13")).toBe(false);
  });

  it("takes just a first day or just a last day", () => {
    expect(meetingRunsOn({ startsOn: "2026-08-25", endsOn: null }, "2027-05-01")).toBe(true);
    expect(meetingRunsOn({ startsOn: null, endsOn: "2026-12-12" }, "2026-12-13")).toBe(false);
  });
});

describe("meetingHasEnded", () => {
  it("ends the day after the last day", () => {
    expect(meetingHasEnded({ startsOn: null, endsOn: "2026-12-12" }, "2026-12-12")).toBe(false);
    expect(meetingHasEnded({ startsOn: null, endsOn: "2026-12-12" }, "2026-12-13")).toBe(true);
    expect(meetingHasEnded({ startsOn: "2026-08-25", endsOn: null }, "2030-01-01")).toBe(false);
  });
});

describe("groupMeetings", () => {
  it("groups the days of one meeting, Monday first", () => {
    const groups = groupMeetings([row("f", 5), row("m", 1), row("w", 3)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].days).toEqual([1, 3, 5]);
    expect(groups[0].ids.sort()).toEqual(["f", "m", "w"]);
  });

  it("keeps meetings apart when the time, room, type or dates differ", () => {
    const groups = groupMeetings([
      row("lec-mon", 1),
      row("lec-wed", 3),
      row("lab", 4, { startMinute: 14 * 60, endMinute: 16 * 60, label: "Lab" }),
      row("spring", 1, { startsOn: "2027-01-12" }),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["lec-mon", "lec-wed"], ["spring"], ["lab"]]);
  });

  it("orders groups by their first day, then start time, with Sunday last", () => {
    const groups = groupMeetings([
      row("sun", 0, { label: "Review" }),
      row("tue-late", 2, { startMinute: 15 * 60, endMinute: 16 * 60 }),
      row("tue-early", 2, { startMinute: 8 * 60, endMinute: 9 * 60 }),
    ]);
    expect(groups.map((g) => g.ids[0])).toEqual(["tue-early", "tue-late", "sun"]);
  });
});

describe("formatDays", () => {
  it("lists days in week order", () => {
    expect(formatDays([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(formatDays([0, 6])).toBe("Sat, Sun");
  });

  it("shortens every weekday and every day", () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(formatDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });
});

describe("formatMeetingDates", () => {
  it("formats a semester", () => {
    expect(formatMeetingDates({ startsOn: "2026-08-25", endsOn: "2026-12-12" })).toBe("Aug 25 – Dec 12");
  });

  it("adds years when the semester crosses one", () => {
    expect(formatMeetingDates({ startsOn: "2026-12-28", endsOn: "2027-01-15" })).toBe("Dec 28, 2026 – Jan 15, 2027");
  });

  it("formats one-sided dates, or nothing", () => {
    expect(formatMeetingDates({ startsOn: "2026-08-25", endsOn: null })).toBe("From Aug 25");
    expect(formatMeetingDates({ startsOn: null, endsOn: "2026-12-12" })).toBe("Until Dec 12");
    expect(formatMeetingDates({ startsOn: null, endsOn: null })).toBeNull();
  });
});

describe("timeLabel", () => {
  it("uses a 12-hour clock", () => {
    expect(timeLabel(0)).toBe("12:00 AM");
    expect(timeLabel(9 * 60 + 5)).toBe("9:05 AM");
    expect(timeLabel(12 * 60)).toBe("12:00 PM");
    expect(timeLabel(13 * 60 + 50)).toBe("1:50 PM");
  });
});

describe("parseMeetingDays", () => {
  it("keeps valid weekdays once each, in week order", () => {
    expect(parseMeetingDays(["5", "1", "3", "1"])).toEqual([1, 3, 5]);
  });

  it("drops anything that isn't a weekday", () => {
    expect(parseMeetingDays(["7", "-1", "x", "", "2.5", "0"])).toEqual([0]);
  });
});

describe("semesterToReuse", () => {
  it("reuses a semester that isn't over", () => {
    expect(semesterToReuse({ startsOn: "2026-08-25", endsOn: "2026-12-12" }, "2026-11-03")).toEqual({
      startsOn: "2026-08-25",
      endsOn: "2026-12-12",
    });
  });

  it("starts blank after the semester ends, or without one", () => {
    expect(semesterToReuse({ startsOn: "2026-08-25", endsOn: "2026-12-12" }, "2026-12-13")).toBeNull();
    expect(semesterToReuse({ startsOn: null, endsOn: null }, "2026-11-03")).toBeNull();
    expect(semesterToReuse(null, "2026-11-03")).toBeNull();
  });
});

describe("meetingTimeProblem and minutesFromTimeField", () => {
  it("reads a time field", () => {
    expect(minutesFromTimeField("13:50")).toBe(13 * 60 + 50);
    expect(minutesFromTimeField("")).toBeNull();
    expect(minutesFromTimeField("1:50")).toBeNull();
  });

  it("refuses an end before or at the start", () => {
    expect(meetingTimeProblem({ startMinute: 600, endMinute: 540, startsOn: null, endsOn: null })).toMatch(/end time/);
    expect(meetingTimeProblem({ startMinute: 600, endMinute: 600, startsOn: null, endsOn: null })).toMatch(/end time/);
  });

  it("refuses a last day before the first", () => {
    expect(meetingTimeProblem({ startMinute: 600, endMinute: 650, startsOn: "2026-12-11", endsOn: "2026-08-24" })).toMatch(/last day/);
  });

  it("accepts a normal meeting", () => {
    expect(meetingTimeProblem({ startMinute: 600, endMinute: 650, startsOn: "2026-08-24", endsOn: "2026-12-11" })).toBeNull();
    expect(meetingTimeProblem({ startMinute: 600, endMinute: 650, startsOn: null, endsOn: null })).toBeNull();
  });
});
