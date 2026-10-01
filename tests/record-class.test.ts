import { describe, expect, it } from "vitest";
import { defaultLectureTitle, inboxPickTime, localDayAndMinute, suggestClassToRecord, type ScheduleSlot } from "../src/lib/record-class";
import { markdownPreview } from "../src/lib/markdown";

const TZ = "America/New_York";

// Tue Sep 29 2026. New York is on EDT (UTC-4) then.
const at = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00-04:00`);

const MWF_MICRO: ScheduleSlot = { classId: "micro", dayOfWeek: 1, startMinute: 9 * 60, endMinute: 9 * 60 + 50 };
const TUE_COMP: ScheduleSlot = { classId: "comp", dayOfWeek: 2, startMinute: 10 * 60 + 30, endMinute: 11 * 60 + 45 };
const TUE_STATS: ScheduleSlot = { classId: "stats", dayOfWeek: 2, startMinute: 13 * 60, endMinute: 14 * 60 + 15 };
const SLOTS = [MWF_MICRO, TUE_COMP, TUE_STATS];

describe("localDayAndMinute", () => {
  it("uses the student's time zone, not UTC", () => {
    // 01:30 UTC on Wednesday is still 21:30 Tuesday in New York.
    expect(localDayAndMinute(new Date("2026-09-30T01:30:00Z"), TZ)).toEqual({ dayOfWeek: 2, minute: 21 * 60 + 30 });
  });

  it("maps Sunday to 0", () => {
    expect(localDayAndMinute(new Date("2026-10-04T12:00:00-04:00"), TZ).dayOfWeek).toBe(0);
  });
});

describe("suggestClassToRecord", () => {
  it("picks the class in session", () => {
    expect(suggestClassToRecord(SLOTS, at("11:00"), TZ)).toEqual({ classId: "comp", reason: "in-session" });
  });

  it("counts the first and last minute of class as in session", () => {
    expect(suggestClassToRecord(SLOTS, at("10:30"), TZ)?.reason).toBe("in-session");
    expect(suggestClassToRecord(SLOTS, at("11:45"), TZ)?.reason).toBe("in-session");
  });

  it("picks a class starting within 15 minutes", () => {
    expect(suggestClassToRecord(SLOTS, at("12:50"), TZ)).toEqual({ classId: "stats", reason: "starting-soon" });
  });

  it("picks a class that ended within 15 minutes", () => {
    expect(suggestClassToRecord(SLOTS, at("11:55"), TZ)).toEqual({ classId: "comp", reason: "just-ended" });
  });

  it("suggests nothing between classes or on other days' schedules", () => {
    expect(suggestClassToRecord(SLOTS, at("12:10"), TZ)).toBeNull();
    // Micro meets Mondays at 9:00, not Tuesdays.
    expect(suggestClassToRecord(SLOTS, at("09:20"), TZ)).toBeNull();
  });

  it("returns null with no schedule at all", () => {
    expect(suggestClassToRecord([], at("11:00"), TZ)).toBeNull();
  });
});

describe("defaultLectureTitle", () => {
  it("dates the title in the student's time zone", () => {
    expect(defaultLectureTitle(new Date("2026-09-30T01:30:00Z"), TZ)).toBe("Lecture — Tue, Sep 29");
  });
});

describe("markdownPreview", () => {
  it("strips markdown syntax but keeps the words", () => {
    const md = "## Overview\n\n**Key idea:** God's covenant with Abraham.\n- Genesis 12: the promise\n- *Genesis 15*: ratified";
    expect(markdownPreview(md)).toBe("Overview Key idea: God's covenant with Abraham. Genesis 12: the promise Genesis 15: ratified");
  });

  it("keeps link text and drops URLs", () => {
    expect(markdownPreview("See [the syllabus](https://example.edu/syllabus.pdf) for dates.")).toBe(
      "See the syllabus for dates."
    );
  });

  it("leaves snake_case words alone", () => {
    expect(markdownPreview("Use file_name_here in `code`.")).toBe("Use file_name_here in code.");
  });

  it("flattens tables", () => {
    expect(markdownPreview("| Term | Meaning |\n|---|---|\n| GDP | Output |")).toBe("Term Meaning GDP Output");
  });

  it("truncates long notes with an ellipsis", () => {
    const preview = markdownPreview("word ".repeat(200), 50);
    expect(preview.length).toBeLessThanOrEqual(50);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("inboxPickTime", () => {
  it("uses the middle of a shared recording, so one started before class still lands in it", () => {
    // Started at 9:56 for a 10:00-10:50 class, 54 minutes long: middle is 10:23.
    const when = inboxPickTime({ recordedAt: "2026-09-29T13:56:00Z", durationSeconds: 54 * 60 });
    expect(when?.toISOString()).toBe("2026-09-29T14:23:00.000Z");
  });

  it("falls back to the start, and to nothing when the file doesn't say", () => {
    expect(inboxPickTime({ recordedAt: "2026-09-29T13:56:00Z" })?.toISOString()).toBe("2026-09-29T13:56:00.000Z");
    expect(inboxPickTime({})).toBeNull();
    expect(inboxPickTime({ recordedAt: "not a date" })).toBeNull();
  });
});
