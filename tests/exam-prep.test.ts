import { describe, expect, it } from "vitest";
import { firstFreeSlot, isMissed, planExamPrep, planProgress, rescheduleMissed, weekBounds, weekdayOf, type PlanContext } from "../src/lib/exam-prep";
import { dayKey, formatTzTime } from "../src/lib/time";

const TZ = "America/New_York";
// Wednesday Nov 4, 2026, 9:00 AM Eastern.
const NOW = new Date("2026-11-04T14:00:00Z");
// Thursday Nov 12, 10:00 AM Eastern: eight days out.
const EXAM = new Date("2026-11-12T15:00:00Z");

const ctx = (extra: Partial<PlanContext> = {}): PlanContext => ({ now: NOW, tz: TZ, weekly: [], taken: [], ...extra });
const label = (d: Date) => `${dayKey(d, TZ)} ${formatTzTime(d, TZ)}`;

describe("weekdayOf", () => {
  it("reads the weekday of a date", () => {
    expect(weekdayOf("2026-11-04")).toBe(3);
    expect(weekdayOf("2026-11-08")).toBe(0);
  });
});

describe("planExamPrep", () => {
  it("spreads five sessions over the week before, at 4 PM when the afternoon is free", () => {
    const plan = planExamPrep(EXAM, ctx());
    expect(plan.map((s) => label(s.startsAt))).toEqual([
      "2026-11-05 4:00 PM",
      "2026-11-07 4:00 PM",
      "2026-11-09 4:00 PM",
      "2026-11-10 4:00 PM",
      "2026-11-11 4:00 PM",
    ]);
    expect(plan.every((s) => s.minutes === 30)).toBe(true);
  });

  it("works around class and a work shift, with room on each side", () => {
    // Monday Nov 9: class 3:30–4:50 PM, work 5–9 PM.
    const weekly = [
      { dayOfWeek: 1, startMinute: 15 * 60 + 30, endMinute: 16 * 60 + 50, startsOn: null, endsOn: null },
      { dayOfWeek: 1, startMinute: 17 * 60, endMinute: 21 * 60, startsOn: null, endsOn: null },
    ];
    const plan = planExamPrep(EXAM, ctx({ weekly }));
    expect(label(plan[2].startsAt)).toBe("2026-11-09 9:15 PM");
  });

  it("falls back to the morning when the evening is full, and never past the cutoff", () => {
    const weekly = [{ dayOfWeek: 1, startMinute: 15 * 60, endMinute: 21 * 60 + 40, startsOn: null, endsOn: null }];
    const plan = planExamPrep(EXAM, ctx({ weekly, cutoffMinute: 22 * 60 }));
    expect(label(plan[2].startsAt)).toBe("2026-11-09 9:00 AM");
  });

  it("only plans the days left when the exam is close, and nothing for one today", () => {
    const tomorrow = new Date("2026-11-05T15:00:00Z");
    expect(planExamPrep(tomorrow, ctx()).map((s) => label(s.startsAt))).toEqual(["2026-11-04 4:00 PM"]);
    expect(planExamPrep(new Date("2026-11-04T20:00:00Z"), ctx())).toEqual([]);
  });

  it("starts today no sooner than half an hour from now", () => {
    const evening = new Date("2026-11-04T22:50:00Z"); // 5:50 PM Eastern
    const plan = planExamPrep(new Date("2026-11-05T15:00:00Z"), ctx({ now: evening }));
    expect(plan.map((s) => label(s.startsAt))).toEqual(["2026-11-04 6:30 PM"]);
  });

  it("doesn't stack two sessions at the same time", () => {
    const taken = [{ startsAt: new Date("2026-11-05T21:00:00Z"), minutes: 30 }]; // Nov 5, 4 PM
    const plan = planExamPrep(EXAM, ctx({ taken }));
    expect(label(plan[0].startsAt)).toBe("2026-11-05 4:45 PM");
  });

  it("skips meetings outside their semester dates", () => {
    const weekly = [{ dayOfWeek: 4, startMinute: 16 * 60, endMinute: 17 * 60, startsOn: "2027-01-10", endsOn: null }];
    expect(label(planExamPrep(EXAM, ctx({ weekly }))[0].startsAt)).toBe("2026-11-05 4:00 PM");
  });
});

describe("firstFreeSlot", () => {
  it("returns null for a day with no room", () => {
    const weekly = [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 23 * 60, startsOn: null, endsOn: null }];
    expect(firstFreeSlot("2026-11-09", ctx({ weekly }))).toBeNull();
  });
});

describe("rescheduleMissed", () => {
  it("moves a missed session to the next day without one of the plan's sessions", () => {
    const at = rescheduleMissed(EXAM, ["2026-11-04", "2026-11-05"], ctx());
    expect(at && label(at)).toBe("2026-11-06 4:00 PM");
  });

  it("gives up when there's no day left before the exam", () => {
    expect(rescheduleMissed(new Date("2026-11-05T15:00:00Z"), ["2026-11-04"], ctx())).toBeNull();
  });
});

describe("weekBounds", () => {
  it("runs Monday to Monday in the student's time zone", () => {
    expect(weekBounds(NOW, TZ)).toEqual({ start: new Date("2026-11-02T05:00:00Z"), end: new Date("2026-11-09T05:00:00Z") });
    // Sunday night is still the same week.
    expect(weekBounds(new Date("2026-11-09T04:00:00Z"), TZ).start).toEqual(new Date("2026-11-02T05:00:00Z"));
  });
});

describe("isMissed and planProgress", () => {
  it("counts a planned session as missed once it's over", () => {
    expect(isMissed({ startsAt: new Date("2026-11-04T13:00:00Z"), minutes: 30, status: "PLANNED" }, NOW)).toBe(true);
    expect(isMissed({ startsAt: new Date("2026-11-04T13:45:00Z"), minutes: 30, status: "PLANNED" }, NOW)).toBe(false);
    expect(isMissed({ startsAt: new Date("2026-11-04T13:00:00Z"), minutes: 30, status: "DONE" }, NOW)).toBe(false);
  });

  it("counts done against everything not skipped", () => {
    expect(planProgress([{ status: "DONE" }, { status: "SKIPPED" }, { status: "PLANNED" }])).toEqual({ done: 1, total: 2 });
  });
});
