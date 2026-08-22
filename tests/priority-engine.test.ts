import { describe, it, expect } from "vitest";
import {
  classifyUrgency,
  rankWorkItems,
  whatShouldIDoRightNow,
  findBestFitForMinutes,
  computeWorkloadSummary,
  heuristicEstimateMinutes,
  type WorkItem,
} from "@/lib/priority-engine";

const NOW = new Date("2026-08-21T14:00:00-04:00"); // Friday, 2pm ET
const TZ = "America/New_York";

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: "id-1",
    assignmentId: "id-1",
    kind: "assignment",
    title: "Untitled",
    className: "Test Class",
    classColor: 1,
    dueAt: null,
    estimatedMinutes: null,
    pointsPossible: null,
    status: "NOT_STARTED",
    isExamLinked: false,
    description: null,
    canvasUrl: null,
    ...overrides,
  };
}

describe("classifyUrgency", () => {
  it("buckets an overdue item", () => {
    expect(classifyUrgency(new Date("2026-08-20T23:59:00-04:00"), NOW, TZ)).toBe("OVERDUE");
  });
  it("buckets a same-day item as TODAY", () => {
    expect(classifyUrgency(new Date("2026-08-21T23:59:00-04:00"), NOW, TZ)).toBe("TODAY");
  });
  it("buckets next-day as TOMORROW", () => {
    expect(classifyUrgency(new Date("2026-08-22T09:00:00-04:00"), NOW, TZ)).toBe("TOMORROW");
  });
  it("buckets within a week as THIS_WEEK", () => {
    expect(classifyUrgency(new Date("2026-08-25T09:00:00-04:00"), NOW, TZ)).toBe("THIS_WEEK");
  });
  it("buckets far-future as LATER", () => {
    expect(classifyUrgency(new Date("2026-09-30T09:00:00-04:00"), NOW, TZ)).toBe("LATER");
  });
  it("buckets a null due date as NO_DATE", () => {
    expect(classifyUrgency(null, NOW, TZ)).toBe("NO_DATE");
  });
});

describe("rankWorkItems", () => {
  it("puts something due tonight ahead of something due next week", () => {
    const dueTonight = item({
      id: "a",
      title: "Math Homework",
      dueAt: new Date("2026-08-21T23:59:00-04:00"),
      estimatedMinutes: 42,
    });
    const dueNextWeek = item({
      id: "b",
      title: "History Reading",
      dueAt: new Date("2026-08-31T09:00:00-04:00"),
      estimatedMinutes: 35,
    });
    const ranked = rankWorkItems([dueNextWeek, dueTonight], NOW, TZ);
    expect(ranked[0].item.id).toBe("a");
  });

  it("excludes completed / submitted / graded items", () => {
    const done = item({ id: "done", status: "DONE", dueAt: new Date("2026-08-21T20:00:00-04:00") });
    const submitted = item({ id: "sub", status: "SUBMITTED", dueAt: new Date("2026-08-21T20:00:00-04:00") });
    const open = item({ id: "open", status: "NOT_STARTED", dueAt: new Date("2026-08-21T20:00:00-04:00") });
    const ranked = rankWorkItems([done, submitted, open], NOW, TZ);
    expect(ranked.map((r) => r.item.id)).toEqual(["open"]);
  });

  it("gives an overdue item the highest score of all", () => {
    const overdue = item({ id: "od", dueAt: new Date("2026-08-19T09:00:00-04:00") });
    const dueTonight = item({ id: "tonight", dueAt: new Date("2026-08-21T23:00:00-04:00") });
    const ranked = rankWorkItems([dueTonight, overdue], NOW, TZ);
    expect(ranked[0].item.id).toBe("od");
    expect(ranked[0].bucket).toBe("OVERDUE");
    expect(ranked[0].color).toBe("red");
  });
});

