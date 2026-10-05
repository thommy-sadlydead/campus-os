import { describe, it, expect } from "vitest";
import { calendarOnlyExams, isExamLikeName } from "../src/lib/lms/exams";

describe("isExamLikeName", () => {
  it("recognizes exams, midterms and finals that say exam", () => {
    for (const name of ["Final Exam", "Midterm 1", "Exam 2: Chapters 4-6", "Mid-term Exam", "Take-Home Exam", "Final Examination"]) {
      expect(isExamLikeName(name), name).toBe(true);
    }
  });

  it("doesn't treat other work named \"final\" as an exam", () => {
    for (const name of ["Final Draft: Rhetorical Analysis", "Final Project", "Final Presentation", "Final Paper"]) {
      expect(isExamLikeName(name), name).toBe(false);
    }
  });

  it("doesn't treat work about an exam as the exam itself", () => {
    for (const name of ["Exam 1 Review", "Practice Midterm", "Midterm Reflection", "Exam Corrections", "Final Exam Study Guide"]) {
      expect(isExamLikeName(name), name).toBe(false);
    }
  });
});

describe("isExamLikeName on a real Fall 2026 schedule", () => {
  // The Exams tabs on the live site before this rule changed: 16 real exams
  // and 6 entries the old "final" rule wrongly added, which Canvas sync now
  // removes.
  const REAL_EXAMS = [
    "Exam II",
    "Final Exam",
    "Exam 1",
    "Exam 1 - Canvas",
    "Exam #2 (Remotely Proctored)",
    "Final Exam (Secure Browser)",
    "Exam #1 (Secure Browser)",
    "Exam #1 - Retake (Extra Credit | Remotely Proctored) (Secure Browser)",
    "Exam 2",
    "Exam 3",
    "Exam 1 (12%)",
    "Exam 2 (12%)",
    "Exam 3 (12%)",
    "Final Exam (24%)",
  ];
  const NOT_EXAMS = [
    "Final Draft: Rhetorical Analysis",
    "Final Draft: Persuasive Essay",
    "Final Draft: Researched Argument",
    "Final Presentation: Researched Argument",
    "Final Draft: Short Story",
    "Practice Questions for Exam 1 (Selected from Ch1~3)",
  ];

  it("keeps every real exam", () => {
    expect(REAL_EXAMS.filter((name) => !isExamLikeName(name))).toEqual([]);
  });

  it("drops exactly the six that weren't exams", () => {
    expect(NOT_EXAMS.filter((name) => isExamLikeName(name))).toEqual([]);
  });
});

describe("calendarOnlyExams", () => {
  it("drops a calendar exam already listed as an exam assignment, whatever the punctuation or case", () => {
    const calendar = [{ name: "Exam 2" }, { name: "midterm exam" }, { name: "Final Exam (in class)" }];
    expect(calendarOnlyExams(calendar, ["EXAM #2", "Midterm Exam"])).toEqual([{ name: "Final Exam (in class)" }]);
  });

  it("keeps every calendar exam when there are no exam assignments", () => {
    const calendar = [{ name: "Exam 1" }];
    expect(calendarOnlyExams(calendar, [])).toEqual(calendar);
  });
});
