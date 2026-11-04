import { describe, expect, it } from "vitest";
import { canvasCourseGrade, describeNeeded, formatPercent, gradeSlip, neededOnFinal, parseGradePercent } from "../src/lib/grades";

describe("parseGradePercent", () => {
  it("reads percents, plain numbers, fractions and a percent beside a letter", () => {
    expect(parseGradePercent("92%")).toBe(92);
    expect(parseGradePercent("88.5")).toBe(88.5);
    expect(parseGradePercent("B+ (88%)")).toBe(88);
    expect(parseGradePercent("45/50")).toBe(90);
    expect(parseGradePercent("45 / 60")).toBe(75);
  });

  it("gives null for a letter alone or nothing usable", () => {
    expect(parseGradePercent("A-")).toBeNull();
    expect(parseGradePercent("")).toBeNull();
    expect(parseGradePercent(null)).toBeNull();
    expect(parseGradePercent("400")).toBeNull();
    expect(parseGradePercent("3/0")).toBeNull();
  });
});

describe("formatPercent", () => {
  it("drops a trailing .0", () => {
    expect(formatPercent(88)).toBe("88%");
    expect(formatPercent(88.46)).toBe("88.5%");
  });
});

describe("neededOnFinal", () => {
  it("works out the score the final needs", () => {
    expect(neededOnFinal({ current: 85, target: 90, finalWeight: 25 })).toBe(105);
    expect(neededOnFinal({ current: 88, target: 90, finalWeight: 40 })).toBe(93);
    expect(neededOnFinal({ current: 95, target: 80, finalWeight: 20 })).toBe(20);
  });

  it("refuses a weight outside 0–100", () => {
    expect(neededOnFinal({ current: 85, target: 90, finalWeight: 0 })).toBeNull();
    expect(neededOnFinal({ current: 85, target: 90, finalWeight: 120 })).toBeNull();
  });
});

describe("describeNeeded", () => {
  it("says when it's out of reach, already safe, or the number", () => {
    expect(describeNeeded(105, 90)).toMatch(/Even 100%/);
    expect(describeNeeded(-10, 80)).toMatch(/even with a 0/);
    expect(describeNeeded(93, 90)).toBe("You need 93% on the final to finish with 90%.");
  });
});

describe("gradeSlip", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it("flags a drop of 3 or more from the recent high", () => {
    const snaps = [{ percent: 91, takenAt: day(10) }, { percent: 89, takenAt: day(4) }, { percent: 87, takenAt: day(0) }];
    expect(gradeSlip(87, snaps, now, null)).toEqual({ kind: "dropped", points: 4, from: 91, since: day(10) });
  });

  it("ignores a high from longer ago and small dips", () => {
    expect(gradeSlip(85, [{ percent: 95, takenAt: day(40) }], now, null)).toBeNull();
    expect(gradeSlip(89, [{ percent: 91, takenAt: day(2) }], now, null)).toBeNull();
  });

  it("flags a grade under the student's goal", () => {
    expect(gradeSlip(84, [], now, 90)).toEqual({ kind: "below-goal", target: 90 });
    expect(gradeSlip(92, [], now, 90)).toBeNull();
  });
});

describe("canvasCourseGrade", () => {
  it("reads the student's current score and letter", () => {
    expect(
      canvasCourseGrade({ enrollments: [{ type: "student", computed_current_score: 91.234, computed_current_grade: "A-" }] })
    ).toEqual({ percent: 91.2, letter: "A-" });
  });

  it("gives null when the course hides totals", () => {
    expect(canvasCourseGrade({ enrollments: [{ type: "student", computed_current_score: null }] })).toBeNull();
    expect(canvasCourseGrade({})).toBeNull();
  });
});
