// Which LMS items are exams. Pure; tested in tests/lms-exams.test.ts.

/**
 * Whether an assignment or calendar item is an exam, from its name. Plain
 * "final" used to count, which made "Final Draft: Rhetorical Analysis" and
 * "Final Presentation" exams; now it takes "exam", "midterm" or "final
 * exam" ("Final Exam" contains "exam"). Things about an exam that aren't
 * the exam itself (a review, a practice exam, an exam wrapper) don't count.
 */
export function isExamLikeName(name: string): boolean {
  if (!/\b(exams?|examination|midterms?|mid-terms?)\b/i.test(name)) return false;
  return !/\b(review|prep|practice|study guide|wrapper|reflection|corrections?)\b/i.test(name);
}

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The calendar's exams that aren't already an exam assignment. Professors
 * often put an exam in the gradebook and on the calendar under the same
 * name ("Exam 2"), which would otherwise list it twice.
 */
export function calendarOnlyExams<T extends { name: string }>(calendarExams: T[], assignmentExamNames: string[]): T[] {
  const taken = new Set(assignmentExamNames.map(normalized));
  return calendarExams.filter((exam) => !taken.has(normalized(exam.name)));
}
