import { describe, it, expect } from "vitest";
import { rankWorkItems, computeWorkloadSummary, type WorkItem, type WorkloadSummary } from "@/lib/priority-engine";
import { assessRisk } from "@/lib/risk-engine";

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
    ...overrides,
  };
}

function assess(items: WorkItem[], availableMinutesToday: number | null) {
  const ranked = rankWorkItems(items, NOW, TZ);
  const summary = computeWorkloadSummary(items, NOW, TZ, availableMinutesToday);
  return assessRisk(ranked, summary, NOW, TZ);
}

describe("assessRisk — on-track (green)", () => {
  it("is on-track with nothing open", () => {
    const result = assess([], null);
    expect(result.level).toBe("on-track");
    expect(result.recommendations).toHaveLength(0); // green never nags
  });

  it("is on-track with only far-future work and no logged free time", () => {
    const items = [item({ id: "a", title: "Term paper", dueAt: new Date("2026-10-01T23:59:00-04:00") })];
    const result = assess(items, null);
    expect(result.level).toBe("on-track");
  });

  it("is on-track when logged free time comfortably covers today's work", () => {
    const items = [
      item({ id: "a", title: "Quiz", dueAt: new Date("2026-08-21T20:00:00-04:00"), estimatedMinutes: 20 }),
    ];
    const result = assess(items, 120); // 120 min free vs 20 min of work due today
    expect(result.level).toBe("on-track");
  });
});

describe("assessRisk — getting-behind (yellow)", () => {
  it("goes yellow with one thing due within 48 hours", () => {
    const items = [item({ id: "a", title: "Reading response", dueAt: new Date("2026-08-22T23:59:00-04:00") })];
    const result = assess(items, null);
    expect(result.level).toBe("getting-behind");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("goes yellow when logged free time is slightly short of today's workload", () => {
    const items = [item({ id: "a", title: "Homework", dueAt: new Date("2026-08-21T20:00:00-04:00"), estimatedMinutes: 40 })];
    const result = assess(items, 30); // 10 min short — behind, but under the red threshold
    expect(result.level).toBe("getting-behind");
  });

  it("goes yellow with an exam inside the 72-hour window even with light workload otherwise", () => {
    const items = [
      item({ id: "a", title: "Midterm", dueAt: new Date("2026-08-23T10:00:00-04:00"), isExamLinked: true }),
    ];
    const result = assess(items, null);
    expect(result.level).toBe("getting-behind");
    expect(result.reasons.some((r) => r.toLowerCase().includes("exam"))).toBe(true);
  });
});

describe("assessRisk — at-risk (red)", () => {
  it("goes red with any overdue item, regardless of everything else", () => {
    const items = [item({ id: "a", title: "Late thing", dueAt: new Date("2026-08-19T23:59:00-04:00") })];
    const result = assess(items, null);
    expect(result.level).toBe("at-risk");
  });

  it("goes red when logged free time is an hour or more behind today's workload — matches the spec's own example shape", () => {
    const items = [item({ id: "a", title: "Big project", dueAt: new Date("2026-08-21T20:00:00-04:00"), estimatedMinutes: 180 })];
    const result = assess(items, 0); // 180 min behind
    expect(result.level).toBe("at-risk");
    expect(result.headline).toMatch(/behind/i);
  });

  it("goes red with three or more things due within 48 hours", () => {
    const items = [
      item({ id: "a", title: "A", dueAt: new Date("2026-08-22T10:00:00-04:00") }),
      item({ id: "b", title: "B", dueAt: new Date("2026-08-22T14:00:00-04:00") }),
      item({ id: "c", title: "C", dueAt: new Date("2026-08-23T09:00:00-04:00") }),
    ];
    const result = assess(items, null);
    expect(result.level).toBe("at-risk");
  });

  it("recommends completing the top two ranked items by name, chained — matching the spec's example phrasing", () => {
    const items = [
      item({ id: "a", title: "Biology", dueAt: new Date("2026-08-22T10:00:00-04:00") }),
      item({ id: "b", title: "History paper", dueAt: new Date("2026-08-22T18:00:00-04:00") }),
      item({ id: "c", title: "Extra thing", dueAt: new Date("2026-08-23T09:00:00-04:00") }),
    ];
    const result = assess(items, null);
    expect(result.level).toBe("at-risk");
    expect(result.recommendations[0]).toContain("Biology");
    expect(result.recommendations[0]).toContain("then");
  });
});

describe("assessRisk — never overwhelms", () => {
  it("caps reasons at a small handful even with many simultaneous signals", () => {
    const items = [
      item({ id: "overdue1", title: "Late 1", dueAt: new Date("2026-08-19T23:59:00-04:00") }),
      item({ id: "soon1", title: "Soon 1", dueAt: new Date("2026-08-22T10:00:00-04:00") }),
      item({ id: "soon2", title: "Soon 2", dueAt: new Date("2026-08-22T12:00:00-04:00") }),
      item({ id: "soon3", title: "Soon 3", dueAt: new Date("2026-08-22T14:00:00-04:00") }),
      item({ id: "exam1", title: "Exam", dueAt: new Date("2026-08-22T16:00:00-04:00"), isExamLinked: true }),
    ];
    const result = assess(items, 0);
    expect(result.reasons.length).toBeLessThanOrEqual(4);
  });

  it("caps recommendations at three even when many items are ranked", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      item({ id: `x${i}`, title: `Item ${i}`, dueAt: new Date("2026-08-22T10:00:00-04:00") })
    );
    const result = assess(items, 0);
    // one recommendation string chaining up to 3 items, not one per item
    expect(result.recommendations.length).toBeLessThanOrEqual(1);
  });
});

describe("assessRisk — never fabricates availability", () => {
  it("does not claim a specific 'behind by X' figure when free time was never logged", () => {
    const items = [item({ id: "a", title: "Something", dueAt: new Date("2026-08-22T10:00:00-04:00") })];
    const result = assess(items, null);
    expect(result.headline).not.toMatch(/behind your planned workload/i);
  });
});
