import { describe, expect, it } from "vitest";
import { dueShort, freeGaps, meetingLabel, nextMeetingAt, shortRange } from "../src/lib/today";

const TZ = "America/New_York";
// Friday, Nov 6, 2026, 2:00 PM in New York.
const NOW = new Date("2026-11-06T19:00:00Z");

describe("due text", () => {
  it("keeps the due text short", () => {
    const at = new Date("2026-11-07T04:59:00Z");
    expect(dueShort("TODAY", at, TZ)).toBe("11:59 PM");
    expect(dueShort("THIS_WEEK", at, TZ)).toBe("Fri 11:59 PM");
    expect(dueShort("OVERDUE", at, TZ)).toBe("Nov 6");
    expect(dueShort("LATER", null, TZ)).toBeNull();
  });
});

describe("nextMeetingAt", () => {
  const mwf9 = [1, 3, 5].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, startsOn: null, endsOn: null }));

  it("skips a meeting that already started today and finds the next one", () => {
    const next = nextMeetingAt(mwf9, NOW, TZ)!;
    expect(meetingLabel(next, NOW, TZ)).toBe("Mon 9:00 AM");
  });

  it("is later today when the class hasn't started, and none when the semester's over", () => {
    const at4 = [{ dayOfWeek: 5, startMinute: 16 * 60, startsOn: null, endsOn: null }];
    expect(meetingLabel(nextMeetingAt(at4, NOW, TZ)!, NOW, TZ)).toBe("Today 4:00 PM");
    expect(nextMeetingAt([{ ...at4[0], endsOn: "2026-11-01" }], NOW, TZ)).toBeNull();
  });
});

describe("freeGaps", () => {
  it("finds the open stretches of an hour or more between the day's blocks", () => {
    const gaps = freeGaps([
      { start: 9 * 60, end: 9 * 60 + 50 },
      { start: 10 * 60, end: 10 * 60 + 50 },
      { start: 13 * 60, end: 14 * 60 + 30 },
    ]);
    expect(gaps.map((g) => shortRange(g.start, g.end))).toEqual(["8:00–9:00", "10:50–1:00", "2:30–8:00"]);
  });

  it("starts today's from now, and says nothing for an empty day", () => {
    const gaps = freeGaps([{ start: 9 * 60, end: 10 * 60 }], { notBefore: 13 * 60 + 5 });
    expect(gaps.map((g) => shortRange(g.start, g.end))).toEqual(["1:15–8:00"]);
    expect(freeGaps([])).toEqual([]);
  });
});
