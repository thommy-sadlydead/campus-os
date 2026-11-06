import { describe, expect, it } from "vitest";
import { dayTimeline, dueBadge, dueShort, dueThisWeek, freeGaps, meetingLabel, nextMeetingAt, shortRange, weekDays } from "../src/lib/today";
import type { PriorityResult } from "../src/lib/priority-engine";

const TZ = "America/New_York";
// Friday, Nov 6, 2026, 2:00 PM in New York.
const NOW = new Date("2026-11-06T19:00:00Z");

function due(assignmentId: string, iso: string): PriorityResult {
  return {
    item: {
      id: assignmentId,
      assignmentId,
      kind: "assignment",
      title: assignmentId,
      className: "Biology",
      classColor: 1,
      dueAt: new Date(iso),
      estimatedMinutes: null,
      pointsPossible: null,
      status: "NOT_STARTED",
      isExamLinked: false,
      description: null,
      lmsLink: null,
    },
    score: 0,
    bucket: "THIS_WEEK",
    color: "gray",
    reason: "",
  } as PriorityResult;
}

describe("weekDays", () => {
  it("is Monday to Sunday of this week, with what's due each day (an assignment counts once)", () => {
    const ranked = [
      due("a", "2026-11-04T15:00:00Z"), // Wed
      due("b", "2026-11-07T04:59:00Z"), // Fri 11:59 PM in New York
      due("b", "2026-11-07T04:59:00Z"), // b's second step: still one assignment
      due("c", "2026-11-08T16:00:00Z"), // Sun
    ];
    const week = weekDays(ranked, NOW, TZ);
    expect(week.map((d) => `${d.label} ${d.date}:${d.due}`)).toEqual(["Mon 2:0", "Tue 3:0", "Wed 4:1", "Thu 5:0", "Fri 6:1", "Sat 7:0", "Sun 8:1"]);
    expect(week.find((d) => d.isToday)?.key).toBe("2026-11-06");
    expect(week.filter((d) => d.isPast).map((d) => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu"]);
    // Due this week counts today through Sunday, not what's overdue.
    expect(dueThisWeek(ranked, NOW, TZ)).toBe(2);
  });
});

describe("dayTimeline", () => {
  it("spans 7 AM to 10 PM unless something runs outside, with classes and free time in order", () => {
    const t = dayTimeline(
      [{ startMinute: 9 * 60, endMinute: 9 * 60 + 50, label: "BIO" }],
      [{ startMinute: 15 * 60, endMinute: 16 * 60, label: null }]
    );
    expect([t.start, t.end]).toEqual([7 * 60, 22 * 60]);
    expect(t.segments.map((s) => `${s.kind}:${s.label}`)).toEqual(["class:BIO", "free:Free time"]);
    expect(dayTimeline([{ startMinute: 6 * 60 + 30, endMinute: 23 * 60 + 10, label: "Lab" }], []).start).toBe(6 * 60);
  });
});

describe("badges and due text", () => {
  it("says urgent things in red, this week outlined, later in gray", () => {
    expect(dueBadge("TOMORROW")).toEqual({ text: "Due tomorrow", tone: "urgent" });
    expect(dueBadge("THIS_WEEK").tone).toBe("soon");
    expect(dueBadge("LATER").tone).toBe("later");
  });

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
