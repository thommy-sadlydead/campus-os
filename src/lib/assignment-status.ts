// Plain words for Assignment.status. A plain module (no "use client") so
// server code can use it too: AssignmentRow shows these on its badge, and
// the class AI context uses them so the model reads "not started" rather
// than NOT_STARTED.

export type AssignmentStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  GRADED: "Graded",
};

export function assignmentStatusLabel(status: string): string {
  return ASSIGNMENT_STATUS_LABEL[status as AssignmentStatus] ?? status;
}
