import { describe, expect, it } from "vitest";
import { MAX_BOX, addDays, dueCount, isDue, nextReview } from "../src/lib/spaced-review";

const TZ = "America/New_York";
// 9 PM Eastern on Nov 4, already Nov 5 in UTC.
const NOW = new Date("2026-11-05T02:00:00Z");

describe("addDays", () => {
  it("adds calendar days across months and years", () => {
    expect(addDays("2026-11-04", 1)).toBe("2026-11-05");
    expect(addDays("2026-11-30", 3)).toBe("2026-12-03");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("nextReview", () => {
  it("brings a card you got back tomorrow at local midnight, then later each time", () => {
    expect(nextReview(0, true, NOW, TZ)).toEqual({ box: 1, dueAt: new Date("2026-11-05T05:00:00Z") });
    expect(nextReview(1, true, NOW, TZ).dueAt).toEqual(new Date("2026-11-07T05:00:00Z"));
    expect(nextReview(2, true, NOW, TZ).dueAt).toEqual(new Date("2026-11-11T05:00:00Z"));
  });

  it("stops moving up at the last box", () => {
    expect(nextReview(MAX_BOX, true, NOW, TZ).box).toBe(MAX_BOX);
  });

  it("starts a missed card over, due now", () => {
    expect(nextReview(4, false, NOW, TZ)).toEqual({ box: 0, dueAt: NOW });
  });
});

describe("isDue", () => {
  it("counts cards whose day has come, not new ones", () => {
    const cards = [
      { dueAt: null },
      { dueAt: new Date("2026-11-05T01:00:00Z") },
      { dueAt: "2026-11-05T02:00:00.000Z" },
      { dueAt: new Date("2026-11-06T05:00:00Z") },
    ];
    expect(cards.map((c) => isDue(c, NOW))).toEqual([false, true, true, false]);
    expect(dueCount(cards, NOW)).toBe(2);
  });
});
