import { describe, it, expect } from "vitest";
import { calendarOnlyExams, examDateFromName, isExamLikeName } from "../src/lib/lms/exams";

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

describe("examDateFromName", () => {
  const TZ = "America/New_York";
  const NOV_13 = new Date("2026-11-13T16:00:00Z");
  const end = (iso: string) => new Date(iso); // 23:59 local, as UTC

  it("reads the date out of an exam's name, at the end of that day", () => {
    expect(examDateFromName("Exam #2 – October 30th", NOV_13, TZ)).toEqual(end("2026-10-31T03:59:00Z"));
    expect(examDateFromName("Midterm (Oct. 14)", NOV_13, TZ)).toEqual(end("2026-10-15T03:59:00Z"));
    expect(examDateFromName("Final Exam - December 9", NOV_13, TZ)).toEqual(end("2026-12-10T04:59:00Z"));
    expect(examDateFromName("Exam 3 10/30", NOV_13, TZ)).toEqual(end("2026-10-31T03:59:00Z"));
    expect(examDateFromName("Exam 3 (11/20/26)", NOV_13, TZ)).toEqual(end("2026-11-21T04:59:00Z"));
    expect(examDateFromName("Exam 2: Sept 4th, 2026", NOV_13, TZ)).toEqual(end("2026-09-05T03:59:00Z"));
  });

  it("picks the year that puts the date nearest today", () => {
    const LATE_DEC = new Date("2026-12-28T16:00:00Z");
    expect(examDateFromName("Final Exam - January 15", LATE_DEC, TZ)).toEqual(end("2027-01-16T04:59:00Z"));
    const EARLY_JAN = new Date("2027-01-05T16:00:00Z");
    expect(examDateFromName("Exam 4 - December 12", EARLY_JAN, TZ)).toEqual(end("2026-12-13T04:59:00Z"));
  });

  it("uses the student's time zone for the end of the day", () => {
    expect(examDateFromName("Exam 1 - October 30", NOV_13, "America/Los_Angeles")).toEqual(end("2026-10-31T06:59:00Z"));
  });

  it("says nothing when the name has no date", () => {
    for (const name of [
      "Exam #2 (Remotely Proctored)",
      "Exam 1 (12%)",
      "Exam 2: Chapters 4-6",
      "Final Exam (Secure Browser)",
      "Midterm 1",
      "Exam #1 - Retake (Extra Credit | Remotely Proctored)",
    ]) {
      expect(examDateFromName(name, NOV_13, TZ), name).toBeNull();
    }
  });

  it("says nothing when the name has more than one date, or one that can't be", () => {
    expect(examDateFromName("Exam 2 - Oct 30 (makeup Nov 6)", NOV_13, TZ)).toBeNull();
    expect(examDateFromName("Exam 2 - February 30", NOV_13, TZ)).toBeNull();
    expect(examDateFromName("Exam 2 - 13/40", NOV_13, TZ)).toBeNull();
  });

  it("counts the same date written twice as one", () => {
    expect(examDateFromName("Exam 2 - Oct 30 (10/30)", NOV_13, TZ)).toEqual(end("2026-10-31T03:59:00Z"));
  });
});