describe("whatShouldIDoRightNow", () => {
  it("returns null when there's nothing actionable", () => {
    expect(whatShouldIDoRightNow([], NOW, TZ)).toBeNull();
  });

  it("returns the single top-ranked item", () => {
    const a = item({ id: "a", dueAt: new Date("2026-08-21T20:00:00-04:00") });
    const b = item({ id: "b", dueAt: new Date("2026-08-22T20:00:00-04:00") });
    expect(whatShouldIDoRightNow([b, a], NOW, TZ)?.item.id).toBe("a");
  });
});

describe("findBestFitForMinutes", () => {
  const bigPaper = item({
    id: "paper",
    title: "Research Paper",
    dueAt: new Date("2026-08-21T20:00:00-04:00"),
    estimatedMinutes: 120,
  });
  const quickQuiz = item({
    id: "quiz",
    title: "Reading Quiz",
    dueAt: new Date("2026-08-22T20:00:00-04:00"),
    estimatedMinutes: 20,
  });

  it("finds a smaller item that fits when the top priority is too big", () => {
    const result = findBestFitForMinutes([bigPaper, quickQuiz], NOW, TZ, 25);
    expect(result.fits).toBe(true);
    if (result.fits) {
      expect(result.result.item.id).toBe("quiz");
    }
  });

  it("does not fabricate a fit when nothing qualifies", () => {
    const result = findBestFitForMinutes([bigPaper], NOW, TZ, 10);
    expect(result.fits).toBe(false);
    if (!result.fits) {
      expect(result.message).toMatch(/Research Paper/);
      expect(result.closest?.item.id).toBe("paper");
    }
  });

  it("says so honestly when nothing has a time estimate at all", () => {
    const noEstimate = item({ id: "x", title: "Mystery Task", dueAt: new Date("2026-08-21T20:00:00-04:00") });
    const result = findBestFitForMinutes([noEstimate], NOW, TZ, 30);
    expect(result.fits).toBe(false);
    if (!result.fits) {
      expect(result.message).toMatch(/doesn't have a time estimate/);
    }
  });
});

describe("computeWorkloadSummary", () => {
  it("never fabricates available time when there are no availability blocks", () => {
    const summary = computeWorkloadSummary([], NOW, TZ, null);
    expect(summary.availableMinutesToday).toBeNull();
    expect(summary.aheadBehindMinutes).toBeNull();
  });

  it("computes ahead/behind only once real availability is provided", () => {
    const dueToday = item({
      id: "a",
      dueAt: new Date("2026-08-21T20:00:00-04:00"),
      estimatedMinutes: 90,
    });
    const summary = computeWorkloadSummary([dueToday], NOW, TZ, 60);
    expect(summary.totalRemainingMinutesToday).toBe(90);
    expect(summary.availableMinutesToday).toBe(60);
    expect(summary.aheadBehindMinutes).toBe(-30);
  });

  it("counts overdue and due-today/tomorrow correctly", () => {
    const overdue = item({ id: "o", dueAt: new Date("2026-08-20T09:00:00-04:00") });
    const today = item({ id: "t", dueAt: new Date("2026-08-21T20:00:00-04:00") });
    const tomorrow = item({ id: "tm", dueAt: new Date("2026-08-22T09:00:00-04:00") });
    const summary = computeWorkloadSummary([overdue, today, tomorrow], NOW, TZ, null);
    expect(summary.overdueCount).toBe(1);
    expect(summary.dueTodayCount).toBe(1);
    expect(summary.dueTomorrowCount).toBe(1);
  });
});

describe("heuristicEstimateMinutes", () => {
  it("recognizes common assignment types", () => {
    expect(heuristicEstimateMinutes({ name: "Reading Quiz 3", pointsPossible: 10 })).toBe(25);
    expect(heuristicEstimateMinutes({ name: "Final Exam", pointsPossible: 150 })).toBe(150);
    expect(heuristicEstimateMinutes({ name: "Week 1 Attendance", pointsPossible: 1 })).toBe(2);
  });

  it("falls back to a points-based estimate for unrecognized names", () => {
    expect(heuristicEstimateMinutes({ name: "Peregrine Assessment", pointsPossible: 100 })).toBe(90);
  });
});
