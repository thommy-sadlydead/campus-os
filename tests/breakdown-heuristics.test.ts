import { describe, it, expect } from "vitest";
import { heuristicBreakdown } from "../src/lib/breakdown-heuristics";

function sumMinutes(steps: Array<{ estimatedMinutes: number }>): number {
  return steps.reduce((s, x) => s + x.estimatedMinutes, 0);
}

describe("heuristicBreakdown", () => {
  it("returns nothing for a small item — not worth splitting", () => {
    expect(heuristicBreakdown({ name: "Week 1 Attendance", baseEstimateMinutes: 2 })).toEqual([]);
    expect(heuristicBreakdown({ name: "Reading Response", baseEstimateMinutes: 20 })).toEqual([]);
  });

  it("returns nothing for zero/undefined estimates rather than guessing a total", () => {
    expect(heuristicBreakdown({ name: "Mystery Assignment", baseEstimateMinutes: 0 })).toEqual([]);
  });

  it("breaks a research paper into outline/draft/revise, matching the spec's own example shape", () => {
    const steps = heuristicBreakdown({ name: "Research Paper", baseEstimateMinutes: 210 });
    expect(steps.length).toBe(3);
    expect(steps.map((s) => s.title.toLowerCase())).toEqual(
      expect.arrayContaining([expect.stringContaining("outline"), expect.stringContaining("draft"), expect.stringContaining("revise")])
    );
    // Steps should sum back to roughly the original total, not invent new effort.
    expect(sumMinutes(steps)).toBeGreaterThanOrEqual(190);
    expect(sumMinutes(steps)).toBeLessThanOrEqual(230);
  });

  it("breaks an exam into review/practice/final-review", () => {
    const steps = heuristicBreakdown({ name: "Midterm Exam", baseEstimateMinutes: 100 });
    expect(steps.length).toBe(3);
    expect(sumMinutes(steps)).toBeGreaterThanOrEqual(90);
    expect(sumMinutes(steps)).toBeLessThanOrEqual(110);
  });

  it("gives a project a plan/work/review shape", () => {
    const steps = heuristicBreakdown({ name: "Final Project", baseEstimateMinutes: 180 });
    expect(steps.length).toBe(3);
    expect(steps[0].title.toLowerCase()).toContain("plan");
  });

  it("never returns a step under 5 minutes even for a small fraction of a big total", () => {
    const steps = heuristicBreakdown({ name: "Research Paper", baseEstimateMinutes: 30 });
    for (const s of steps) {
      expect(s.estimatedMinutes).toBeGreaterThanOrEqual(5);
    }
  });

  it("keeps quizzes and short-form work as a single unsplit item even above the size floor", () => {
    expect(heuristicBreakdown({ name: "Quiz 3", baseEstimateMinutes: 45 })).toEqual([]);
  });

  it("falls back to a generic get-started/finish/review shape for an unrecognized but sizable assignment", () => {
    const steps = heuristicBreakdown({ name: "Lab Write-up", baseEstimateMinutes: 60 });
    expect(steps.length).toBe(3);
    expect(sumMinutes(steps)).toBeGreaterThanOrEqual(50);
  });

  it("is not fooled by case", () => {
    expect(heuristicBreakdown({ name: "RESEARCH PAPER", baseEstimateMinutes: 200 }).length).toBe(3);
  });
});
